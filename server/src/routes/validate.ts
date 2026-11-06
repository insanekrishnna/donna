import type { z } from "zod";
import { AppError, formatZodIssues } from "../errors.js";

/** Validate a request body. Throws a 400 INVALID_INPUT AppError naming each bad field. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "INVALID_INPUT", formatZodIssues(result.error));
  return result.data;
}
