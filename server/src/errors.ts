import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/**
 * Plain-language summary of validation problems: "name: must be at least 3 characters; skills: ...".
 * Uses only each issue's path and message, never `issue.input`, so submitted values are not echoed.
 */
export function formatZodIssues(error: ZodError): string {
  const parts = error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return [...new Set(parts)].join("; ");
}

/** Every API error has this shape (ARCHITECTURE.md section 5). */
export interface ApiErrorBody {
  error: string;
  code: string;
}

/**
 * An error that is safe to show to the user. `message` must be plain language
 * and must never contain secrets, stack traces, or raw partner responses.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: "This route does not exist.", code: "NOT_FOUND" };
  res.status(404).json(body);
};

/** Express errors raised before our code runs, such as a malformed JSON body. */
interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
}

/** Env variables whose values are secrets and must never appear in logs or responses. */
export const SECRET_ENV_NAMES = [
  "LLM_API_KEY",
  "HEDERA_MERCHANT_PRIVATE_KEY",
  "HEDERA_AGENT_PRIVATE_KEY",
  "ARKIV_ACCESS_KEY",
  "ARKIV_SERVER_PRIVATE_KEY",
] as const;

/**
 * Replace each secret value in a message with "[redacted]", in its raw, URL-encoded and
 * un-prefixed (no 0x) forms. Partner errors often embed the request URL, which can hold a key.
 */
export function redactSecretValues(message: string, secrets: readonly (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), secret.replace(/^0x/, "")])) {
      if (form.length >= 8) out = out.split(form).join("[redacted]");
    }
  }
  return out;
}

/** Redact every secret currently set in process.env. */
export function redactProcessSecrets(message: string): string {
  return redactSecretValues(
    message,
    SECRET_ENV_NAMES.map((name) => process.env[name]),
  );
}

/**
 * Log only the error's name and message, redacted, in every environment. Full error objects from
 * partner SDKs or fetch can carry request headers (API keys) and must never reach the logs.
 */
function logUnexpected(err: unknown): void {
  if (err instanceof Error) {
    console.error(redactProcessSecrets(`Unhandled error: ${err.name}: ${err.message}`));
  } else {
    console.error("Unhandled error: non-Error value thrown");
  }
}

export function createErrorHandler(): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiErrorBody);
      return;
    }

    // Validation that ran below the route layer (for example, inside an integration) is still bad input.
    if (err instanceof ZodError) {
      res.status(400).json({ error: formatZodIssues(err), code: "INVALID_INPUT" } satisfies ApiErrorBody);
      return;
    }

    const httpErr = (typeof err === "object" && err !== null ? err : {}) as HttpLikeError;
    if (httpErr.type === "entity.parse.failed") {
      res.status(400).json({ error: "The request body is not valid JSON.", code: "INVALID_JSON" } satisfies ApiErrorBody);
      return;
    }
    if (httpErr.type === "entity.too.large") {
      res.status(413).json({ error: "The request body is too large.", code: "PAYLOAD_TOO_LARGE" } satisfies ApiErrorBody);
      return;
    }

    // Unexpected error: log name and message on the server, return a generic message. Never send the stack to the client.
    logUnexpected(err);
    const status = httpErr.status ?? httpErr.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: "The request could not be processed.", code: "BAD_REQUEST" } satisfies ApiErrorBody);
      return;
    }
    res
      .status(500)
      .json({ error: "Something went wrong on the server. Please try again.", code: "INTERNAL_ERROR" } satisfies ApiErrorBody);
  };
}
