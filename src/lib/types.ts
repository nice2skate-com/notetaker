export interface Utterance {
  speaker: string; // stable label, e.g. "Ich", "Sprecher 2"
  start: number; // seconds from meeting start
  end: number;
  text: string;
}

export interface Decision {
  decision: string;
  rationale: string;
  owner: string;
}

export interface ScheduleItem {
  title: string;
  date: string; // ISO yyyy-mm-dd, "" if not determinable
  time: string; // HH:MM, "" if unknown
  date_text: string; // as said in the conversation
  participants: string;
  notes: string;
}

export interface FollowUp {
  task: string;
  owner: string;
  due_date: string; // ISO yyyy-mm-dd or ""
  due_text: string;
  priority: "hoch" | "mittel" | "niedrig";
}

export interface Summary {
  title: string;
  overview: string;
  key_points: string[];
  decisions: Decision[];
  schedule: ScheduleItem[];
  follow_ups: FollowUp[];
  open_questions: string[];
  speaker_names: { label: string; name: string }[];
}

export interface SegmentMeta {
  idx: number;
  durationMs: number;
  mime: string;
}

export type MeetingStatus = "recorded" | "transcribing" | "summarizing" | "done" | "error";

export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  status: MeetingStatus;
  error?: string;
  context: string; // optional user notes: participants, agenda …
  segments: SegmentMeta[];
  transcript?: Utterance[];
  speakerNames: Record<string, string>; // label -> display name
  summary?: Summary;
  done: Record<number, boolean>; // follow-up index -> erledigt
  updatedAt?: number; // ms; used to decide which device has the newer version
}

export interface Settings {
  openaiKey: string;
  anthropicKey: string;
  myName: string;
  language: string; // ISO code or "" for auto
  voiceRef: string; // data URL (wav) of the user's own voice, "" if none
  micId: string;
  mode: "room" | "headset";
  emailTo: string;
  updatedAt?: number;
}
