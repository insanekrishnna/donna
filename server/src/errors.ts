import type { ErrorRequestHandler, RequestHandler } from "express";

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

/**
 * Log only the error's name and message, in every environment. Full error objects from
 * partner SDKs or fetch can carry request headers (API keys) and must never reach the logs.
 */
function logUnexpected(err: unknown): void {
  if (err instanceof Error) {
    console.error(`Unhandled error: ${err.name}: ${err.message}`);
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
