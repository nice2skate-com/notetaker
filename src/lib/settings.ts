import type { Settings } from "./types";

const KEY = "notetaker.settings";
const defaults: Settings = {
  openaiKey: "",
  anthropicKey: "",
  myName: "Ich",
  language: "de",
  voiceRef: "",
  micId: "",
  mode: "room",
  emailTo: "",
};

export function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
