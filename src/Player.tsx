import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getAudio } from "./lib/db";
import type { Meeting } from "./lib/types";

export interface PlayerHandle {
  /** Jump to a position (seconds from the start of the meeting) and play. */
  playFrom: (sec: number) => void;
}

const SPEEDS = [1, 1.25, 1.5, 2];
const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Plays a meeting that is stored as several audio files as if it were one recording.
 * Files are loaded only when needed (they may have to come from the cloud).
 */
const Player = forwardRef<PlayerHandle, { meeting: Meeting; onTime?: (sec: number) => void }>(({ meeting, onTime }, ref) => {
  const audio = useRef<HTMLAudioElement>(null);
  const urls = useRef(new Map<number, string>());
  const loaded = useRef(-1); // segment currently in the <audio> element
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");

  const segs = meeting.segments;
  const starts = segs.map((_, i) => segs.slice(0, i).reduce((a, s) => a + s.durationMs / 1000, 0));
  const total = meeting.durationMs / 1000;

  useEffect(() => {
    const map = urls.current;
    return () => map.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const load = async (i: number, at: number, play: boolean) => {
    const el = audio.current!;
    if (loaded.current !== i) {
      let url = urls.current.get(i);
      if (!url) {
        const blob = await getAudio(meeting.id, segs[i].idx);
        if (!blob) return setError("Die Aufnahme ist auf diesem Gerät nicht verfügbar.");
        url = URL.createObjectURL(blob);
        urls.current.set(i, url);
      }
      loaded.current = i;
      el.src = url;
      el.playbackRate = speed;
      await new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true }));
      // Browser recordings carry no length; seeking far past the end makes the browser work it out.
      if (!isFinite(el.duration)) {
        el.currentTime = 1e9;
        await new Promise((r) => el.addEventListener("durationchange", r, { once: true }));
      }
    }
    el.currentTime = at;
    setPos(starts[i] + at);
    if (play) el.play().catch(() => setPlaying(false));
  };

  const seek = (sec: number, play: boolean) => {
    sec = Math.max(0, Math.min(sec, Math.max(0, total - 0.05)));
    let i = starts.length - 1;
    while (i > 0 && starts[i] > sec) i--;
    setError("");
    load(i, sec - starts[i], play).catch((e: Error) => setError(e.message));
  };
  useImperativeHandle(ref, () => ({ playFrom: (sec) => seek(sec, true) }));

  if (!segs.length) return null;
  return (
    <div className="player">
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (loaded.current < 0 || e.currentTarget.seeking) return;
          const t = starts[loaded.current] + e.currentTarget.currentTime;
          setPos(t);
          onTime?.(t);
        }}
        onEnded={() => (loaded.current + 1 < segs.length ? load(loaded.current + 1, 0, true) : setPlaying(false))}
      />
      <button className="play" aria-label={playing ? "Pause" : "Wiedergabe"} onClick={() => (playing ? audio.current!.pause() : seek(pos >= total - 0.1 ? 0 : pos, true))}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input type="range" aria-label="Position" min={0} max={total} step={0.1} value={pos} onChange={(e) => seek(Number(e.target.value), playing)} />
      <span className="muted small nowrap">{fmt(pos)} / {fmt(total)}</span>
      <button
        className="speed"
        aria-label="Geschwindigkeit"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
          setSpeed(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
      >
        {speed}×
      </button>
      {error && <p className="notice error">{error}</p>}
    </div>
  );
});
export default Player;
