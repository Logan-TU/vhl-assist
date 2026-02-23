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
} as const;

// ── Defaults ────────────────────────────────────────────

export const DEFAULTS = {
  enabled: true,
} as const;
