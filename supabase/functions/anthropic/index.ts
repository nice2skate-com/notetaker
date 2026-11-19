// Forwards Messages API requests from the Anthropic SDK in the browser, adding the server-side key.
// The SDK is pointed at this function as its base URL, so requests arrive as …/anthropic/v1/messages.
import { cors, json, reject } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  if (req.method !== "POST" || !url.pathname.endsWith("/v1/messages")) return json(req, 404, "Nur POST /v1/messages.");
  const denied = await reject(req);
  if (denied) return denied;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(req, 503, "ANTHROPIC_API_KEY ist in den Supabase-Secrets nicht gesetzt.");

  const headers = new Headers({ "x-api-key": key, "Content-Type": "application/json" });
  for (const h of ["anthropic-version", "anthropic-beta"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const upstream = await fetch(`https://api.anthropic.com/v1/messages${url.search}`, { method: "POST", headers, body: req.body });
  // Streamed straight back (server-sent events).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors(req), "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
});
