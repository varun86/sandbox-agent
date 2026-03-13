import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
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
import { logger } from "./logging.js";

export interface BackendStartOptions {
  host?: string;
  port?: number;
}

interface AppWorkspaceLogContext {
  action?: string;
  cfConnectingIp?: string;
  cfRay?: string;
  forwardedFor?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  method?: string;
  path?: string;
  requestId?: string;
  referer?: string;
  secFetchDest?: string;
  secFetchMode?: string;
  secFetchSite?: string;
  secFetchUser?: string;
  sessionId?: string;
  userAgent?: string;
  xRealIp?: string;
}

function isRivetRequest(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname === "/v1/rivet" || pathname.startsWith("/v1/rivet/");
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
    endpoint: `http://127.0.0.1:${config.backend.port}/v1/rivet`,
  }) as any;

  const requestHeaderContext = (c: any): AppWorkspaceLogContext => ({
    cfConnectingIp: c.req.header("cf-connecting-ip") ?? undefined,
    cfRay: c.req.header("cf-ray") ?? undefined,
    forwardedFor: c.req.header("x-forwarded-for") ?? undefined,
    forwardedHost: c.req.header("x-forwarded-host") ?? undefined,
    forwardedProto: c.req.header("x-forwarded-proto") ?? undefined,
    referer: c.req.header("referer") ?? undefined,
    secFetchDest: c.req.header("sec-fetch-dest") ?? undefined,
    secFetchMode: c.req.header("sec-fetch-mode") ?? undefined,
    secFetchSite: c.req.header("sec-fetch-site") ?? undefined,
    secFetchUser: c.req.header("sec-fetch-user") ?? undefined,
    userAgent: c.req.header("user-agent") ?? undefined,
    xRealIp: c.req.header("x-real-ip") ?? undefined,
  });

  // Serve custom Foundry HTTP APIs alongside the RivetKit registry.
  const app = new Hono<{ Variables: { requestId: string } }>();
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
    "/v1/*",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
      allowHeaders,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders,
    }),
  );
  app.use(
    "/v1",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
      allowHeaders,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders,
    }),
  );
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.trim() || randomUUID();
    const start = performance.now();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);

    try {
      await next();
    } catch (error) {
      logger.error(
        {
          ...requestHeaderContext(c),
          requestId,
          method: c.req.method,
          path: c.req.path,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "http_request_failed",
      );
      throw error;
    }

    logger.info(
      {
        ...requestHeaderContext(c),
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
      },
      "http_request",
    );
  });

  let cachedAppWorkspace: any | null = null;

  const appWorkspace = async (context: AppWorkspaceLogContext = {}) => {
    if (cachedAppWorkspace) return cachedAppWorkspace;

    const start = performance.now();
    try {
      const handle = await withRetries(
        async () =>
          await actorClient.workspace.getOrCreate(workspaceKey(APP_SHELL_WORKSPACE_ID), {
            createWithInput: APP_SHELL_WORKSPACE_ID,
          }),
      );
      cachedAppWorkspace = handle;
      logger.info(
        {
          ...context,
          cache: "miss",
          durationMs: Math.round((performance.now() - start) * 100) / 100,
        },
        "app_workspace_resolve",
      );
      return handle;
    } catch (error) {
      logger.error(
        {
          ...context,
          cache: "miss",
          durationMs: Math.round((performance.now() - start) * 100) / 100,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "app_workspace_resolve_failed",
      );
      throw error;
    }
  };

  const appWorkspaceAction = async <T>(action: string, run: (workspace: any) => Promise<T>, context: AppWorkspaceLogContext = {}): Promise<T> => {
    try {
      return await run(await appWorkspace({ ...context, action }));
    } catch (error) {
      logger.error(
        {
          ...context,
          action,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "app_workspace_action_failed",
      );
      throw error;
    }
  };

  const requestLogContext = (c: any, sessionId?: string): AppWorkspaceLogContext => ({
    ...requestHeaderContext(c),
    method: c.req.method,
    path: c.req.path,
    requestId: c.get("requestId"),
    sessionId,
  });

  const resolveSessionId = async (c: any): Promise<string> => {
    const requested = c.req.header("x-foundry-session");
    const { sessionId } = await appWorkspaceAction(
      "ensureAppSession",
      async (workspace) => await workspace.ensureAppSession(requested && requested.trim().length > 0 ? { requestedSessionId: requested } : {}),
      requestLogContext(c),
    );
    c.header("x-foundry-session", sessionId);
    return sessionId;
  };

  app.get("/v1/app/snapshot", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction("getAppSnapshot", async (workspace) => await workspace.getAppSnapshot({ sessionId }), requestLogContext(c, sessionId)),
    );
  });

  app.get("/v1/auth/github/start", async (c) => {
    const sessionId = await resolveSessionId(c);
    const result = await appWorkspaceAction(
      "startAppGithubAuth",
      async (workspace) => await workspace.startAppGithubAuth({ sessionId }),
      requestLogContext(c, sessionId),
    );
    return Response.redirect(result.url, 302);
  });

  const handleGithubAuthCallback = async (c: any) => {
    // TEMPORARY: dump all request headers to diagnose duplicate callback requests
    // (Railway nginx proxy_next_upstream? Cloudflare retry? browser?)
    // Remove once root cause is identified.
    const allHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value: string, key: string) => {
      allHeaders[key] = value;
    });
    logger.info({ headers: allHeaders, url: c.req.url }, "github_callback_headers");

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.text("Missing GitHub OAuth callback parameters", 400);
    }
    const result = await appWorkspaceAction(
      "completeAppGithubAuth",
      async (workspace) => await workspace.completeAppGithubAuth({ code, state }),
      requestLogContext(c),
    );
    c.header("x-foundry-session", result.sessionId);
    return Response.redirect(result.redirectTo, 302);
  };

  app.get("/v1/auth/github/callback", handleGithubAuthCallback);
  app.get("/api/auth/callback/github", handleGithubAuthCallback);

  app.post("/v1/app/sign-out", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(await appWorkspaceAction("signOutApp", async (workspace) => await workspace.signOutApp({ sessionId }), requestLogContext(c, sessionId)));
  });

  app.post("/v1/app/onboarding/starter-repo/skip", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction("skipAppStarterRepo", async (workspace) => await workspace.skipAppStarterRepo({ sessionId }), requestLogContext(c, sessionId)),
    );
  });

  app.post("/v1/app/organizations/:organizationId/starter-repo/star", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        "starAppStarterRepo",
        async (workspace) =>
          await workspace.starAppStarterRepo({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
        requestLogContext(c, sessionId),
      ),
    );
  });

  app.post("/v1/app/organizations/:organizationId/select", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        "selectAppOrganization",
        async (workspace) =>
          await workspace.selectAppOrganization({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
        requestLogContext(c, sessionId),
      ),
    );
  });

  app.patch("/v1/app/organizations/:organizationId/profile", async (c) => {
    const sessionId = await resolveSessionId(c);
    const body = await c.req.json();
    return c.json(
      await appWorkspaceAction(
        "updateAppOrganizationProfile",
        async (workspace) =>
          await workspace.updateAppOrganizationProfile({
            sessionId,
            organizationId: c.req.param("organizationId"),
            displayName: typeof body?.displayName === "string" ? body.displayName : "",
            slug: typeof body?.slug === "string" ? body.slug : "",
            primaryDomain: typeof body?.primaryDomain === "string" ? body.primaryDomain : "",
          }),
        requestLogContext(c, sessionId),
      ),
    );
  });

  app.post("/v1/app/organizations/:organizationId/import", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        "triggerAppRepoImport",
        async (workspace) =>
          await workspace.triggerAppRepoImport({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
        requestLogContext(c, sessionId),
      ),
    );
  });

  app.post("/v1/app/organizations/:organizationId/reconnect", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await appWorkspaceAction(
        "beginAppGithubInstall",
        async (workspace) =>
          await workspace.beginAppGithubInstall({
            sessionId,
            organizationId: c.req.param("organizationId"),
          }),
        requestLogContext(c, sessionId),
      ),
    );
  });

  app.post("/v1/app/organizations/:organizationId/billing/checkout", async (c) => {
    const sessionId = await resolveSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const planId = body?.planId === "free" || body?.planId === "team" ? (body.planId as FoundryBillingPlanId) : "team";
    return c.json(
      await (await appWorkspace(requestLogContext(c, sessionId))).createAppCheckoutSession({
        sessionId,
        organizationId: c.req.param("organizationId"),
        planId,
      }),
    );
  });

  app.get("/v1/billing/checkout/complete", async (c) => {
    const organizationId = c.req.query("organizationId");
    const sessionId = c.req.query("foundrySession");
    const checkoutSessionId = c.req.query("session_id");
    if (!organizationId || !sessionId || !checkoutSessionId) {
      return c.text("Missing Stripe checkout completion parameters", 400);
    }
    const result = await (await appWorkspace(requestLogContext(c, sessionId))).finalizeAppCheckoutSession({
      organizationId,
      sessionId,
      checkoutSessionId,
    });
    return Response.redirect(result.redirectTo, 302);
  });

  app.post("/v1/app/organizations/:organizationId/billing/portal", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace(requestLogContext(c, sessionId))).createAppBillingPortalSession({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/v1/app/organizations/:organizationId/billing/cancel", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace(requestLogContext(c, sessionId))).cancelAppScheduledRenewal({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/v1/app/organizations/:organizationId/billing/resume", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace(requestLogContext(c, sessionId))).resumeAppSubscription({
        sessionId,
        organizationId: c.req.param("organizationId"),
      }),
    );
  });

  app.post("/v1/app/workspaces/:workspaceId/seat-usage", async (c) => {
    const sessionId = await resolveSessionId(c);
    return c.json(
      await (await appWorkspace(requestLogContext(c, sessionId))).recordAppSeatUsage({
        sessionId,
        workspaceId: c.req.param("workspaceId"),
      }),
    );
  });

  const handleStripeWebhook = async (c: any) => {
    const payload = await c.req.text();
    await (await appWorkspace(requestLogContext(c))).handleAppStripeWebhook({
      payload,
      signatureHeader: c.req.header("stripe-signature") ?? null,
    });
    return c.json({ ok: true });
  };

  app.post("/v1/webhooks/stripe", handleStripeWebhook);

  app.post("/v1/webhooks/github", async (c) => {
    const payload = await c.req.text();
    await (await appWorkspace(requestLogContext(c))).handleAppGithubWebhook({
      payload,
      signatureHeader: c.req.header("x-hub-signature-256") ?? null,
      eventHeader: c.req.header("x-github-event") ?? null,
    });
    return c.json({ ok: true });
  });

  const server = Bun.serve({
    fetch: (request) => {
      if (isRivetRequest(request)) {
        return registry.handler(request);
      }
      return app.fetch(request);
    },
    hostname: config.backend.host,
    port: config.backend.port,
  });

  logger.info(
    {
      host: config.backend.host,
      port: config.backend.port,
    },
    "backend_started",
  );

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
    logger.fatal(
      {
        errorMessage: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
      },
      "backend_start_failed",
    );
    process.exit(1);
  });
}
