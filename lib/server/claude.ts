import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { z } from "zod";
import { readConfig } from "./config";
import { HttpError } from "./errors";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type BetaContent = Anthropic.Beta.BetaContentBlockParam[] | string;

/** Models that accept the server-side `fallbacks: "default"` refusal fallback. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

let client: { key: string; anthropic: Anthropic } | undefined;

/** True when an Anthropic API key is set (Settings page or ANTHROPIC_API_KEY). */
export function aiConfigured(): boolean {
  return !!readConfig().anthropicApiKey;
}

function getClient(): Anthropic {
  const key = readConfig().anthropicApiKey;
  if (!key) {
    throw new HttpError(503, "In-app AI needs an Anthropic API key (Settings). Or plan through Claude via MCP.");
  }
  // Re-create the client when the key is changed in Settings.
  if (client?.key !== key) client = { key, anthropic: new Anthropic({ apiKey: key }) };
  return client.anthropic;
}

/**
 * When a safety classifier declines a (benign) request, the API re-runs it on Anthropic's
 * recommended fallback model instead of failing. Disable with AI_FALLBACKS=off.
 */
function fallbackParams() {
  if (process.env.AI_FALLBACKS === "off" || !FALLBACK_MODELS.has(MODEL)) return {};
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

/**
 * Errors thrown before a request reaches the API (e.g. no credentials configured) are plain
 * Errors; surface their message instead of a generic 500. API errors are mapped in http.ts.
 */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Anthropic.AnthropicError || err instanceof HttpError || !(err instanceof Error)) throw err;
    console.error("Claude request failed before reaching the API:", err);
    throw new HttpError(503, "Claude is not configured on the server – set ANTHROPIC_API_KEY.");
  }
}

function assertUsable(message: Anthropic.Beta.BetaMessage) {
  if (message.stop_reason === "refusal") {
    throw new HttpError(422, "Claude declined this request. Try rephrasing it.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new HttpError(502, "Claude's answer was cut off. Try a smaller request.");
  }
}

function parseJsonOutput<S extends z.ZodType>(message: Anthropic.Beta.BetaMessage, schema: S): z.infer<S> {
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(502, "Claude returned an unreadable answer. Please try again.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(502, "Claude's answer did not match the expected format.");
  return parsed.data;
}

/** One request whose answer is constrained to `schema` (structured outputs). */
export async function structured<S extends z.ZodType>(opts: {
  system: string;
  content: BetaContent;
  schema: S;
  effort: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const message = await call(() =>
    getClient().beta.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      ...fallbackParams(),
    }),
  );
  assertUsable(message);
  return parseJsonOutput(message, opts.schema);
}

/**
 * Lets Claude call `tools` (searching Google Places etc.) until it is ready, then returns its
 * final answer constrained to `schema`.
 */
export async function agent<S extends z.ZodType>(opts: {
  system: string;
  content: BetaContent;
  tools: BetaRunnableTool[];
  schema: S;
  effort: Effort;
  maxIterations?: number;
}): Promise<z.infer<S>> {
  const message = await call(async () =>
    getClient().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      tools: opts.tools,
      max_iterations: opts.maxIterations ?? 8,
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      ...fallbackParams(),
    }),
  );
  assertUsable(message);
  return parseJsonOutput(message, opts.schema);
}
