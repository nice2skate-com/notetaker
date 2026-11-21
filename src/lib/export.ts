import type { EventBriefing, Meeting } from "./types";
import { transcriptText } from "./summarize";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
const when = (iso: string, time: string, text: string) =>
  [fmtDate(iso) || text, time].filter(Boolean).join(", ") || "offen";
/** "12 Min." for meetings, "0:23 Min." for short notes. */
const length = (m: Meeting) => {
  const sec = Math.round(m.durationMs / 1000);
  return sec < 60 ? `0:${String(sec).padStart(2, "0")} Min.` : `${Math.round(sec / 60)} Min.`;
};
const meetingDate = (m: Meeting) =>
  new Date(m.createdAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" });

/** Key facts of an event as label/value pairs, leaving out what is unknown. */
export function eventFacts(e: EventBriefing): [string, string][] {
  const time = [e.start_time, e.end_time].filter(Boolean).join(" – ");
  const pairs: [string, string][] = [
    ["Anlass", e.event_type],
    ["Datum", fmtDate(e.date) || e.date_text],
    ["Uhrzeit", time],
    ["Location", e.location],
    ["Gäste", e.guest_count],
    ["Gage", e.fee],
  ];
  return pairs.filter(([, v]) => v.trim());
}

function eventMarkdown(e: EventBriefing): string[] {
  const L: string[] = ["## Event", ...eventFacts(e).map(([k, v]) => `- ${k}: ${v}`), ""];
  if (e.contacts.length) L.push("## Ansprechpartner", ...e.contacts.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.contact ? `: ${c.contact}` : ""}`), "");
  if (e.timeline.length) L.push("## Ablauf", ...e.timeline.map((t) => `- ${t.time ? t.time + " " : ""}${t.item}`), "");
  if (e.special_moments.length) L.push("## Besondere Momente", ...e.special_moments.map((t) => `- ${t.moment}: ${t.song || "noch offen"}`), "");
  if (e.music_style) L.push("## Musik & Stimmung", e.music_style, "");
  if (e.must_play.length) L.push("## Musikwünsche", ...e.must_play.map((p) => `- ${p}`), "");
  if (e.do_not_play.length) L.push("## No-Gos", ...e.do_not_play.map((p) => `- ${p}`), "");
  if (e.logistics.length) L.push("## Technik & Organisation", ...e.logistics.map((p) => `- ${p}`), "");
  return L;
}

/** Plain text / Markdown – used for e-mail bodies and .md download. */
export function toMarkdown(m: Meeting, withTranscript = false): string {
  const s = m.summary;
  const L: string[] = [`# ${m.title}`, `${meetingDate(m)} · Dauer ${length(m)}`, ""];
  if (s) {
    L.push("## Zusammenfassung", s.overview, "");
    if (s.event) L.push(...eventMarkdown(s.event));
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
// Brand colours for documents. Gold on white is too faint for text, so headings use a darker gold.
const INK = "#0F0C07";
const GOLD = "#B29D75";
const GOLD_TEXT = "#7A6640";
const CREAM = "#F3F1E9";
const MUTED = "#6F685C";
const FONT = "'Fira Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The protocol as a self-contained HTML block in the DJ KOLJA ONE design. Used for the e-mail,
 * the clipboard, the HTML file and printing, so everything is inline-styled and table-based:
 * mail programs drop style sheets and handle tables far better than modern layout.
 */
export function toHtml(m: Meeting, withTranscript = false): string {
  const s = m.summary;
  const logo = typeof location !== "undefined" ? `${location.origin}/logo-mail.png` : "logo-mail.png";
  const cell = `border-bottom:1px solid #E4DFD3;padding:9px 10px;text-align:left;vertical-align:top;font-size:14px;color:${INK}`;
  const h2 = (t: string) =>
    `<tr><td style="padding:26px 0 8px"><div style="font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${GOLD_TEXT};border-bottom:1px solid ${GOLD};padding-bottom:6px">${t}</div></td></tr>`;
  const row = (html: string) => `<tr><td style="font-size:15px;line-height:1.6;color:${INK}">${html}</td></tr>`;
  const list = (items: string[]) =>
    row(`<ul style="margin:0;padding-left:20px">${items.map((p) => `<li style="margin:5px 0">${esc(p)}</li>`).join("")}</ul>`);
  const table = (head: string[], rows: string[][]) =>
    row(
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><thead><tr>${head
        .map((h) => `<th style="${cell};background:${CREAM};font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD_TEXT}">${h}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c, i) => `<td style="${cell}${i ? "" : ";font-weight:500"}">${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`
    );

  const body: string[] = [
    `<tr><td style="padding:4px 0 2px;font-size:24px;line-height:1.3;font-weight:400;color:${INK}">${esc(m.title)}</td></tr>`,
    `<tr><td style="font-size:13px;color:${MUTED};padding-bottom:4px">${esc(meetingDate(m))} · Dauer ${length(m)}</td></tr>`,
  ];
  if (s) {
    body.push(h2("Zusammenfassung"), row(esc(s.overview)));
    if (s.event) {
      const e = s.event;
      const facts = eventFacts(e);
      if (facts.length)
        body.push(
          h2("Event"),
          row(
            `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${facts
              .map(([k, v]) => `<tr><td style="${cell};width:32%;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD_TEXT}">${k}</td><td style="${cell}">${esc(v)}</td></tr>`)
              .join("")}</table>`
          )
        );
      if (e.contacts.length) body.push(h2("Ansprechpartner"), table(["Name", "Rolle", "Kontakt"], e.contacts.map((c) => [c.name, c.role, c.contact])));
      if (e.timeline.length) body.push(h2("Ablauf"), table(["Zeit", "Programmpunkt"], e.timeline.map((t) => [t.time, t.item])));
      if (e.special_moments.length) body.push(h2("Besondere Momente"), table(["Moment", "Song"], e.special_moments.map((t) => [t.moment, t.song || "noch offen"])));
      if (e.music_style) body.push(h2("Musik & Stimmung"), row(esc(e.music_style)));
      if (e.must_play.length) body.push(h2("Musikwünsche"), list(e.must_play));
      if (e.do_not_play.length) body.push(h2("No-Gos"), list(e.do_not_play));
      if (e.logistics.length) body.push(h2("Technik & Organisation"), list(e.logistics));
    }
    if (s.key_points.length) body.push(h2("Kernpunkte"), list(s.key_points));
    if (s.decisions.length)
      body.push(h2("Entscheidungen"), table(["Entscheidung", "Begründung", "Verantwortlich"], s.decisions.map((d) => [d.decision, d.rationale, d.owner])));
    if (s.schedule.length)
      body.push(h2("Terminplan"), table(["Wann", "Was", "Wer", "Hinweis"], s.schedule.map((t) => [when(t.date, t.time, t.date_text), t.title, t.participants, t.notes])));
    if (s.follow_ups.length)
      body.push(
        h2("Follow-ups"),
        table(
          ["Aufgabe", "Verantwortlich", "Fällig", "Priorität", "Status"],
          s.follow_ups.map((f, i) => [f.task, f.owner, when(f.due_date, "", f.due_text), f.priority, m.done[i] ? "erledigt" : "offen"])
        )
      );
    if (s.open_questions.length) body.push(h2("Offene Fragen"), list(s.open_questions));
  }
  if (withTranscript && m.transcript?.length)
    body.push(h2("Transkript"), row(`<span style="font-size:13px;color:#3A352C">${esc(transcriptText(m)).replace(/\n/g, "<br>")}</span>`));

  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:${CREAM};font-family:${FONT};-webkit-print-color-adjust:exact;print-color-adjust:exact">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;border-collapse:collapse;background:#FFFFFF">
<tr><td style="background:${INK};padding:22px 28px;border-bottom:3px solid ${GOLD}">
<img src="${logo}" width="260" height="33" alt="DJ KOLJA ONE" style="display:block;border:0;width:260px;max-width:100%;height:auto;color:${CREAM};font-size:20px;letter-spacing:3px">
<div style="margin-top:8px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:${GOLD}">Gesprächsprotokoll</div>
</td></tr>
<tr><td style="padding:22px 28px 30px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${body.join("\n")}</table>
</td></tr>
<tr><td style="background:${INK};padding:14px 28px;font-size:11px;letter-spacing:1px;color:#A39E93">Erstellt mit Notetaker · DJ KOLJA ONE</td></tr>
</table>
</td></tr>
</table>`;
}

export function toHtmlDocument(m: Meeting): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(m.title)}</title></head><body style="margin:0;background:#F3F1E9">${toHtml(m, true)}</body></html>`;
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
  const e = m.summary?.event;
  if (e?.date)
    add(
      "event",
      [e.event_type || "Event", e.location].filter(Boolean).join(" – "),
      e.date,
      e.start_time,
      [e.contacts.map((c) => [c.name, c.role].filter(Boolean).join(", ")).join("; "), `Aus: ${m.title}`].filter(Boolean).join("\n")
    );
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

/** Plain-text version for mail bodies: Markdown headings become capitalised lines, CR+LF line breaks. */
export function toPlain(m: Meeting): string {
  return toMarkdown(m)
    .replace(/^# /m, "")
    .replace(/^## (.*)$/gm, (_, h: string) => h.toUpperCase())
    .replace(/^- \[x\] /gm, "- (erledigt) ")
    .replace(/^- \[ \] /gm, "- ")
    .replace(/\n/g, "\r\n");
}

/**
 * Link that opens a new e-mail in the user's own mail program. A mail link can only carry
 * plain text, and web mailers (Yahoo, Gmail in the browser) even drop its line breaks, so by
 * default the body stays empty and the formatted protocol is pasted from the clipboard
 * instead. `withBody` is the fallback for when the clipboard is not available.
 */
export function mailtoUrl(m: Meeting, to: string, withBody = false): string {
  const body = withBody ? `&body=${encodeURIComponent(toPlain(m))}` : "";
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Protokoll: " + m.title)}${body}`;
}

/** Everything the server needs to send the protocol as a formatted e-mail with attachments. */
export function mailPayload(m: Meeting, to: string[], withTranscript: boolean) {
  const base = safeName(m);
  const attachments = [];
  if (m.summary?.follow_ups.length) attachments.push({ filename: `${base} Follow-ups.csv`, content: followUpsCsv(m), contentType: "text/csv; charset=utf-8" });
  const ics = toIcs(m);
  if (ics) attachments.push({ filename: `${base}.ics`, content: ics, contentType: "text/calendar; charset=utf-8" });
  return {
    to,
    subject: "Protokoll: " + m.title,
    html: toHtml(m, withTranscript),
    text: withTranscript ? toMarkdown(m, true).replace(/\n/g, "\r\n") : toPlain(m),
    attachments,
  };
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
