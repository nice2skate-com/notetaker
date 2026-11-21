// Shared by the proxy functions: CORS and "is this caller allowed to spend our API budget?".

export function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Echo what the browser asks for; the Anthropic SDK sends a varying set of headers.
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(req: Request, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

/**
 * Returns an error response unless the caller is signed in AND listed in ALLOWED_EMAILS.
 * Anyone can register with a Supabase project, so being signed in is not enough to
 * be allowed to use the paid API keys. Without the list, nobody is allowed.
 */
export async function reject(req: Request): Promise<Response | null> {
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return json(req, 503, "ALLOWED_EMAILS ist in den Supabase-Secrets nicht gesetzt.");
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!res.ok) return json(req, 401, "Nicht angemeldet.");
  const user = await res.json();
  if (!user.email_confirmed_at || !allowed.includes(String(user.email).toLowerCase()))
    return json(req, 403, "Dieses Konto ist für die Auswertung nicht freigeschaltet.");
  return null;
}
