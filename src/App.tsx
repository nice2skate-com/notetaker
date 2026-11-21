import { useCallback, useEffect, useRef, useState } from "react";
import * as cloud from "./lib/cloud";
import { deleteAudio, deleteMeeting, getMeeting, hasLocalAudio, listMeetings, putAudio, putMeeting, sync } from "./lib/db";
import EditProtocol from "./EditProtocol";
import { copyRich, download, exportFiles, fmtDate, mailPayload, mailtoUrl, printProtocol, share } from "./lib/export";
import Player, { type PlayerHandle } from "./Player";
import { Recorder } from "./lib/recorder";
import { loadSettings, saveSettings } from "./lib/settings";
import { summarize } from "./lib/summarize";
import { MAX_UPLOAD_BYTES, transcribeMeeting } from "./lib/transcribe";
import type { Meeting, Settings } from "./lib/types";
import SettingsView from "./SettingsView";
import TasksView from "./TasksView";

type View = { name: "home" } | { name: "record"; system: boolean } | { name: "meeting"; id: string } | { name: "settings"; recovery?: boolean } | { name: "tasks" };

const dur = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
};
const newMeeting = (): Meeting => ({
  id: crypto.randomUUID(),
  title: "Gespräch vom " + new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }),
  createdAt: Date.now(),
  durationMs: 0,
  status: "recorded",
  context: "",
  segments: [],
  speakerNames: {},
  done: {},
});
const STATUS: Record<Meeting["status"], string> = {
  recorded: "Aufgenommen",
  transcribing: "Wird transkribiert …",
  summarizing: "Wird zusammengefasst …",
  done: "Fertig",
  error: "Fehler",
};

