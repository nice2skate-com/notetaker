import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, Settings } from "./types";

// Optional cloud backend (Supabase): account, sync between devices, audio storage and
// server-side API keys. Without the two build-time variables the app works purely locally.
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;

export const supabase: SupabaseClient | null = URL_ && KEY ? createClient(URL_, KEY) : null;

let session: Session | null = null;
const listeners = new Set<(email: string | null) => void>();
let recovery: (() => void) | null = null;
/** Called when the user arrives through a "Passwort vergessen" e-mail link. */
export const onRecovery = (fn: () => void) => void (recovery = fn);

supabase?.auth.onAuthStateChange((event, s) => {
  if (event === "PASSWORD_RECOVERY") recovery?.();
  session = s;
  listeners.forEach((l) => l(s?.user.email ?? null));
});

/** Subscribe to sign-in state; calls back with the e-mail address or null. */
export function onAuth(l: (email: string | null) => void) {
  listeners.add(l);
  supabase?.auth.getSession().then(({ data }) => {
    session = data.session;
    l(session?.user.email ?? null);
  });
  return () => void listeners.delete(l);
}
export const signedIn = () => !!session;
const uid = () => session!.user.id;

/** Fresh access token for calling the server functions. */
export async function accessToken(): Promise<string> {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new Error("Nicht mehr angemeldet. Bitte in den Einstellungen neu anmelden.");
  return data.session.access_token;
}
export const functionUrl = (name: string) => `${URL_}/functions/v1/${name}`;
export const publishableKey = () => KEY as string;

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// --- meetings ---------------------------------------------------------------

export interface MeetingRow {
  id: string;
  data: Meeting;
  updated_at: number;
  deleted: boolean;
}
export async function fetchMeetingRows(): Promise<MeetingRow[]> {
  const { data, error } = await supabase!.from("meetings").select("id, data, updated_at, deleted");
  fail(error);
  return data as MeetingRow[];
}
export async function pushMeeting(m: Meeting) {
  fail((await supabase!.from("meetings").upsert({ id: m.id, data: m, updated_at: m.updatedAt ?? 0, deleted: false })).error);
}
/** Deletions are kept as markers so other devices remove their copy too. */
export async function pushTombstone(id: string, at: number) {
  fail((await supabase!.from("meetings").upsert({ id, data: {}, updated_at: at, deleted: true })).error);
}

/** Calls back whenever one of the user's meetings changes on the server (e.g. from another device). */
export function onRemoteChange(fn: () => void) {
  const channel = supabase!.channel("meetings").on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, fn).subscribe();
  return () => void supabase!.removeChannel(channel);
}

// --- audio ------------------------------------------------------------------

const path = (meetingId: string, idx: number) => `${uid()}/${meetingId}/${idx}`;
export async function uploadAudio(meetingId: string, idx: number, blob: Blob) {
  fail((await supabase!.storage.from("audio").upload(path(meetingId, idx), blob, { contentType: blob.type, upsert: true })).error);
}
export async function downloadAudio(meetingId: string, idx: number): Promise<Blob | undefined> {
  const { data } = await supabase!.storage.from("audio").download(path(meetingId, idx));
  return data ?? undefined;
}
export async function removeAudio(meetingId: string, idxs: number[]) {
  if (idxs.length) fail((await supabase!.storage.from("audio").remove(idxs.map((i) => path(meetingId, i)))).error);
}

// --- profile (name, voice sample … shared between devices) -------------------

export type Profile = Pick<Settings, "myName" | "language" | "voiceRef" | "emailTo" | "updatedAt">;
export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase!.from("profiles").select("data").maybeSingle();
  fail(error);
  return (data?.data as Profile) ?? null;
}
export async function pushProfile(s: Settings) {
  const data: Profile = { myName: s.myName, language: s.language, voiceRef: s.voiceRef, emailTo: s.emailTo, updatedAt: s.updatedAt };
  fail((await supabase!.from("profiles").upsert({ user_id: uid(), data, updated_at: s.updatedAt ?? 0 })).error);
}
