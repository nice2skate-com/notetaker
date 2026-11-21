import type { Decision, EventBriefing, FollowUp, Meeting, ScheduleItem, Summary } from "./lib/types";

const lines = (v: string) => v.split("\n");
const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);

/** Edit form for everything the summary contains. Changes are saved as they are made. */
export default function EditProtocol({ m, onChange }: { m: Meeting; onChange: (m: Meeting) => void }) {
  const s = m.summary!;
  const set = (patch: Partial<Summary>) => onChange({ ...m, summary: { ...s, ...patch } });

  function rows<T>(key: "decisions" | "schedule" | "follow_ups", items: T[]) {
    return {
      update: (i: number, patch: Partial<T>) => set({ [key]: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }),
      add: (item: T) => set({ [key]: [...items, item] }),
      remove: (i: number) => {
        const summary = { ...s, [key]: items.filter((_, j) => j !== i) };
        if (key !== "follow_ups") return onChange({ ...m, summary });
        // The "erledigt" marks are stored by position, so they have to move up with the rows.
        const done: Record<number, boolean> = {};
        items.forEach((_, j) => j !== i && m.done[j] && (done[j > i ? j - 1 : j] = true));
        onChange({ ...m, summary, done });
      },
    };
  }
  const dec = rows<Decision>("decisions", s.decisions);
  const sch = rows<ScheduleItem>("schedule", s.schedule);
  const fu = rows<FollowUp>("follow_ups", s.follow_ups);
  const Remove = ({ onClick }: { onClick: () => void }) => (
    <button className="danger small-btn" onClick={onClick}>Entfernen</button>
  );

  return (
    <section className="edit">
      {s.event && <EditEvent e={s.event} onChange={(event) => set({ event })} />}

      <h3>Zusammenfassung</h3>
      <textarea rows={5} value={s.overview} onChange={(e) => set({ overview: e.target.value })} aria-label="Zusammenfassung" />

      <h3>Kernpunkte <span className="muted small">(einer pro Zeile)</span></h3>
      <textarea rows={Math.max(3, s.key_points.length + 1)} value={s.key_points.join("\n")} aria-label="Kernpunkte"
        onChange={(e) => set({ key_points: lines(e.target.value) })} onBlur={() => set({ key_points: clean(s.key_points) })} />

      <h3>Entscheidungen</h3>
      {s.decisions.map((d, i) => (
        <div className="card" key={i}>
          <input value={d.decision} placeholder="Entscheidung" onChange={(e) => dec.update(i, { decision: e.target.value })} />
          <input value={d.rationale} placeholder="Begründung" onChange={(e) => dec.update(i, { rationale: e.target.value })} />
          <div className="row">
            <input value={d.owner} placeholder="Verantwortlich" onChange={(e) => dec.update(i, { owner: e.target.value })} />
            <Remove onClick={() => dec.remove(i)} />
          </div>
        </div>
      ))}
      <button onClick={() => dec.add({ decision: "", rationale: "", owner: "" })}>+ Entscheidung</button>

      <h3>Termine</h3>
      {s.schedule.map((t, i) => (
        <div className="card" key={i}>
          <input value={t.title} placeholder="Was" onChange={(e) => sch.update(i, { title: e.target.value })} />
          <div className="row">
            <input type="date" value={t.date} aria-label="Datum" onChange={(e) => sch.update(i, { date: e.target.value })} />
            <input type="time" value={t.time} aria-label="Uhrzeit" onChange={(e) => sch.update(i, { time: e.target.value })} />
          </div>
          <input value={t.participants} placeholder="Wer" onChange={(e) => sch.update(i, { participants: e.target.value })} />
          <div className="row">
            <input value={t.notes} placeholder="Hinweis" onChange={(e) => sch.update(i, { notes: e.target.value })} />
            <Remove onClick={() => sch.remove(i)} />
          </div>
        </div>
      ))}
      <button onClick={() => sch.add({ title: "", date: "", time: "", date_text: "", participants: "", notes: "" })}>+ Termin</button>

      <h3>Follow-ups</h3>
      {s.follow_ups.map((f, i) => (
        <div className="card" key={i}>
          <input value={f.task} placeholder="Aufgabe" onChange={(e) => fu.update(i, { task: e.target.value })} />
          <input value={f.owner} placeholder="Verantwortlich" onChange={(e) => fu.update(i, { owner: e.target.value })} />
          <div className="row">
            <input type="date" value={f.due_date} aria-label="Fällig am" onChange={(e) => fu.update(i, { due_date: e.target.value })} />
            <select value={f.priority} aria-label="Priorität" onChange={(e) => fu.update(i, { priority: e.target.value as FollowUp["priority"] })}>
              <option value="hoch">hoch</option>
              <option value="mittel">mittel</option>
              <option value="niedrig">niedrig</option>
            </select>
            <Remove onClick={() => fu.remove(i)} />
          </div>
        </div>
      ))}
      <button onClick={() => fu.add({ task: "", owner: "", due_date: "", due_text: "", priority: "mittel" })}>+ Follow-up</button>

      <h3>Offene Fragen <span className="muted small">(eine pro Zeile)</span></h3>
      <textarea rows={Math.max(3, s.open_questions.length + 1)} value={s.open_questions.join("\n")} aria-label="Offene Fragen"
        onChange={(e) => set({ open_questions: lines(e.target.value) })} onBlur={() => set({ open_questions: clean(s.open_questions) })} />
    </section>
  );
}

