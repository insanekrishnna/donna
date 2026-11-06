import type { RequestHandler } from "express";
import { AppError } from "./errors.js";

/**
 * Per-IP fixed-window rate limit, in memory (one server instance, like the MVP store).
 * Over the limit: 429 RATE_LIMITED with a Retry-After header.
 *
 * Behind a hosting proxy (Render), app.ts sets "trust proxy" in production so req.ip is the
 * client's address, not the proxy's.
 */
export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Plain-language message for the 429. */
  message: string;
  now?: () => number;
}

export function rateLimit({ windowMs, max, message, now = Date.now }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();

  return (req, res, next) => {
    const t = now();
    // Drop expired windows now and then, so the map cannot grow without bound.
    if (t - lastSweep > windowMs) {
      for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
      lastSweep = t;
    }

    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - t) / 1000)));
      next(new AppError(429, "RATE_LIMITED", message));
      return;
    }
    next();
  };
}
