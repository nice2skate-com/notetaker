// Sends a protocol as a formatted e-mail through the owner's own mailbox (SMTP).
// Secrets: SMTP_USER, SMTP_PASS; optional SMTP_HOST (default smtp.strato.de), SMTP_PORT (default 465,
// the only mail port edge functions may use), MAIL_FROM (default SMTP_USER).
import nodemailer from "npm:nodemailer@6.9.16";
import { cors, json, reject } from "../_shared/auth.ts";

interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}
interface Payload {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const MAX_BYTES = 2_000_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, "Nur POST.");
  const denied = await reject(req);
  if (denied) return denied;

  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) return json(req, 503, "SMTP_USER und SMTP_PASS sind in den Supabase-Secrets nicht gesetzt.");

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json(req, 413, "Die E-Mail ist zu groß.");
  let p: Payload;
  try {
    p = JSON.parse(raw);
  } catch {
    return json(req, 400, "Ungültige Anfrage.");
  }
  const to = (p.to ?? []).map((a) => String(a).trim()).filter(Boolean);
  if (!to.length || to.length > 20 || !to.every((a) => EMAIL.test(a))) return json(req, 400, "Bitte gültige Empfänger-Adressen angeben.");
  if (!p.subject || !p.html) return json(req, 400, "Betreff oder Inhalt fehlt.");

  // Replies should reach the person who sent the protocol, not the sending mailbox.
  const me = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  }).then((r) => r.json());

  const transport = nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.strato.de",
    port: Number(Deno.env.get("SMTP_PORT") ?? 465),
    secure: true,
    auth: { user, pass },
  });
  try {
    await transport.sendMail({
      from: { name: "Notetaker", address: Deno.env.get("MAIL_FROM") ?? user },
      replyTo: me.email,
      to,
      // Strip line breaks so nothing can be smuggled into the mail headers.
      subject: String(p.subject).replace(/[\r\n]+/g, " ").slice(0, 200),
      html: p.html,
      text: p.text,
      attachments: (p.attachments ?? []).slice(0, 5).map((a) => ({
        filename: String(a.filename).replace(/[\r\n"/\\]+/g, " "),
        content: String(a.content),
        contentType: String(a.contentType),
      })),
    });
  } catch (e) {
    return json(req, 502, `Das Postfach hat die E-Mail nicht angenommen: ${(e as Error).message}`);
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors(req), "Content-Type": "application/json" } });
});
