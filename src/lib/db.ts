import * as cloud from "./cloud";
import type { Meeting } from "./types";

// Meetings and audio are stored on the device (IndexedDB). When signed in, every
// change is also pushed to the cloud and sync() reconciles with other devices.
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("notetaker", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("meetings", { keyPath: "id" });
      req.result.createObjectStore("audio"); // key: `${meetingId}:${idx}`
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Failed pushes are not lost: sync() compares timestamps and sends them again.
const background = (p: Promise<unknown>) => void p.catch(() => {});

export const listMeetings = async () =>
  (await run<Meeting[]>("meetings", "readonly", (s) => s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
export const getMeeting = (id: string) => run<Meeting | undefined>("meetings", "readonly", (s) => s.get(id));
const putLocal = (m: Meeting) => run("meetings", "readwrite", (s) => s.put(m));

export async function putMeeting(m: Meeting) {
  m.updatedAt = Date.now();
  await putLocal(m);
  if (cloud.signedIn()) background(cloud.pushMeeting(m));
}

// Audio is stored as bytes + mime: Blobs in IndexedDB are unreliable in some Safari versions.
interface AudioRec {
  mime: string;
  data: ArrayBuffer;
  uploaded: boolean;
}
const audioKey = (meetingId: string, idx: number) => `${meetingId}:${idx}`;
const putAudioRec = (key: string, rec: AudioRec) => run("audio", "readwrite", (s) => s.put(rec, key));

export async function putAudio(meetingId: string, idx: number, blob: Blob) {
  const rec: AudioRec = { mime: blob.type, data: await blob.arrayBuffer(), uploaded: false };
  const key = audioKey(meetingId, idx);
  await putAudioRec(key, rec);
  if (cloud.signedIn()) background(cloud.uploadAudio(meetingId, idx, blob).then(() => putAudioRec(key, { ...rec, uploaded: true })));
}

export const hasLocalAudio = async (meetingId: string, idx: number) =>
  !!(await run<IDBValidKey | undefined>("audio", "readonly", (s) => s.getKey(audioKey(meetingId, idx))));

/** Local copy, or – for meetings recorded on another device – fetched from the cloud and kept. */
export async function getAudio(meetingId: string, idx: number): Promise<Blob | undefined> {
  const key = audioKey(meetingId, idx);
  const r = await run<AudioRec | undefined>("audio", "readonly", (s) => s.get(key));
  if (r) return new Blob([r.data], { type: r.mime });
  if (!cloud.signedIn()) return undefined;
  const blob = await cloud.downloadAudio(meetingId, idx);
  if (blob) await putAudioRec(key, { mime: blob.type, data: await blob.arrayBuffer(), uploaded: true });
  return blob;
}

export async function deleteAudio(m: Meeting) {
  for (const seg of m.segments) await run("audio", "readwrite", (s) => s.delete(audioKey(m.id, seg.idx)));
  if (cloud.signedIn()) background(cloud.removeAudio(m.id, m.segments.map((s) => s.idx)));
}

// Deletions made here that other devices still need to learn about: id -> time.
const TOMB = "notetaker.deleted";
const tombs = (): Record<string, number> => JSON.parse(localStorage.getItem(TOMB) || "{}");

export async function deleteMeeting(m: Meeting) {
  await deleteAudio(m);
  await run("meetings", "readwrite", (s) => s.delete(m.id));
  localStorage.setItem(TOMB, JSON.stringify({ ...tombs(), [m.id]: Date.now() }));
  if (cloud.signedIn()) background(flushTombs());
}
async function flushTombs() {
  for (const [id, at] of Object.entries(tombs())) {
    await cloud.pushTombstone(id, at);
    const rest = tombs();
    delete rest[id];
    localStorage.setItem(TOMB, JSON.stringify(rest));
  }
}

let syncing: Promise<void> | null = null;
/** Two-way sync with the cloud; the newest version of each meeting wins. No-op when signed out. */
export function sync(): Promise<void> {
  if (!cloud.signedIn()) return Promise.resolve();
  syncing ??= doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync() {
  await flushTombs();
  const remote = new Map((await cloud.fetchMeetingRows()).map((r) => [r.id, r]));
  const local = new Map((await listMeetings()).map((m) => [m.id, m]));

  for (const r of remote.values()) {
    const l = local.get(r.id);
    if (r.deleted) {
      if (l && (l.updatedAt ?? 0) <= r.updated_at) {
        for (const seg of l.segments) await run("audio", "readwrite", (s) => s.delete(audioKey(l.id, seg.idx)));
        await run("meetings", "readwrite", (s) => s.delete(l.id));
        local.delete(l.id);
      }
    } else if (!l || (l.updatedAt ?? 0) < r.updated_at) {
      await putLocal(r.data);
      local.set(r.id, r.data);
    }
  }
  for (const l of local.values()) {
    const r = remote.get(l.id);
    if (!r || r.updated_at < (l.updatedAt ?? 0)) await cloud.pushMeeting(l);
  }

  // Recordings that have not reached the cloud yet (made offline or before signing in).
  const keys = await run<IDBValidKey[]>("audio", "readonly", (s) => s.getAllKeys());
  for (const key of keys as string[]) {
    const rec = await run<AudioRec>("audio", "readonly", (s) => s.get(key));
    if (rec.uploaded) continue;
    const [meetingId, idx] = key.split(":");
    if (!local.has(meetingId)) continue;
    await cloud.uploadAudio(meetingId, Number(idx), new Blob([rec.data], { type: rec.mime }));
    await putAudioRec(key, { ...rec, uploaded: true });
  }
}
