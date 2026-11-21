import { useEffect, useState } from "react";
import { listMeetings, putMeeting } from "./lib/db";
import { download, fmtDate } from "./lib/export";
import type { FollowUp, Meeting } from "./lib/types";

interface Task {
  m: Meeting;
  i: number;
  f: FollowUp;
}
const today = () => new Date().toLocaleDateString("sv-SE"); // yyyy-mm-dd in local time

/** Every follow-up from every meeting in one list, soonest first. */
export default function TasksView({ rev, onOpen, onBack }: { rev: number; onOpen: (id: string) => void; onBack: () => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    listMeetings().then(setMeetings);
  }, [rev]);

  const all: Task[] = meetings.flatMap((m) => (m.summary?.follow_ups ?? []).map((f, i) => ({ m, i, f })));
  const open = all.filter((t) => !t.m.done[t.i]);
  // Dated tasks first by date, then undated ones by priority.
  const rank = { hoch: 0, mittel: 1, niedrig: 2 };
  const shown = (showDone ? all : open).sort(
    (a, b) => (a.f.due_date || "9999").localeCompare(b.f.due_date || "9999") || rank[a.f.priority] - rank[b.f.priority]
  );

  const toggle = async (t: Task, done: boolean) => {
    const next = { ...t.m, done: { ...t.m.done, [t.i]: done } };
    await putMeeting(next);
    setMeetings((ms) => ms.map((x) => (x.id === next.id ? next : x)));
  };
  const csv = () => {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [["Aufgabe", "Verantwortlich", "Fällig", "Priorität", "Status", "Gespräch"]];
    for (const t of shown)
      rows.push([t.f.task, t.f.owner, fmtDate(t.f.due_date) || t.f.due_text, t.f.priority, t.m.done[t.i] ? "erledigt" : "offen", t.m.title]);
    download(new File(["﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n")], `Follow-ups ${today()}.csv`, { type: "text/csv" }));
  };

  return (
    <main>
      <header>
        <button className="ghost" onClick={onBack}>‹ Zurück</button>
        <h1>Aufgaben</h1>
      </header>
      <div className="row wrap">
        <span className="muted">{open.length} offen</span>
        <label className="check inline">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Erledigte anzeigen
        </label>
        {!!shown.length && <button onClick={csv}>Als CSV speichern</button>}
      </div>
      {!shown.length && <p className="muted">Keine offenen Aufgaben.</p>}
      <section className="scroll">
        {!!shown.length && (
          <table>
            <thead><tr><th></th><th>Aufgabe</th><th>Verantwortlich</th><th>Fällig</th><th>Priorität</th><th>Gespräch</th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const overdue = !t.m.done[t.i] && !!t.f.due_date && t.f.due_date < today();
                return (
                  <tr key={t.m.id + t.i} className={t.m.done[t.i] ? "done" : ""}>
                    <td><input type="checkbox" checked={!!t.m.done[t.i]} aria-label="Erledigt" onChange={(e) => toggle(t, e.target.checked)} /></td>
                    <td data-l="Aufgabe">{t.f.task}</td>
                    <td data-l="Verantwortlich">{t.f.owner}</td>
                    <td data-l="Fällig" className={"nowrap" + (overdue ? " overdue" : "")}>{fmtDate(t.f.due_date) || t.f.due_text}{overdue && " · überfällig"}</td>
                    <td data-l="Priorität"><span className={"prio " + t.f.priority}>{t.f.priority}</span></td>
                    <td data-l="Gespräch"><a href="#" onClick={(e) => (e.preventDefault(), onOpen(t.m.id))}>{t.m.title}</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