export default function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [account, setAccount] = useState<string | null>(null);
  const [rev, setRev] = useState(0); // bumped whenever a sync may have changed local data
  const pushTimer = useRef<number>(undefined);

  const updateSettings = (s: Settings) => {
    s = { ...s, updatedAt: Date.now() };
    setSettings(s);
    saveSettings(s);
    // Name, voice sample etc. follow the account; wait until typing has stopped.
    clearTimeout(pushTimer.current);
    if (cloud.signedIn()) pushTimer.current = window.setTimeout(() => cloud.pushProfile(s).catch(() => {}), 1500);
  };

  useEffect(() => cloud.onAuth(setAccount), []);
  useEffect(() => cloud.onRecovery(() => setView({ name: "settings", recovery: true })), []);
  useEffect(() => {
    if (!account) return;
    const refresh = () => sync().catch(() => {}).then(() => setRev((r) => r + 1));
    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    cloud.fetchProfile().then((remote) => {
      const local = loadSettings();
      if (remote && (remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        const merged = { ...local, ...remote };
        setSettings(merged);
        saveSettings(merged);
      } else if (!remote || (local.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        cloud.pushProfile({ ...local, updatedAt: local.updatedAt ?? Date.now() }).catch(() => {});
      }
    }).catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    // Changes from another device arrive right away; several in a row trigger one refresh.
    let timer: number | undefined;
    const stop = cloud.onRemoteChange(() => {
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 800);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
      stop();
    };
  }, [account]);

  if (view.name === "settings")
    return <SettingsView settings={settings} account={account} recovery={!!view.recovery} onChange={updateSettings} onBack={() => setView({ name: "home" })} />;
  if (view.name === "tasks") return <TasksView rev={rev} onOpen={(id) => setView({ name: "meeting", id })} onBack={() => setView({ name: "home" })} />;
  if (view.name === "record")
    return <RecordView settings={settings} system={view.system} onDone={(id) => setView(id ? { name: "meeting", id } : { name: "home" })} />;
  if (view.name === "meeting")
    return <MeetingView id={view.id} settings={settings} account={account} rev={rev} onBack={() => setView({ name: "home" })} />;
  return <Home settings={settings} account={account} rev={rev} go={setView} />;
}

function Home({ settings, account, rev, go }: { settings: Settings; account: string | null; rev: number; go: (v: View) => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [system, setSystem] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    listMeetings().then(setMeetings);
  }, [rev]);
  const openTasks = meetings.reduce((n, m) => n + (m.summary?.follow_ups.filter((_, i) => !m.done[i]).length ?? 0), 0);
  // Search covers everything in a meeting: title, protocol and transcript.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? meetings.filter((m) => {
        const text = JSON.stringify([m.title, m.context, m.summary, m.transcript, m.speakerNames]).toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : meetings;
  // Capturing another app's audio only works in desktop browsers.
  const canSystem = !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|Android/i.test(navigator.userAgent);
  const missingKeys = !account && (!settings.openaiKey || !settings.anthropicKey);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError("Die Datei ist größer als 25 MB. Bitte kürzen oder stärker komprimieren.");
    const durationMs = await new Promise<number>((resolve) => {
      const a = new Audio(URL.createObjectURL(file));
      a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration * 1000 : 0);
      a.onerror = () => resolve(0);
    });
    const m = { ...newMeeting(), title: file.name.replace(/\.[^.]+$/, ""), durationMs };
    m.segments = [{ idx: 0, durationMs, mime: file.type }];
    await putAudio(m.id, 0, file);
    await putMeeting(m);
    go({ name: "meeting", id: m.id });
  };

  return (
    <main>
      <header className="brand-bar">
        <div className="brand">
          <img src="./logo.webp" alt="DJ KOLJA ONE" width={172} height={22} />
          <span>Notetaker</span>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => go({ name: "tasks" })}>Aufgaben{openTasks ? ` (${openTasks})` : ""}</button>
          <button className="ghost" onClick={() => go({ name: "settings" })}>Einstellungen</button>
        </div>
      </header>
      {missingKeys && (
        <p className="notice">
          {cloud.supabase ? "Bitte anmelden, damit Gespräche ausgewertet und zwischen Ihren Geräten abgeglichen werden." : "Für Transkription und Zusammenfassung fehlen noch API-Schlüssel."}{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), go({ name: "settings" }))}>Jetzt einrichten</a>
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      <section className="card center">
        <button className="rec" onClick={() => go({ name: "record", system })} aria-label="Aufnahme starten">
          <span />
        </button>
        <p className="muted">Aufnahme starten</p>
        {canSystem && (
          <label className="check">
            <input type="checkbox" checked={system} onChange={(e) => setSystem(e.target.checked)} />
            Online-Meeting: zusätzlich den Ton des Computers aufnehmen
          </label>
        )}
        <label className="link">
          Audiodatei importieren
          <input type="file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        </label>
      </section>
      <h2>Gespräche</h2>
      {!meetings.length && <p className="muted">Noch keine Aufnahmen.</p>}
      {meetings.length > 3 && (
        <input className="search" type="search" placeholder="Suchen in Titeln, Protokollen und Transkripten" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {!!meetings.length && !found.length && <p className="muted">Nichts gefunden.</p>}
      <ul className="list">
        {found.map((m) => (
          <li key={m.id} onClick={() => go({ name: "meeting", id: m.id })}>
            <div>
              <strong>{m.title}</strong>
              <span className="muted">
                {new Date(m.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })} · {dur(m.durationMs)}
              </span>
            </div>
            <span className={"badge " + m.status}>{STATUS[m.status]}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

function RecordView({ settings, system, onDone }: { settings: Settings; system: boolean; onDone: (id?: string) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [context, setContext] = useState("");
  const [stopping, setStopping] = useState(false);
  const rec = useRef<Recorder | null>(null);
  const meeting = useRef<Meeting>(newMeeting());

  useEffect(() => {
    let quietSince = 0;
    let lastClip = 0;
    const m = meeting.current;
    const r = new Recorder({
      settings,
      withSystemAudio: system,
      onSegment: async ({ blob, durationMs }) => {
        const idx = m.segments.length;
        await putAudio(m.id, idx, blob);
        m.segments.push({ idx, durationMs, mime: blob.type });
        m.durationMs += durationMs;
        await putMeeting(m);
      },
      onLevel: (rms, peak) => {
        setLevel(Math.min(1, rms * 6));
        const now = performance.now();
        if (peak > 0.98) lastClip = now;
        if (rms > 0.01) quietSince = now;
        setHint(
          now - lastClip < 2000
            ? "Übersteuert – etwas mehr Abstand zum Mikrofon."
            : now - quietSince > 6000
              ? "Sehr leise – Mikrofon näher an die Sprechenden legen."
              : ""
        );
      },
    });
    rec.current = r;
    r.start().catch((e: Error) =>
      setError(e.name === "NotAllowedError" ? "Kein Zugriff auf das Mikrofon. Bitte in den Browser-Einstellungen erlauben." : e.message)
    );
    const t = setInterval(() => setElapsed(r.elapsedMs()), 250);
    return () => {
      clearInterval(t);
      r.stop();
    };
  }, [settings, system]);

  const stop = async () => {
    setStopping(true);
    await rec.current?.stop();
    const m = meeting.current;
    if (!m.segments.length) return onDone();
    m.context = context;
    await putMeeting(m);
    onDone(m.id);
  };

  if (error)
    return (
      <main>
        <p className="notice error">{error}</p>
        <button onClick={() => onDone()}>Zurück</button>
      </main>
    );

  return (
    <main className="recording">
      <p className={"state" + (paused ? "" : " live")}>{paused ? "Pausiert" : "Aufnahme läuft"}</p>
      <p className="timer">{dur(elapsed)}</p>
      <div className="meter" role="img" aria-label="Pegel">
        <div style={{ width: `${(paused ? 0 : level) * 100}%` }} />
      </div>
      <p className="hint">{hint || " "}</p>
      <textarea
        placeholder="Optional: Thema, Teilnehmer, Namen – hilft bei der Zusammenfassung"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        rows={3}
      />
      <div className="row">
        <button
          onClick={() => {
            paused ? rec.current?.resume() : rec.current?.pause();
            setPaused(!paused);
          }}
        >
          {paused ? "Fortsetzen" : "Pause"}
        </button>
        <button className="primary" onClick={stop} disabled={stopping}>
          Beenden &amp; auswerten
        </button>
      </div>
      <p className="muted small">Bitte die App geöffnet und den Bildschirm an lassen – im Hintergrund stoppt der Browser die Aufnahme.</p>
    </main>
  );
}

const TABS = ["Übersicht", "Entscheidungen", "Termine", "Follow-ups", "Transkript"] as const;

function MeetingView({ id, settings, account, rev, onBack }: { id: string; settings: Settings; account: string | null; rev: number; onBack: () => void }) {
  const [m, setM] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Übersicht");
  const [progress, setProgress] = useState("");
  const [toast, setToast] = useState("");
  const [to, setTo] = useState(settings.emailTo);
  const [editing, setEditing] = useState(false);
  const [mail, setMail] = useState<{ sending?: boolean; sent?: string; error?: string; pasteHint?: boolean }>({});
  const [withTranscript, setWithTranscript] = useState(false);
  const [now, setNow] = useState(-1); // playback position, to highlight the spoken passage
  const player = useRef<PlayerHandle>(null);
  const running = useRef(false);

  const save = useCallback((next: Meeting) => {
    setM({ ...next });
    return putMeeting(next);
  }, []);

  const process = useCallback(
    async (meeting: Meeting, redoTranscript: boolean) => {
      if (running.current) return;
      if (!account && (!settings.openaiKey || !settings.anthropicKey))
        return save({ ...meeting, status: "error", error: cloud.supabase ? "Bitte in den Einstellungen anmelden." : "API-Schlüssel fehlen. Bitte in den Einstellungen eintragen." });
      running.current = true;
      const cur = { ...meeting, error: undefined };
      try {
        if (redoTranscript || !cur.transcript) {
          await save(Object.assign(cur, { status: "transcribing" }));
          cur.transcript = await transcribeMeeting(cur, settings, (d, t) => setProgress(t > 1 ? `Teil ${Math.min(d + 1, t)} von ${t}` : ""));
          setProgress("");
          if (!cur.transcript.length) throw new Error("In der Aufnahme wurde keine Sprache erkannt.");
        }
        await save(Object.assign(cur, { status: "summarizing" }));
        const summary = await summarize(cur, settings);
        for (const s of summary.speaker_names) if (s.name && cur.transcript!.some((u) => u.speaker === s.label)) cur.speakerNames[s.label] ??= s.name;
        if (cur.title.startsWith("Gespräch vom ") && summary.title) cur.title = summary.title;
        await save(Object.assign(cur, { summary, status: "done", done: {} }));
      } catch (e) {
        await save(Object.assign(cur, { status: "error", error: (e as Error).message }));
      } finally {
        running.current = false;
        setProgress("");
      }
    },
    [settings, account, save]
  );

  useEffect(() => {
    if (running.current) return; // our own run is the newest state; don't overwrite it with a synced copy
    getMeeting(id).then(async (meeting) => {
      if (!meeting) return onBack();
      setM(meeting);
      // Fresh recording, or a run that was interrupted by closing the app. Only where the
      // audio was recorded: another device showing the same meeting must not start a second run.
      if (meeting.status !== "done" && meeting.status !== "error" && (await hasLocalAudio(id, 0))) process(meeting, false);
    });
  }, [id, rev, onBack, process]);

  if (!m) return <main />;
  const s = m.summary;
  const busy = m.status === "transcribing" || m.status === "summarizing";
  const name = (label: string) => m.speakerNames[label] || label;
  const speakers = [...new Set(m.transcript?.map((u) => u.speaker))];
  const flash = (t: string) => (setToast(t), setTimeout(() => setToast(""), 6000));
  const when = (iso: string, time: string, text: string) => [fmtDate(iso) || text, time].filter(Boolean).join(", ") || "offen";
  // Signed in: the server sends the formatted protocol itself.
  const sendDirect = async () => {
    const recipients = to.split(/[,;\s]+/).filter(Boolean);
    if (!recipients.length) return setMail({ error: "Bitte einen Empfänger eintragen." });
    setMail({ sending: true });
    try {
      await cloud.sendMail(mailPayload(m, recipients, withTranscript));
      setMail({ sent: recipients.join(", ") });
    } catch (e) {
      setMail({ error: (e as Error).message });
    }
  };
  // Own mail program: opens a new e-mail and puts the formatted protocol on the clipboard to paste.
  const openMailer = async () => {
    const copied = await copyRich(m).then(() => true, () => false);
    setMail({ pasteHint: copied });
    location.href = mailtoUrl(m, to, !copied);
  };

  return (
    <main>
      <header>
        <button className="ghost" onClick={onBack}>‹ Zurück</button>
        <span className={"badge " + m.status}>{STATUS[m.status]} {progress}</span>
      </header>
      <input className="title" value={m.title} onChange={(e) => save({ ...m, title: e.target.value })} aria-label="Titel" />
      <p className="muted">
        {new Date(m.createdAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" })} · {dur(m.durationMs)}
      </p>
      {!!m.segments.length && <Player ref={player} meeting={m} onTime={setNow} />}
      {m.status === "error" && (
        <p className="notice error">
          {m.error} <button onClick={() => process(m, false)}>Erneut versuchen</button>
        </p>
      )}
      {busy && <div className="spinner" />}
      {m.status !== "done" && m.status !== "error" && !running.current && !!m.segments.length && (
        <p className="notice">
          Die Auswertung läuft möglicherweise auf einem anderen Gerät. <button onClick={() => process(m, false)}>Hier auswerten</button>
        </p>
      )}

      {s && editing && (
        <>
          <div className="row">
            <button className="primary" onClick={() => setEditing(false)}>Fertig</button>
            <span className="muted small">Änderungen werden sofort gespeichert.</span>
          </div>
          <EditProtocol m={m} onChange={save} />
        </>
      )}
      {s && !editing && (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
                {t}
                {t === "Entscheidungen" && ` (${s.decisions.length})`}
                {t === "Termine" && ` (${s.schedule.length})`}
                {t === "Follow-ups" && ` (${s.follow_ups.length})`}
              </button>
            ))}
          </nav>

          {tab === "Übersicht" && (
            <section>
              <p>{s.overview}</p>
              {!!s.key_points.length && <h3>Kernpunkte</h3>}
              <ul>{s.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              {!!s.open_questions.length && <h3>Offene Fragen</h3>}
              <ul>{s.open_questions.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </section>
          )}

          {tab === "Entscheidungen" && (
            <section>
              {!s.decisions.length && <p className="muted">Keine Entscheidungen festgehalten.</p>}
              {s.decisions.map((d, i) => (
                <div className="card" key={i}>
                  <strong>{d.decision}</strong>
                  {d.rationale && <p>{d.rationale}</p>}
                  {d.owner && <p className="muted">Verantwortlich: {d.owner}</p>}
                </div>
              ))}
            </section>
          )}

          {tab === "Termine" && (
            <section className="scroll">
              {!s.schedule.length && <p className="muted">Keine Termine genannt.</p>}
              {!!s.schedule.length && (
                <table>
                  <thead><tr><th>Wann</th><th>Was</th><th>Wer</th><th>Hinweis</th></tr></thead>
                  <tbody>
                    {s.schedule.map((t, i) => (
                      <tr key={i}><td className="nowrap" data-l="Wann">{when(t.date, t.time, t.date_text)}</td><td data-l="Was">{t.title}</td><td data-l="Wer">{t.participants}</td><td data-l="Hinweis">{t.notes}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {tab === "Follow-ups" && (
            <section className="scroll">
              {!s.follow_ups.length && <p className="muted">Keine Aufgaben festgehalten.</p>}
              {!!s.follow_ups.length && (
                <table>
                  <thead><tr><th></th><th>Aufgabe</th><th>Verantwortlich</th><th>Fällig</th><th>Priorität</th></tr></thead>
                  <tbody>
                    {s.follow_ups.map((f, i) => (
                      <tr key={i} className={m.done[i] ? "done" : ""}>
                        <td>
                          <input type="checkbox" checked={!!m.done[i]} aria-label="Erledigt"
                            onChange={(e) => save({ ...m, done: { ...m.done, [i]: e.target.checked } })} />
                        </td>
                        <td data-l="Aufgabe">{f.task}</td><td data-l="Verantwortlich">{f.owner}</td>
                        <td className="nowrap" data-l="Fällig">{when(f.due_date, "", f.due_text)}</td>
                        <td data-l="Priorität"><span className={"prio " + f.priority}>{f.priority}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}

      {!editing && (tab === "Transkript" || !s) && !!m.transcript?.length && (
        <section>
          <div className="speakers">
            {speakers.map((sp) => (
              <label key={sp}>
                <span className="muted small">{sp}</span>
                <input value={m.speakerNames[sp] ?? ""} placeholder="Name eintragen"
                  onChange={(e) => save({ ...m, speakerNames: { ...m.speakerNames, [sp]: e.target.value } })} />
              </label>
            ))}
          </div>
          {m.transcript.map((u, i) => (
            <p key={i} className={"utt" + (now >= u.start && now < u.end ? " now" : "")}>
              {m.segments.length ? (
                <button className="ts" title="Ab hier anhören" onClick={() => player.current?.playFrom(u.start)}>{dur(u.start * 1000)}</button>
              ) : (
                <span className="muted small">{dur(u.start * 1000)}</span>
              )}{" "}
              <strong>{name(u.speaker)}:</strong> {u.text}
            </p>
          ))}
        </section>
      )}

      {s && !editing && (
        <footer className="actions">
          <h3>Versenden &amp; speichern</h3>
          <div className="row">
            <input type="text" inputMode="email" autoCapitalize="off" placeholder="empfaenger@firma.de, weitere@firma.de" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Empfänger" />
            {account ? (
              <button className="primary" disabled={mail.sending} onClick={sendDirect}>{mail.sending ? "Sendet …" : "Senden"}</button>
            ) : (
              <button className="primary" onClick={openMailer}>E-Mail</button>
            )}
          </div>
          {account && (
            <div className="row wrap">
              <label className="check inline">
                <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} /> Transkript mitsenden
              </label>
              <button className="ghost" onClick={openMailer}>Im eigenen Mailprogramm öffnen</button>
            </div>
          )}
          {mail.sent && <p className="notice ok">Gesendet an {mail.sent}.</p>}
          {mail.error && <p className="notice error">{mail.error}</p>}
          {mail.pasteHint && (
            <p className="notice">
              Das Protokoll liegt fertig gestaltet in der Zwischenablage. In das Textfeld der E-Mail klicken und mit <strong>⌘V</strong> einfügen
              (am iPhone: lange tippen → Einsetzen).
            </p>
          )}
          <div className="row wrap">
            {!!navigator.share && (
              <button onClick={async () => (await share(m)) || flash("Teilen wird hier nicht unterstützt.")}>Teilen mit Anhängen</button>
            )}
            <button onClick={() => copyRich(m).then(() => flash("Kopiert – mit Tabellen einfügbar."))}>Kopieren</button>
            <button onClick={() => exportFiles(m).forEach(download)}>Dateien speichern</button>
            <button onClick={() => printProtocol(m)}>Als PDF drucken</button>
          </div>
          <p className="muted small">Gespeichert werden das Protokoll (HTML, als PDF druckbar), die Follow-ups (CSV für Excel) und die Termine (ICS für den Kalender).</p>
        </footer>
      )}

      {!busy && (
        <div className="row wrap danger-zone">
          {s && !editing && <button onClick={() => setEditing(true)}>Protokoll bearbeiten</button>}
          {m.transcript && <button onClick={() => process(m, false)}>Neu zusammenfassen</button>}
          {m.transcript && !!m.segments.length && <button onClick={() => process(m, true)}>Neu transkribieren</button>}
          {!!m.segments.length && m.status === "done" && (
            <button onClick={() => confirm("Audio löschen? Protokoll und Transkript bleiben erhalten.") && deleteAudio(m).then(() => save({ ...m, segments: [] }))}>
              Audio löschen
            </button>
          )}
          <button className="danger" onClick={() => confirm("Gespräch endgültig löschen?") && deleteMeeting(m).then(onBack)}>Löschen</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
