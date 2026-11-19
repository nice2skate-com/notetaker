import type { Settings } from "./types";

// A long meeting is recorded as a series of independent files ("segments") so
// each stays well under the transcription upload limit and nothing but the
// current segment is lost if the browser is killed.
const SEGMENT_MS = Number(import.meta.env.VITE_SEGMENT_MS) || 8 * 60 * 1000; // override only for tests

export interface Segment {
  blob: Blob;
  durationMs: number;
}

export interface RecorderOptions {
  settings: Settings;
  withSystemAudio: boolean; // desktop: also capture the other side of an online call
  onSegment: (seg: Segment) => void | Promise<void>;
  onLevel: (rms: number, peak: number) => void;
}

export class Recorder {
  private streams: MediaStream[] = [];
  private ctx!: AudioContext;
  private mixed!: MediaStream;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private segStart = 0;
  private segElapsed = 0; // ms recorded in the current segment before the last pause
  private totalDone = 0; // ms in finished segments
  private rotateTimer: number | undefined;
  private raf = 0;
  private wake: WakeLockSentinel | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  paused = false;

  constructor(private opts: RecorderOptions) {}

  async start() {
    const { settings, withSystemAudio } = this.opts;
    const room = settings.mode === "room";
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.micId ? { ideal: settings.micId } : undefined,
        channelCount: 1,
        // In a room, echo cancellation tends to suppress the people further away.
        echoCancellation: !room,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.streams.push(mic);

    this.ctx = new AudioContext();
    const dest = this.ctx.createMediaStreamDestination();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    const connect = (s: MediaStream) => {
      const node = this.ctx.createMediaStreamSource(s);
      node.connect(dest);
      node.connect(analyser);
    };
    connect(mic);

    if (withSystemAudio) {
      // The browser asks which tab/screen to share; "Audio teilen" must be ticked.
      const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.streams.push(sys);
      if (!sys.getAudioTracks().length) {
        this.cleanup();
        throw new Error("Es wurde kein Audio freigegeben. Bitte beim Teilen „Audio teilen“ aktivieren.");
      }
      connect(new MediaStream(sys.getAudioTracks()));
    }
    this.mixed = dest.stream;

    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (const v of data) {
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      this.opts.onLevel(Math.sqrt(sum / data.length), peak);
      this.raf = requestAnimationFrame(tick);
    };
    tick();

    this.wake = await navigator.wakeLock?.request("screen").catch(() => null) ?? null;
    this.startSegment();
  }

  private startSegment() {
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(this.mixed, { mimeType: mime, audioBitsPerSecond: 64000 });
    this.chunks = [];
    this.segElapsed = 0;
    this.segStart = performance.now();
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.start(1000);
    this.rec = rec;
    this.rotateTimer = window.setTimeout(() => this.rotate(), SEGMENT_MS);
  }

  /** Close the current segment and hand it to onSegment. */
  private finishSegment(): Promise<void> {
    const rec = this.rec;
    if (!rec) return Promise.resolve();
    this.rec = null;
    clearTimeout(this.rotateTimer);
    const durationMs = this.segElapsed + (this.paused ? 0 : performance.now() - this.segStart);
    this.totalDone += durationMs;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType.split(";")[0] });
        // Keep segments in order even if saving one is slow.
        this.pending = this.pending.then(() => this.opts.onSegment({ blob, durationMs }));
        resolve();
      };
      rec.stop();
    });
  }

  private async rotate() {
    await this.finishSegment();
    this.startSegment();
  }

  pause() {
    if (this.paused || !this.rec) return;
    this.rec.pause();
    clearTimeout(this.rotateTimer);
    this.segElapsed += performance.now() - this.segStart;
    this.paused = true;
  }

  resume() {
    if (!this.paused || !this.rec) return;
    this.rec.resume();
    this.segStart = performance.now();
    this.rotateTimer = window.setTimeout(() => this.rotate(), Math.max(1000, SEGMENT_MS - this.segElapsed));
    this.paused = false;
  }

  elapsedMs() {
    if (!this.rec) return this.totalDone;
    return this.totalDone + this.segElapsed + (this.paused ? 0 : performance.now() - this.segStart);
  }

  /** Stop and wait until every segment has been handed over. */
  async stop() {
    await this.finishSegment();
    await this.pending;
    this.cleanup();
  }

  private cleaned = false;
  private cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    cancelAnimationFrame(this.raf);
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.ctx?.close();
    this.wake?.release().catch(() => {});
  }
}

/** Record a short sample (used for the user's own voice profile). */
export async function recordSample(ms: number, micId: string): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: micId ? { ideal: micId } : undefined, channelCount: 1 },
  });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<Blob>((r) => (rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType }))));
  rec.start();
  setTimeout(() => rec.stop(), ms);
  const blob = await done;
  stream.getTracks().forEach((t) => t.stop());
  return blob;
}
