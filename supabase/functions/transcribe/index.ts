// Forwards an audio upload to OpenAI's transcription API with the server-side key.
import { cors, json, reject } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, "Nur POST.");
  const denied = await reject(req);
  if (denied) return denied;
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json(req, 503, "OPENAI_API_KEY ist in den Supabase-Secrets nicht gesetzt.");

  // The multipart body is streamed through unchanged.
  const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": req.headers.get("Content-Type") ?? "" },
    body: req.body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors(req), "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
});
