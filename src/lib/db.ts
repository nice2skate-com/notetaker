import type { Meeting } from "./types";

// Meetings and audio live only on this device (IndexedDB).
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

export const listMeetings = async () =>
  (await run<Meeting[]>("meetings", "readonly", (s) => s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
export const getMeeting = (id: string) => run<Meeting | undefined>("meetings", "readonly", (s) => s.get(id));
export const putMeeting = (m: Meeting) => run("meetings", "readwrite", (s) => s.put(m));

// Stored as bytes + mime: Blobs in IndexedDB are unreliable in some Safari versions.
export async function putAudio(meetingId: string, idx: number, blob: Blob) {
  const rec = { mime: blob.type, data: await blob.arrayBuffer() };
  await run("audio", "readwrite", (s) => s.put(rec, `${meetingId}:${idx}`));
}
export async function getAudio(meetingId: string, idx: number): Promise<Blob | undefined> {
  const r = await run<{ mime: string; data: ArrayBuffer } | undefined>("audio", "readonly", (s) =>
    s.get(`${meetingId}:${idx}`)
  );
  return r && new Blob([r.data], { type: r.mime });
}

export async function deleteMeeting(m: Meeting) {
  await deleteAudio(m);
  await run("meetings", "readwrite", (s) => s.delete(m.id));
}
export async function deleteAudio(m: Meeting) {
  for (const seg of m.segments) await run("audio", "readwrite", (s) => s.delete(`${m.id}:${seg.idx}`));
}
