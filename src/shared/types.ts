/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Shared Types & Constants
 * ────────────────────────────────────────────────────────── */

// ── Message types (content ↔ service-worker ↔ offscreen) ─

export const MSG = {
  // Content → Service Worker
  TRANSCRIBE_REQUEST: "TRANSCRIBE_REQUEST",
  // Service Worker → Offscreen
  OFFSCREEN_TRANSCRIBE: "OFFSCREEN_TRANSCRIBE",
  // Offscreen → Service Worker → Content
  TRANSCRIBE_PROGRESS: "TRANSCRIBE_PROGRESS",
  TRANSCRIBE_COMPLETE: "TRANSCRIBE_COMPLETE",
  TRANSCRIBE_ERROR: "TRANSCRIBE_ERROR",
} as const;

// ── Message payloads ────────────────────────────────────

export interface TranscribeProgress {
  type: typeof MSG.TRANSCRIBE_PROGRESS;
  requestId: string;
  stage: "model-loading" | "transcribing";
  progress: number; // 0-100
  message: string;
}

export interface TranscribeComplete {
  type: typeof MSG.TRANSCRIBE_COMPLETE;
  requestId: string;
  transcript: string;
}

export interface TranscribeError {
  type: typeof MSG.TRANSCRIBE_ERROR;
  requestId: string;
  error: string;
}

export type ProgressMessage = TranscribeProgress | TranscribeComplete | TranscribeError;

// ── Storage keys ────────────────────────────────────────

export const STORAGE_KEYS = {
  ENABLED: "vhlAssist_enabled",
  TRANSCRIPTION_LANGUAGE: "vhlAssist_transcriptionLanguage",
} as const;

// ── Transcription settings ───────────────────────────────

export const TRANSCRIPTION_LANGUAGES = [
  "auto",
  "english",
  "german",
  "spanish",
  "french",
  "italian",
  "portuguese",
] as const;

export type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number];

export function isTranscriptionLanguage(
  value: unknown
): value is TranscriptionLanguage {
  return (
    typeof value === "string" &&
    (TRANSCRIPTION_LANGUAGES as readonly string[]).includes(value)
  );
}

// ── Defaults ────────────────────────────────────────────

export const DEFAULTS = {
  enabled: true,
  transcriptionLanguage: "auto" as TranscriptionLanguage,
} as const;
