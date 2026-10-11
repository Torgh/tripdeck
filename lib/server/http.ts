import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "./errors";

export { HttpError };

/**
 * Parses and validates a JSON body, turning schema errors into a 400. Requiring the JSON content
 * type also blocks cross-site form posts (they can't set it without a CORS preflight).
 */
export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, `Invalid request: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Settings, tokens and trips live on this machine: only accept requests addressed to localhost
 * (defeats DNS rebinding) and coming from this app's own pages.
 */
export function assertLocal(req: Request) {
  const host = new URL(req.url).hostname;
  const hostHeader = req.headers.get("host")?.replace(/:\d+$/, "") ?? "";
  if (!LOCAL_HOSTS.has(host) || !LOCAL_HOSTS.has(hostHeader)) {
    throw new HttpError(403, "This endpoint is only available on localhost.");
  }
  const origin = req.headers.get("origin");
  if (origin && !LOCAL_HOSTS.has(new URL(origin).hostname)) throw new HttpError(403, "Cross-site request blocked.");
}

/** Wraps a route handler so thrown errors become `{ error }` JSON responses. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const result = await fn(req, ctx);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    }
  };
}

function errorStatus(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err instanceof Anthropic.RateLimitError) return 429;
  if (err instanceof Anthropic.AuthenticationError) return 503;
  return 500;
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude API authentication failed – check the API key in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Claude API rate limit reached – try again in a moment.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`;
  console.error(err);
  return "Unexpected server error.";
}

export const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
