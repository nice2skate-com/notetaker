import Anthropic from "@anthropic-ai/sdk";
import { accessToken, functionUrl, publishableKey, signedIn } from "./cloud";
import type { Meeting, Settings, Summary } from "./types";

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items: unknown) => ({ type: "array", items });

const SCHEMA = obj({
  title: str,
  overview: str,
  key_points: list(str),
  decisions: list(obj({ decision: str, rationale: str, owner: str })),
  schedule: list(obj({ title: str, date: str, time: str, date_text: str, participants: str, notes: str })),
  follow_ups: list(
    obj({ task: str, owner: str, due_date: str, due_text: str, priority: { type: "string", enum: ["hoch", "mittel", "niedrig"] } })
  ),
  open_questions: list(str),
  speaker_names: list(obj({ label: str, name: str })),
});

// DJ booking conversations get an extra, structured event briefing.
const EVENT = obj({
  event_type: str,
  date: str,
  date_text: str,
  start_time: str,
  end_time: str,
  location: str,
  guest_count: str,
  contacts: list(obj({ name: str, role: str, contact: str })),
  timeline: list(obj({ time: str, item: str })),
  special_moments: list(obj({ moment: str, song: str })),
  music_style: str,
  must_play: list(str),
  do_not_play: list(str),
  logistics: list(str),
  fee: str,
});
const DJ_SCHEMA = { ...SCHEMA, properties: { ...SCHEMA.properties, event: EVENT }, required: [...SCHEMA.required, "event"] };

const DJ_SYSTEM = `

Dieses Gespräch ist ein Vorgespräch von DJ Kolja (DJ KOLJA ONE) mit Kunden zu einer Veranstaltung – meist einer Hochzeit, eines Geburtstags oder einer Firmenfeier. Fülle zusätzlich das Feld event; es ist Koljas Arbeitsblatt für den Abend und muss vollständig und genau sein:
- event_type: Art der Veranstaltung. date als JJJJ-MM-TT (date_text wie gesagt), start_time und end_time als HH:MM, soweit genannt. location: Name und Ort der Location. guest_count: Gästezahl wie genannt.
- contacts: Ansprechpartner mit Rolle (Brautpaar, Trauzeugin, Veranstalter, Location, Fotograf …) und Kontaktangabe, falls genannt.
- timeline: der Ablauf des Abends in zeitlicher Reihenfolge (Sektempfang, Essen, Reden, Eröffnungstanz, Torte, Mitternachtssnack …). time als HH:MM oder wie gesagt.
- special_moments: besondere Momente mit dem gewünschten Lied (Einzug, Eröffnungstanz, Tortenanschnitt, letzter Song …). song mit Interpret, wie genannt; leer, wenn noch offen.
- music_style: gewünschte Stilrichtung und Stimmung, Altersmischung der Gäste, Lautstärke beim Essen – in wenigen Sätzen.
- must_play: ausdrückliche Musikwünsche. do_not_play: ausdrückliche No-Gos (Lieder, Interpreten, Genres).
- logistics: Technik und Organisatorisches für den DJ (Aufbauzeit, Strom, Mikrofon für Reden, Licht, Parken, Essen für den DJ, Ansprechpartner vor Ort …).
- fee: Gage, Anzahlung oder Preisabsprachen, wie genannt.
Unbekanntes bleibt leer; erfinde keine Musikwünsche. Zum Abend gehörige Uhrzeiten stehen im timeline; in schedule kommen nur Termine außerhalb des Abends (Folgetreffen, Fristen für Playlisten, Zahlungen).`;