// Structured lists are edited as text, one entry per line, with " | " between the columns.
const SEP = " | ";
const toLines = <T,>(items: T[], keys: (keyof T)[]) => items.map((x) => keys.map((k) => String(x[k] ?? "")).join(SEP).replace(/( \| )+$/, "")).join("\n");
function fromLines<T>(text: string, keys: (keyof T)[]): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      // Anything beyond the last column stays in the last column.
      const rest = parts.slice(keys.length - 1).join(" | ");
      return Object.fromEntries(keys.map((k, i) => [k, i < keys.length - 1 ? parts[i] ?? "" : rest])) as T;
    });
}

// Text areas keep their own draft (uncontrolled) so that a half-typed "|" or an empty line
// is not cleaned away mid-edit; the text is parsed when the field is left.
function Area({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (v: string) => void }) {
  return (
    <label>
      {label} <span className="muted small">({hint})</span>
      <textarea rows={Math.max(3, value.split("\n").length + 1)} defaultValue={value} onBlur={(ev) => onSave(ev.target.value)} />
    </label>
  );
}

/** Event briefing of a DJ booking conversation. */
function EditEvent({ e, onChange }: { e: EventBriefing; onChange: (e: EventBriefing) => void }) {
  const set = (patch: Partial<EventBriefing>) => onChange({ ...e, ...patch });
  const field = (label: string, key: "event_type" | "location" | "guest_count" | "fee" | "date_text") => (
    <label>
      {label}
      <input value={e[key]} onChange={(ev) => set({ [key]: ev.target.value })} />
    </label>
  );
  return (
    <>
      <h3>Event</h3>
      {field("Anlass", "event_type")}
      <div className="row">
        <label>
          Datum
          <input type="date" value={e.date} onChange={(ev) => set({ date: ev.target.value })} />
        </label>
        <label>
          Beginn
          <input type="time" value={e.start_time} onChange={(ev) => set({ start_time: ev.target.value })} />
        </label>
        <label>
          Ende
          <input type="time" value={e.end_time} onChange={(ev) => set({ end_time: ev.target.value })} />
        </label>
      </div>
      {field("Location", "location")}
      <div className="row">
        {field("Gäste", "guest_count")}
        {field("Gage", "fee")}
      </div>
      <Area label="Ansprechpartner" hint="Name | Rolle | Kontakt" value={toLines(e.contacts, ["name", "role", "contact"])}
        onSave={(v) => set({ contacts: fromLines(v, ["name", "role", "contact"]) })} />
      <Area label="Ablauf" hint="Zeit | Programmpunkt" value={toLines(e.timeline, ["time", "item"])}
        onSave={(v) => set({ timeline: fromLines(v, ["time", "item"]) })} />
      <Area label="Besondere Momente" hint="Moment | Song" value={toLines(e.special_moments, ["moment", "song"])}
        onSave={(v) => set({ special_moments: fromLines(v, ["moment", "song"]) })} />
      <label>
        Musik &amp; Stimmung
        <textarea rows={3} value={e.music_style} onChange={(ev) => set({ music_style: ev.target.value })} />
      </label>
      <Area label="Musikwünsche" hint="einer pro Zeile" value={e.must_play.join("\n")} onSave={(v) => set({ must_play: clean(lines(v)) })} />
      <Area label="No-Gos" hint="eines pro Zeile" value={e.do_not_play.join("\n")} onSave={(v) => set({ do_not_play: clean(lines(v)) })} />
      <Area label="Technik & Organisation" hint="ein Punkt pro Zeile" value={e.logistics.join("\n")} onSave={(v) => set({ logistics: clean(lines(v)) })} />
    </>
  );
}
