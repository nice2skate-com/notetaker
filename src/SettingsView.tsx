import { useEffect, useState } from "react";
import { clipToWavDataUrl, decode } from "./lib/audio";
import { supabase } from "./lib/cloud";
import { listMeetings, putMeeting } from "./lib/db";
import { download } from "./lib/export";
import { recordSample } from "./lib/recorder";
import type { Meeting, Settings } from "./lib/types";

const SAMPLE_MS = 9000;

function Account({ account }: { account: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!supabase) return null;
  const auth = supabase.auth;

  const act = async (mode: "in" | "up") => {
    setBusy(true);
    setMsg("");
    const { data, error } =
      mode === "in"
        ? await auth.signInWithPassword({ email, password })
        : await auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    setBusy(false);
    if (error) return setMsg(error.message === "Invalid login credentials" ? "E-Mail oder Passwort stimmt nicht." : error.message);
    if (mode === "up" && !data.session) setMsg("Fast fertig: Bitte den Link in der Bestätigungs-E-Mail öffnen und danach hier anmelden.");
  };

  return (
    <>
      <h2>Konto</h2>
      {account ? (
        <div className="row wrap">
          <span>Angemeldet als <strong>{account}</strong> – Gespräche werden zwischen Ihren Geräten abgeglichen.</span>
          <button onClick={() => auth.signOut()}>Abmelden</button>
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), act("in"))}>
          <p className="muted small">Mit einem Konto erscheinen Ihre Gespräche auf Handy und Mac, und Sie brauchen keine API-Schlüssel auf dem Gerät.</p>
          <label>
            E-Mail
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Passwort
            <input type="password" required minLength={8} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="row wrap">
            <button className="primary" disabled={busy}>Anmelden</button>
            <button type="button" disabled={busy || !email || password.length < 8} onClick={() => act("up")}>Neu registrieren</button>
          </div>
          {msg && <p className="notice">{msg}</p>}
        </form>
      )}
    </>
  );
}

export default function SettingsView({ settings, account, onChange, onBack }: { settings: Settings; account: string | null; onChange: (s: Settings) => void; onBack: () => void }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [sampling, setSampling] = useState(false);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  const loadMics = () =>
    navigator.mediaDevices?.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === "audioinput" && x.label)));
  useEffect(() => {
    loadMics();
  }, []);

  const recordVoice = async () => {
    setMsg("");
    setSampling(true);
    try {
      const blob = await recordSample(SAMPLE_MS, settings.micId);
      const buf = await decode(blob);
      // Skip the first half second (click, breath) and stay under the 10 s limit for samples.
      set("voiceRef", await clipToWavDataUrl(buf, 0.5, Math.min(buf.duration, 9)));
      setMsg("Stimmprofil gespeichert.");
      loadMics();
    } catch (e) {
      setMsg("Aufnahme nicht möglich: " + (e as Error).message);
    } finally {
      setSampling(false);
    }
  };

  const exportAll = async () =>
    download(new File([JSON.stringify(await listMeetings())], `notetaker-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" }));
  const importAll = async (file: File | undefined) => {
    if (!file) return;
    try {
      const items = JSON.parse(await file.text()) as Meeting[];
      // Audio is not part of a backup, so imported meetings have no segments.
      for (const m of items) await putMeeting({ ...m, segments: [] });
      setMsg(`${items.length} Gespräche importiert.`);
    } catch {
      setMsg("Die Datei ist kein gültiges Notetaker-Backup.");
    }
  };

  return (
    <main>
      <header>
        <button className="ghost" onClick={onBack}>‹ Zurück</button>
        <h1>Einstellungen</h1>
      </header>

      <Account account={account} />

      {!account && (
        <>
      <h2>{supabase ? "Ohne Konto: eigene API-Schlüssel" : "API-Schlüssel"}</h2>
          <p className="muted small">Die Schlüssel bleiben auf diesem Gerät und werden nur direkt an OpenAI bzw. Anthropic gesendet.</p>
          <label>
            OpenAI (Transkription mit Sprechererkennung)
            <input type="password" autoComplete="off" value={settings.openaiKey} placeholder="sk-…" onChange={(e) => set("openaiKey", e.target.value.trim())} />
          </label>
          <label>
            Anthropic (Zusammenfassung mit Claude)
            <input type="password" autoComplete="off" value={settings.anthropicKey} placeholder="sk-ant-…" onChange={(e) => set("anthropicKey", e.target.value.trim())} />
          </label>
        </>
      )}

      <h2>Meine Stimme</h2>
      <label>
        Mein Name
        <input value={settings.myName} onChange={(e) => set("myName", e.target.value)} />
      </label>
      <p className="muted small">
        Mit einem Stimmprofil werden Ihre Beiträge im Transkript unter Ihrem Namen geführt. Tippen Sie auf Aufnehmen und sprechen Sie
        etwa neun Sekunden in normaler Lautstärke, zum Beispiel: „Ich bin {settings.myName || "…"} und nehme heute an dieser
        Besprechung teil. Wir sprechen über Termine, Aufgaben und die nächsten Schritte im Projekt.“
      </p>
      <div className="row wrap">
        <button onClick={recordVoice} disabled={sampling}>{sampling ? "Bitte sprechen …" : settings.voiceRef ? "Neu aufnehmen" : "Stimmprofil aufnehmen"}</button>
        {settings.voiceRef && !sampling && <audio controls src={settings.voiceRef} />}
        {settings.voiceRef && !sampling && <button className="danger" onClick={() => set("voiceRef", "")}>Entfernen</button>}
      </div>

      <h2>Aufnahme</h2>
      <label>
        Mikrofon
        <select value={settings.micId} onChange={(e) => set("micId", e.target.value)}>
          <option value="">Standard</option>
          {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
      <label>
        Situation
        <select value={settings.mode} onChange={(e) => set("mode", e.target.value as Settings["mode"])}>
          <option value="room">Gespräch im Raum (Gerät liegt auf dem Tisch)</option>
          <option value="headset">Headset / Telefonat (mit Echounterdrückung)</option>
        </select>
      </label>
      <label>
        Sprache der Gespräche
        <select value={settings.language} onChange={(e) => set("language", e.target.value)}>
          <option value="de">Deutsch</option>
          <option value="en">Englisch</option>
          <option value="">Automatisch erkennen</option>
        </select>
      </label>

      <h2>E-Mail</h2>
      <label>
        Standard-Empfänger
        <input type="email" value={settings.emailTo} placeholder="optional" onChange={(e) => set("emailTo", e.target.value)} />
      </label>

      <h2>Datensicherung</h2>
      <p className="muted small">Ein Backup enthält alle Protokolle und Transkripte (ohne Audio) als Datei – zur eigenen Ablage oder zum Übertragen ohne Konto.</p>
      <div className="row wrap">
        <button onClick={exportAll}>Backup speichern</button>
        <label className="button">
          Backup einlesen
          <input type="file" accept="application/json,.json" hidden onChange={(e) => importAll(e.target.files?.[0])} />
        </label>
      </div>
      {msg && <p className="notice">{msg}</p>}
    </main>
  );
}