const SYSTEM = `Du erstellst Besprechungsprotokolle für den beruflichen Alltag. Du bekommst das Transkript eines Gesprächs mit Sprecherkennzeichnung und lieferst ein Protokoll, das jemand, der nicht dabei war, in zwei Minuten lesen und danach handeln kann.

Das Transkript stammt aus automatischer Spracherkennung: Rechne mit Hörfehlern, falsch geschriebenen Namen und gelegentlich falsch zugeordneten Sprechern, und erschließe das Gemeinte aus dem Zusammenhang. Halte dich an das, was gesagt wurde – erfinde keine Entscheidungen, Termine, Zuständigen oder Fristen. Wo etwas offen blieb, gehört es in die offenen Fragen, nicht in die Entscheidungen.

Die Felder:
- title: kurzer, sprechender Titel des Gesprächs.
- overview: Kurzfassung in 3–6 Sätzen: Anlass, wichtigste Ergebnisse, wie es weitergeht.
- key_points: die wesentlichen besprochenen Inhalte, je ein vollständiger Satz.
- decisions: nur, was tatsächlich beschlossen oder verbindlich vereinbart wurde. rationale: die Begründung, soweit genannt. owner: wer entschieden hat bzw. verantwortlich ist.
- schedule: alle genannten Termine, Fristen und Meilensteine in zeitlicher Reihenfolge. date als JJJJ-MM-TT, time als HH:MM; relative Angaben ("nächsten Dienstag") rechnest du anhand des Gesprächsdatums um. date_text gibt die Angabe so wieder, wie sie fiel. Lässt sich kein Datum bestimmen, bleibt date leer.
- follow_ups: jede Aufgabe, die jemand übernommen hat oder die erkennbar erledigt werden muss – konkret und als Handlung formuliert. due_date als JJJJ-MM-TT oder leer, due_text wie gesagt. priority nach Dringlichkeit und Bedeutung im Gespräch. Ein Termin, bei dem man nur dabei ist, steht allein in schedule und wird hier nicht wiederholt; ein Follow-up entsteht nur, wenn etwas zu tun ist – etwa vorbereiten, besorgen, bestätigen, schicken.
- open_questions: ungeklärte Punkte, die eine Antwort oder Entscheidung brauchen.
- speaker_names: Wenn aus dem Gespräch hervorgeht, wie eine als "Sprecher N" gekennzeichnete Person heißt (Anrede, Vorstellung), gib label und name an. Nur bei klarer Zuordnung; sonst weglassen.

Verwende für Personen ihre Namen, wo du sie kennst, sonst die Sprecherkennzeichnung. Unbekannte Angaben bleiben als leerer String stehen. Schreibe in der Sprache des Gesprächs.`;

function mmss(sec: number) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function transcriptText(m: Meeting): string {
  return (m.transcript ?? [])
    .map((u) => `[${mmss(u.start)}] ${m.speakerNames[u.speaker] || u.speaker}: ${u.text}`)
    .join("\n");
}

export async function summarize(meeting: Meeting, settings: Settings): Promise<Summary> {
  // Signed in: requests go to our server function, which adds the Anthropic key; the
  // browser only holds the user's own login token. Signed out: the user's own key,
  // kept on their device, is used directly.
  const client = signedIn()
    ? new Anthropic({
        baseURL: functionUrl("anthropic"),
        apiKey: "held-by-server",
        defaultHeaders: { Authorization: `Bearer ${await accessToken()}`, apikey: publishableKey() },
        dangerouslyAllowBrowser: true,
      })
    : new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true });
  const date = new Date(meeting.createdAt).toLocaleDateString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const me = settings.myName.trim() || "Ich";
  const user = [
    `Gesprächsdatum: ${date} (${new Date(meeting.createdAt).toISOString().slice(0, 10)})`,
    settings.voiceRef
      ? `Die Aufnahme stammt von ${me}; dessen Beiträge sind mit "${me}" gekennzeichnet.`
      : `Die Aufnahme stammt von ${me}; welche Sprecherkennzeichnung zu dieser Person gehört, ist nicht bekannt.`,
    meeting.context.trim() && `Hinweise zum Gespräch:\n${meeting.context.trim()}`,
    `<transkript>\n${transcriptText(meeting)}\n</transkript>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const dj = meeting.kind === "dj";
  let message;
  try {
    message = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: dj ? DJ_SCHEMA : SCHEMA } },
        // If the model declines a request, the API retries it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: dj ? SYSTEM + DJ_SYSTEM : SYSTEM,
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError && !signedIn())
      throw new Error("Anthropic-Schlüssel ungültig. Bitte in den Einstellungen prüfen.");
    if (e instanceof Anthropic.RateLimitError)
      throw new Error("Anthropic-Limit erreicht. Bitte in einer Minute erneut versuchen.");
    if (e instanceof Anthropic.APIError) throw new Error(`Zusammenfassung fehlgeschlagen (${e.status}): ${e.message}`);
    throw e;
  }

  if (message.stop_reason === "refusal") throw new Error("Die Zusammenfassung wurde vom Modell abgelehnt.");
  if (message.stop_reason === "max_tokens") throw new Error("Die Zusammenfassung wurde zu lang und abgeschnitten.");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as Summary;
}
