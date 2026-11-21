import { clipToWavDataUrl, decode } from "./audio";
import { accessToken, functionUrl, publishableKey, signedIn } from "./cloud";
import { getAudio } from "./db";
import type { Meeting, Settings, Utterance } from "./types";

interface ApiSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}
interface KnownSpeaker {
  name: string;
  ref: string; // data URL, 2–10 s of that person speaking
}

const MAX_KNOWN = 4; // API limit for reference clips
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

async function transcribeFile(blob: Blob, settings: Settings, known: KnownSpeaker[]): Promise<ApiSegment[]> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : blob.type.split("/")[1] || "wav";
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "gpt-4o-transcribe-diarize");
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  if (settings.language) form.append("language", settings.language);
  for (const k of known) {
    form.append("known_speaker_names[]", k.name);
    form.append("known_speaker_references[]", k.ref);
  }
  // Signed in: the request goes through our server function, which holds the OpenAI key.
  const res = signedIn()
    ? await fetch(functionUrl("transcribe"), {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, apikey: publishableKey() },
        body: form,
      })
    : await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.openaiKey}` },
        body: form,
      });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message || body?.message || res.statusText;
    if (res.status === 401 && !signedIn()) throw new Error("OpenAI-Schlüssel ungültig. Bitte in den Einstellungen prüfen.");
    throw new Error(`Transkription fehlgeschlagen (${res.status}): ${msg}`);
  }
  const json = await res.json();
  return (json.segments ?? []) as ApiSegment[];
}

/**
 * Transcribe all segments of a meeting. Speakers found in an earlier segment
 * are passed on as voice references, so labels stay consistent over the
 * whole meeting (for up to four people; further speakers may be relabelled
 * from one 8-minute segment to the next).
 */
export async function transcribeMeeting(
  meeting: Meeting,
  settings: Settings,
  onProgress: (done: number, total: number) => void
): Promise<Utterance[]> {
  const me = settings.myName.trim() || "Ich";
  const known: KnownSpeaker[] = settings.voiceRef ? [{ name: me, ref: settings.voiceRef }] : [];
  let nextNumber = known.length + 1;
  const out: Utterance[] = [];
  let offset = 0;

  for (const seg of meeting.segments) {
    onProgress(seg.idx, meeting.segments.length);
    const blob = await getAudio(meeting.id, seg.idx);
    if (!blob) throw new Error("Audiodatei nicht mehr vorhanden.");
    const segments = await transcribeFile(blob, settings, known);

    const local = new Map<string, string>(); // label in this response -> stable label
    for (const k of known) local.set(k.name, k.name);
    const fresh: string[] = [];
    for (const s of segments) {
      if (!local.has(s.speaker)) {
        local.set(s.speaker, `Sprecher ${nextNumber++}`);
        fresh.push(s.speaker);
      }
    }

    // Cut a voice sample for each newly seen speaker, for the following segments.
    const isLast = seg.idx === meeting.segments.length - 1;
    if (fresh.length && !isLast && known.length < MAX_KNOWN) {
      try {
        const buf = await decode(blob);
        for (const label of fresh) {
          if (known.length >= MAX_KNOWN) break;
          const best = segments
            .filter((s) => s.speaker === label)
            .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
          if (!best || best.end - best.start < 2.5) continue;
          const ref = await clipToWavDataUrl(buf, best.start, Math.min(best.end, best.start + 9));
          known.push({ name: local.get(label)!, ref });
        }
      } catch {
        // Without samples the transcript still works; labels may just differ per segment.
      }
    }

    for (const s of segments) {
      const text = s.text.trim();
      if (!text) continue;
      const speaker = local.get(s.speaker)!;
      const prev = out[out.length - 1];
      if (prev && prev.speaker === speaker && s.start + offset - prev.end < 1.5) {
        prev.text += " " + text;
        prev.end = s.end + offset;
      } else {
        out.push({ speaker, start: s.start + offset, end: s.end + offset, text });
      }
    }
    offset += seg.durationMs / 1000;
  }
  onProgress(meeting.segments.length, meeting.segments.length);
  return out;
}
