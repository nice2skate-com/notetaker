import type { Meeting } from "./types";
import { transcriptText } from "./summarize";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
const when = (iso: string, time: string, text: string) =>
  [fmtDate(iso) || text, time].filter(Boolean).join(", ") || "offen";
const meetingDate = (m: Meeting) =>
  new Date(m.createdAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" });

/** Plain text / Markdown – used for e-mail bodies and .md download. */
export function toMarkdown(m: Meeting, withTranscript = false): string {
  const s = m.summary;
  const L: string[] = [`# ${m.title}`, `${meetingDate(m)} · Dauer ${Math.round(m.durationMs / 60000)} Min.`, ""];
  if (s) {
    L.push("## Zusammenfassung", s.overview, "");
    if (s.key_points.length) L.push("## Kernpunkte", ...s.key_points.map((p) => `- ${p}`), "");
    if (s.decisions.length) {
      L.push("## Entscheidungen");
      s.decisions.forEach((d, i) => {
        L.push(`${i + 1}. ${d.decision}${d.owner ? ` (${d.owner})` : ""}`);
        if (d.rationale) L.push(`   Begründung: ${d.rationale}`);
      });
      L.push("");
    }
    if (s.schedule.length) {
      L.push("## Terminplan");
      for (const t of s.schedule)
        L.push(
          `- ${when(t.date, t.time, t.date_text)}: ${t.title}` +
            (t.participants ? ` – ${t.participants}` : "") +
            (t.notes ? ` (${t.notes})` : "")
        );
      L.push("");
    }
    if (s.follow_ups.length) {
      L.push("## Follow-ups");
      s.follow_ups.forEach((f, i) =>
        L.push(
          `- [${m.done[i] ? "x" : " "}] ${f.task} – ${f.owner || "offen"}, bis ${when(f.due_date, "", f.due_text)}, Priorität ${f.priority}`
        )
      );
      L.push("");
    }
    if (s.open_questions.length) L.push("## Offene Fragen", ...s.open_questions.map((q) => `- ${q}`), "");
  }
  if (withTranscript && m.transcript?.length) L.push("## Transkript", transcriptText(m), "");
  return L.join("\n");
}

/** HTML with real tables – for rich clipboard, .html download and printing to PDF. */
export function toHtml(m: Meeting, withTranscript = false): string {
  const s = m.summary;
  const td = 'style="border:1px solid #cbd5e1;padding:6px 10px;text-align:left;vertical-align:top"';
  const table = (head: string[], rows: string[][]) =>
    `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${head
      .map((h) => `<th ${td}>${h}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td ${td}>${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const H: string[] = [
    `<h1>${esc(m.title)}</h1>`,
    `<p style="color:#64748b">${esc(meetingDate(m))} · Dauer ${Math.round(m.durationMs / 60000)} Min.</p>`,
  ];
  if (s) {
    H.push(`<h2>Zusammenfassung</h2><p>${esc(s.overview)}</p>`);
    if (s.key_points.length) H.push(`<h2>Kernpunkte</h2><ul>${s.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`);
    if (s.decisions.length)
      H.push("<h2>Entscheidungen</h2>", table(["Entscheidung", "Begründung", "Verantwortlich"], s.decisions.map((d) => [d.decision, d.rationale, d.owner])));
    if (s.schedule.length)
      H.push("<h2>Terminplan</h2>", table(["Wann", "Was", "Wer", "Hinweis"], s.schedule.map((t) => [when(t.date, t.time, t.date_text), t.title, t.participants, t.notes])));
    if (s.follow_ups.length)
      H.push(
        "<h2>Follow-ups</h2>",
        table(
          ["Aufgabe", "Verantwortlich", "Fällig", "Priorität", "Status"],
          s.follow_ups.map((f, i) => [f.task, f.owner, when(f.due_date, "", f.due_text), f.priority, m.done[i] ? "erledigt" : "offen"])
        )
      );
    if (s.open_questions.length) H.push(`<h2>Offene Fragen</h2><ul>${s.open_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`);
  }
  if (withTranscript && m.transcript?.length)
    H.push(`<h2>Transkript</h2><p>${esc(transcriptText(m)).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#0f172a">${H.join("\n")}</div>`;
}

export function toHtmlDocument(m: Meeting): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(m.title)}</title></head><body style="max-width:820px;margin:32px auto;padding:0 16px">${toHtml(m, true)}</body></html>`;
}

/** Follow-up table as CSV; semicolon + BOM so German Excel opens it correctly. */
export function followUpsCsv(m: Meeting): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["Aufgabe", "Verantwortlich", "Fällig", "Priorität", "Status", "Gespräch"]];
  m.summary?.follow_ups.forEach((f, i) =>
    rows.push([f.task, f.owner, fmtDate(f.due_date) || f.due_text, f.priority, m.done[i] ? "erledigt" : "offen", m.title])
  );
  return "﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n");
}

/** Calendar file with every dated schedule entry and follow-up deadline. */
export function toIcs(m: Meeting): string {
  const text = (v: string) => v.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = (iso: string, add = 0) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + add);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  };
  const events: string[] = [];
  const add = (uid: string, title: string, date: string, time: string, desc: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const timed = /^\d{2}:\d{2}$/.test(time);
    const start = day(date);
    const [h, min] = timed ? time.split(":").map(Number) : [0, 0];
    const endH = String((h + 1) % 24).padStart(2, "0");
    events.push(
      "BEGIN:VEVENT",
      `UID:${m.id}-${uid}@notetaker`,
      `DTSTAMP:${stamp}`,
      // Floating local time: shown at this clock time in whatever zone the calendar uses.
      timed ? `DTSTART:${start}T${time.replace(":", "")}00` : `DTSTART;VALUE=DATE:${start}`,
      timed
        ? `DTEND:${day(date, h === 23 ? 1 : 0)}T${endH}${String(min).padStart(2, "0")}00`
        : `DTEND;VALUE=DATE:${day(date, 1)}`,
      `SUMMARY:${text(title)}`,
      `DESCRIPTION:${text(desc)}`,
      "END:VEVENT"
    );
  };
  m.summary?.schedule.forEach((t, i) =>
    add(`t${i}`, t.title, t.date, t.time, [t.participants, t.notes, `Aus: ${m.title}`].filter(Boolean).join("\n"))
  );
  m.summary?.follow_ups.forEach((f, i) =>
    add(`f${i}`, `Fällig: ${f.task}`, f.due_date, "", [f.owner && `Verantwortlich: ${f.owner}`, `Aus: ${m.title}`].filter(Boolean).join("\n"))
  );
  if (!events.length) return "";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//notetaker//DE", ...events, "END:VCALENDAR"].join("\r\n");
}

const safeName = (m: Meeting) =>
  `${new Date(m.createdAt).toISOString().slice(0, 10)} ${m.title}`.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80);

export function exportFiles(m: Meeting): File[] {
  const base = safeName(m);
  const files = [new File([toHtmlDocument(m)], `${base}.html`, { type: "text/html" })];
  if (m.summary?.follow_ups.length) files.push(new File([followUpsCsv(m)], `${base} Follow-ups.csv`, { type: "text/csv" }));
  const ics = toIcs(m);
  if (ics) files.push(new File([ics], `${base}.ics`, { type: "text/calendar" }));
  return files;
}

export function download(file: File) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function mailtoUrl(m: Meeting, to: string): string {
  // Mail clients show the body as plain text, so turn Markdown headings into capitalised lines.
  const plain = toMarkdown(m)
    .replace(/^# /m, "")
    .replace(/^## (.*)$/gm, (_, h: string) => h.toUpperCase())
    .replace(/^- \[x\] /gm, "- (erledigt) ")
    .replace(/^- \[ \] /gm, "- ");
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Protokoll: " + m.title)}&body=${encodeURIComponent(plain)}`;
}

/** Share sheet (iOS/macOS: Mail with attachments, AirDrop, Dateien …). Returns false if unsupported. */
export async function share(m: Meeting): Promise<boolean> {
  const files = exportFiles(m);
  const data: ShareData = { title: "Protokoll: " + m.title, text: toMarkdown(m), files };
  if (!navigator.canShare?.(data)) return false;
  try {
    await navigator.share(data);
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
  return true;
}

export async function copyRich(m: Meeting) {
  const html = toHtml(m);
  if (window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([toMarkdown(m)], { type: "text/plain" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(toMarkdown(m));
  }
}

/** Opens the system print dialog with the protocol only ("Als PDF sichern" there gives a PDF). */
export function printProtocol(m: Meeting) {
  const root = document.createElement("div");
  root.id = "print-root";
  root.innerHTML = toHtml(m, true);
  document.body.append(root);
  const title = document.title;
  document.title = safeName(m);
  const done = () => {
    document.title = title;
    root.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
