import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError, redactSecretValues } from "../errors.js";

/**
 * LLM inference through an OpenAI-compatible endpoint (OpenRouter for now), using the `openai` SDK.
 *
 * Rules:
 * - Every response is validated with Zod before use. A missing or empty answer is an error,
 *   never replaced with placeholder text.
 * - `requestId` is the completion `id` from the real response body (OpenRouter: `gen-...`).
 *   It is null when the provider sends none. It is never invented.
 * - Errors become plain-language AppErrors. Raw provider messages are not passed to users.
 */

/** Per-request timeout. The SDK retries a timed-out request once (maxRetries below). */
export const LLM_TIMEOUT_MS = 60_000;
/** One retry, done by the SDK on connection errors, timeouts, 408, 409, 429 and 5xx. */
export const LLM_MAX_RETRIES = 1;
/**
 * Upper bound on generated tokens per call, so one call cannot run up a large bill. Reasoning
 * models count their hidden reasoning against this limit too, so it leaves room for both.
 */
export const LLM_MAX_TOKENS = 6000;

export interface CompletionInput {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  /** The provider's completion ID from the response body, or null if it sent none. */
  requestId: string | null;
  /** The model that actually answered, as reported by the provider. */
  model: string | null;
}

export interface LlmService {
  /** List the provider's models once and confirm LLM_MODEL is among them. Throws AppError if not. */
  checkModel(): Promise<void>;
  complete(input: CompletionInput): Promise<CompletionResult>;
}

/** The parts of a chat completion we use. Everything else in the body is ignored. */
const completionSchema = z.object({
  id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

/** Turn any SDK or validation error into a safe, plain-language AppError. */
export function describeLlmError(err: unknown, secrets: readonly (string | undefined)[] = []): AppError {
  if (err instanceof AppError) return err;
  // Timeout is a subclass of connection error, so check it first.
  if (err instanceof APIConnectionTimeoutError) {
    return new AppError(504, "LLM_TIMEOUT", "The AI provider did not answer in time. Please try again.");
  }
  if (err instanceof APIConnectionError) {
    return new AppError(502, "LLM_UNREACHABLE", "The server could not reach the AI provider. Check the network and LLM_BASE_URL.");
  }
  if (err instanceof APIError) {
    switch (err.status) {
      case 401:
      case 403:
        return new AppError(502, "LLM_AUTH_FAILED", "The AI provider rejected the API key. Check LLM_API_KEY.");
      case 402:
        return new AppError(502, "LLM_NO_CREDITS", "The AI provider account has no credits left for this model.");
      case 404:
        return new AppError(502, "LLM_MODEL_NOT_FOUND", "The AI provider does not offer the model set in LLM_MODEL.");
      case 429:
        return new AppError(503, "LLM_RATE_LIMITED", "The AI provider is rate limiting requests. Please wait and try again.");
      default:
        return new AppError(502, "LLM_ERROR", `The AI provider returned an error (HTTP ${err.status ?? "unknown"}).`);
    }
  }
  if (err instanceof z.ZodError) {
    return new AppError(502, "LLM_BAD_RESPONSE", "The AI provider sent a response in an unexpected format.");
  }
  // Unknown error: log the redacted name and message on the server only.
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : "non-Error value thrown";
  console.error(redactSecretValues(`LLM call failed: ${detail}`, secrets));
  return new AppError(502, "LLM_ERROR", "The AI call failed unexpectedly.");
}

export interface LlmServiceOptions {
  timeoutMs?: number;
}

/** Requires LLM_API_KEY and LLM_MODEL. Callers gate on missingCredentials() first. */
export function createLlmService(config: Config, options: LlmServiceOptions = {}): LlmService {
  const apiKey = config.LLM_API_KEY;
  const model = config.LLM_MODEL;
  if (!apiKey || !model) {
    throw new AppError(503, "LLM_NOT_CONFIGURED", "The AI provider is not configured on the server.");
  }
  const secrets = [apiKey];

  const client = new OpenAI({
    apiKey,
    baseURL: config.LLM_BASE_URL,
    timeout: options.timeoutMs ?? LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
    // Keep the SDK quiet: its debug logs can include request details.
    logLevel: "off",
  });

  return {
    async checkModel() {
      try {
        for await (const m of client.models.list()) {
          if (m.id === model) return;
        }
      } catch (err) {
        throw describeLlmError(err, secrets);
      }
      throw new AppError(502, "LLM_MODEL_NOT_FOUND", "The AI provider does not offer the model set in LLM_MODEL.");
    },

    async complete({ system, user, maxTokens = LLM_MAX_TOKENS }) {
      let raw: unknown;
      try {
        raw = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: Math.min(maxTokens, LLM_MAX_TOKENS),
        });
      } catch (err) {
        throw describeLlmError(err, secrets);
      }

      const parsed = completionSchema.safeParse(raw);
      if (!parsed.success) throw describeLlmError(parsed.error, secrets);

      // The schema requires at least one choice.
      const choice = parsed.data.choices[0];
      const text = choice?.message.content?.trim() ?? "";
      if (!text) {
        if (choice?.finish_reason === "length") {
          throw new AppError(
            502,
            "LLM_LENGTH_LIMIT",
            "The AI model used its whole length limit before answering. Try again, or use a model that reasons less.",
          );
        }
        throw new AppError(502, "LLM_EMPTY_RESPONSE", "The AI provider returned an empty answer.");
      }
      return { text, requestId: parsed.data.id ?? null, model: parsed.data.model ?? null };
    },
  };
}
