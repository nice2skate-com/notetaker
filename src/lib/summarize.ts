import Anthropic from "@anthropic-ai/sdk";
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

const SYSTEM = `Du erstellst Besprechungsprotokolle für den beruflichen Alltag. Du bekommst das Transkript eines Gesprächs mit Sprecherkennzeichnung und lieferst ein Protokoll, das jemand, der nicht dabei war, in zwei Minuten lesen und danach handeln kann.

Das Transkript stammt aus automatischer Spracherkennung: Rechne mit Hörfehlern, falsch geschriebenen Namen und gelegentlich falsch zugeordneten Sprechern, und erschließe das Gemeinte aus dem Zusammenhang. Halte dich an das, was gesagt wurde – erfinde keine Entscheidungen, Termine, Zuständigen oder Fristen. Wo etwas offen blieb, gehört es in die offenen Fragen, nicht in die Entscheidungen.

Die Felder:
- title: kurzer, sprechender Titel des Gesprächs.
- overview: Kurzfassung in 3–6 Sätzen: Anlass, wichtigste Ergebnisse, wie es weitergeht.
- key_points: die wesentlichen besprochenen Inhalte, je ein vollständiger Satz.
- decisions: nur, was tatsächlich beschlossen oder verbindlich vereinbart wurde. rationale: die Begründung, soweit genannt. owner: wer entschieden hat bzw. verantwortlich ist.
- schedule: alle genannten Termine, Fristen und Meilensteine in zeitlicher Reihenfolge. date als JJJJ-MM-TT, time als HH:MM; relative Angaben ("nächsten Dienstag") rechnest du anhand des Gesprächsdatums um. date_text gibt die Angabe so wieder, wie sie fiel. Lässt sich kein Datum bestimmen, bleibt date leer.
- follow_ups: jede Aufgabe, die jemand übernommen hat oder die erkennbar erledigt werden muss – konkret und als Handlung formuliert. due_date als JJJJ-MM-TT oder leer, due_text wie gesagt. priority nach Dringlichkeit und Bedeutung im Gespräch.
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
  // The key is the user's own and stays on their device, so calling the API
  // straight from the browser is acceptable here.
  const client = new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true });
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

  let message;
  try {
    message = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        // If the model declines a request, the API retries it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
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
