import { pino, type Logger, type LoggerOptions } from "pino";

export interface FoundryLoggerOptions {
  service: string;
  bindings?: Record<string, unknown>;
  level?: string;
}

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

function resolveEnvVar(name: string): string | undefined {
  const value = (globalThis as { process?: ProcessLike }).process?.env?.[name];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultLevel(): string {
  return resolveEnvVar("FOUNDRY_LOG_LEVEL") ?? resolveEnvVar("LOG_LEVEL") ?? resolveEnvVar("RIVET_LOG_LEVEL") ?? "info";
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function createFoundryLogger(options: FoundryLoggerOptions): Logger {
  const browser = isBrowserRuntime();
  const loggerOptions: LoggerOptions = {
    level: options.level ?? defaultLevel(),
    base: {
      service: options.service,
      ...(options.bindings ?? {}),
    },
  };

  if (browser) {
    loggerOptions.browser = {
      asObject: true,
    };
  } else {
    loggerOptions.timestamp = pino.stdTimeFunctions.isoTime;
  }

  return pino(loggerOptions);
}

export function createErrorContext(error: unknown): { errorMessage: string; errorStack?: string } {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return {
    errorMessage: String(error),
  };
}
