import { Hono } from "hono";
import { cors } from "hono/cors";
import { initActorRuntimeContext } from "./actors/context.js";
import { registry } from "./actors/index.js";
import { workspaceKey } from "./actors/keys.js";
import { loadConfig } from "./config/backend.js";
import { createBackends, createNotificationService } from "./notifications/index.js";
import { createDefaultDriver } from "./driver.js";
import { createProviderRegistry } from "./providers/index.js";
import { createClient } from "rivetkit/client";
import type { FoundryBillingPlanId } from "@sandbox-agent/foundry-shared";
import { createDefaultAppShellServices } from "./services/app-shell-runtime.js";
import { APP_SHELL_WORKSPACE_ID } from "./actors/workspace/app-shell.js";

export interface BackendStartOptions {
  host?: string;
  port?: number;
}

function isRetryableAppActorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Actor not ready") || message.includes("socket connection was closed unexpectedly");
}

async function withRetries<T>(run: () => Promise<T>, attempts = 20, delayMs = 250): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryableAppActorError(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function startBackend(options: BackendStartOptions = {}): Promise<void> {
  // sandbox-agent agent plugins vary on which env var they read for OpenAI/Codex auth.
  // Normalize to keep local dev + docker-compose simple.
  if (!process.env.CODEX_API_KEY && process.env.OPENAI_API_KEY) {
    process.env.CODEX_API_KEY = process.env.OPENAI_API_KEY;
  }

  const config = loadConfig();
  config.backend.host = options.host ?? config.backend.host;
  config.backend.port = options.port ?? config.backend.port;

  // Allow docker-compose/dev environments to supply provider config via env vars
  // instead of writing into the container's config.toml.
  const envFirst = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const raw = process.env[key];
      if (raw && raw.trim().length > 0) return raw.trim();
    }
    return undefined;
  };

  config.providers.daytona.endpoint = envFirst("HF_DAYTONA_ENDPOINT", "DAYTONA_ENDPOINT") ?? config.providers.daytona.endpoint;
  config.providers.daytona.apiKey = envFirst("HF_DAYTONA_API_KEY", "DAYTONA_API_KEY") ?? config.providers.daytona.apiKey;

  const driver = createDefaultDriver();
  const providers = createProviderRegistry(config, driver);
  const backends = await createBackends(config.notify);
  const notifications = createNotificationService(backends);
  initActorRuntimeContext(config, providers, notifications, driver, createDefaultAppShellServices());

  const actorClient = createClient({
    endpoint: `http://127.0.0.1:${config.backend.port}/api/rivet`,
  }) as any;

  // Wrap RivetKit and app routes in a single Hono app mounted at /api/rivet.
  const app = new Hono();
  const allowHeaders = [
    "Content-Type",
    "Authorization",
    "x-rivet-token",
    "x-rivet-encoding",
    "x-rivet-query",
    "x-rivet-conn-params",
    "x-rivet-actor",
    "x-rivet-target",
    "x-rivet-namespace",
    "x-rivet-endpoint",
    "x-rivet-total-slots",
    "x-rivet-runner-name",
    "x-rivet-namespace-name",
    "x-foundry-session",
  ];
  const exposeHeaders = ["Content-Type", "x-foundry-session", "x-rivet-ray-id"];
  app.use(
    "/api/rivet/*",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
      allowHeaders,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders,
    }),
  );
  app.use(
    "/api/rivet",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
      allowHeaders,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders,
    }),
  );

  const appWorkspace = async () =>
    await withRetries(
      async () =>
        await actorClient.workspace.getOrCreate(workspaceKey(APP_SHELL_WORKSPACE_ID), {
          createWithInput: APP_SHELL_WORKSPACE_ID,
        }),
    );

  const appWorkspaceAction = async <T>(run: (workspace: any) => Promise<T>): Promise<T> => await withRetries(async () => await run(await appWorkspace()));

  const resolveSessionId = async (c: any): Promise<string> => {
    const requested = c.req.header("x-foundry-session");
    const { sessionId } = await appWorkspaceAction(
      async (workspace) => await workspace.ensureAppSession(requested && requested.trim().length > 0 ? { requestedSessionId: requested } : {}),
    );
    c.header("x-foundry-session", sessionId);
    return sessionId;
  };

  app.get("/api/rivet/app/snapshot", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(await appWorkspaceAction(async (workspace) => await workspace.getAppSnapshot({ sessionId })));
  });

  app.get("/api/rivet/app/auth/github/start", async (c) => {
    const sessionId = await resolveSessionId(c);
    const result = await appWorkspaceAction(async (workspace) => await workspace.startAppGithubAuth({ sessionId }));
    return Response.redirect(result.url, 302);
  });

  const handleGithubAuthCallback = async (c: any) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.text("Missing GitHub OAuth callback parameters", 400);
    }
    const result = await appWorkspaceAction(async (workspace) => await workspace.completeAppGithubAuth({ code, state }));
    c.header("x-foundry-session", result.sessionId);
    return Response.redirect(result.redirectTo, 302);
  };

  app.get("/api/rivet/app/auth/github/callback", handleGithubAuthCallback);
  app.get("/api/auth/callback/github", handleGithubAuthCallback);

  app.post("/api/rivet/app/sign-out", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(await appWorkspaceAction(async (workspace) => await workspace.signOutApp({ sessionId })));
  });

  app.post("/api/rivet/app/onboarding/starter-repo/skip", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(await appWorkspaceAction(async (workspace) => await workspace.skipAppStarterRepo({ sessionId })));
  });

  app.post("/api/rivet/app/organizations/:organizationId/starter-repo/star", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        async (workspace) =>
          await workspace.starAppStarterRepo({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
      ),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/select", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        async (workspace) =>
          await workspace.selectAppOrganization({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
      ),
    );
  });

  app.patch("/api/rivet/app/organizations/:organizationId/profile", async (c) => {
    const sessionId = await resolveSessionId(c);
    const body = await c.req.json();
    return c.json(
      await appWorkspaceAction(
        async (workspace) =>
          await workspace.updateAppOrganizationProfile({
            sessionId,
            organizationId: c.req.param("organizationId"),
            displayName: typeof body?.displayName === "string" ? body.displayName : "",
            slug: typeof body?.slug === "string" ? body.slug : "",
            primaryDomain: typeof body?.primaryDomain === "string" ? body.primaryDomain : "",
          }),
      ),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/import", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        async (workspace) =>
          await workspace.triggerAppRepoImport({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
      ),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/reconnect", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        async (workspace) =>
          await workspace.beginAppGithubInstall({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
      ),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/billing/checkout", async (c) => {
    const sessionId = await resolveSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const planId = body?.planId === "free" || body?.planId === "team" ? (body.planId as FoundryBillingPlanId) : "team";
    return c.json(
      await (await appWorkspace()).createAppCheckoutSession({
        sessionId,
        organizationId: c.req.param("organizationId"),
        planId,
      }),
    );
  });

  app.get("/api/rivet/app/billing/checkout/complete", async (c) => {
    const organizationId = c.req.query("organizationId");
    const sessionId = c.req.query("foundrySession");
    const checkoutSessionId = c.req.query("session_id");
    if (!organizationId || !sessionId || !checkoutSessionId) {
      return c.text("Missing Stripe checkout completion parameters", 400);
    }
    const result = await (await appWorkspace()).finalizeAppCheckoutSession({
      organizationId,
      sessionId,
      checkoutSessionId,
    });
    return Response.redirect(result.redirectTo, 302);
  });

  app.post("/api/rivet/app/organizations/:organizationId/billing/portal", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace()).createAppBillingPortalSession({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/billing/cancel", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace()).cancelAppScheduledRenewal({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/api/rivet/app/organizations/:organizationId/billing/resume", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace()).resumeAppSubscription({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/api/rivet/app/workspaces/:workspaceId/seat-usage", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace()).recordAppSeatUsage({
        sessionId,
        workspaceId: c.req.param("workspaceId"),
      }),
    );
  });

  const handleStripeWebhook = async (c: any) => {
    const payload = await c.req.text();
    await (await appWorkspace()).handleAppStripeWebhook({
      payload,
      signatureHeader: c.req.header("stripe-signature") ?? null,
    });
    return c.json({ ok: true });
  };

  app.post("/api/rivet/app/webhooks/stripe", handleStripeWebhook);
  app.post("/api/rivet/app/stripe/webhook", handleStripeWebhook);

  app.post("/api/rivet/app/webhooks/github", async (c) => {
    const payload = await c.req.text();
    await (await appWorkspace()).handleAppGithubWebhook({
      payload,
      signatureHeader: c.req.header("x-hub-signature-256") ?? null,
      eventHeader: c.req.header("x-github-event") ?? null,
    });
    return c.json({ ok: true });
  });

  app.all("/api/rivet", (c) => registry.handler(c.req.raw));
  app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

  const server = Bun.serve({
    fetch: app.fetch,
    hostname: config.backend.host,
    port: config.backend.port,
  });

  process.on("SIGINT", async () => {
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    server.stop();
    process.exit(0);
  });

  // Keep process alive.
  await new Promise<void>(() => undefined);
}

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function parseEnvPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return undefined;
  }
  return port;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "start";
  if (cmd !== "start") {
    throw new Error(`Unsupported backend command: ${cmd}`);
  }

  const host = parseArg("--host") ?? process.env.HOST ?? process.env.HF_BACKEND_HOST;
  const port = parseArg("--port") ?? process.env.PORT ?? process.env.HF_BACKEND_PORT;
  await startBackend({
    host,
    port: parseEnvPort(port),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(message);
    process.exit(1);
  });
}
