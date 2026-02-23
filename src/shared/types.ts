/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Shared Types & Constants
 * ────────────────────────────────────────────────────────── */

// ── Model definitions ───────────────────────────────────

export interface WhisperModel {
  id: string;
  label: string;
  size: string;
  description: string;
  accuracy: string;
}

export const WHISPER_MODELS: Record<string, WhisperModel> = {
  small: {
    id: "onnx-community/whisper-small",
    label: "Small",
    size: "~250 MB",
    description: "Fastest download & processing",
    accuracy: "Good",
  },
  medium: {
    id: "onnx-community/whisper-medium",
    label: "Medium",
    size: "~450 MB",
    description: "Balanced speed & accuracy",
    accuracy: "Very Good",
  },
  "large-v3-turbo": {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Large V3 Turbo",
    size: "~500 MB",
    description: "Best accuracy, slower processing",
    accuracy: "Excellent",
  },
} as const;

export type ModelKey = keyof typeof WHISPER_MODELS;

export const DEFAULT_MODEL: ModelKey = "small";

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
  // Popup → Service Worker
  GET_MODEL_STATUS: "GET_MODEL_STATUS",
  DELETE_MODEL: "DELETE_MODEL",
  // Service Worker → Popup
  MODEL_STATUS: "MODEL_STATUS",
} as const;

// ── Message payloads ────────────────────────────────────

export interface TranscribeRequest {
  type: typeof MSG.TRANSCRIBE_REQUEST;
  audioUrl: string;
  tabId?: number;
}

export interface OffscreenTranscribeMsg {
  type: typeof MSG.OFFSCREEN_TRANSCRIBE;
  audioData: ArrayBuffer;
  modelKey: ModelKey;
  requestId: string;
}

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
  MODEL_KEY: "vhlAssist_modelKey",
  ENABLED: "vhlAssist_enabled",
} as const;

// ── Defaults ────────────────────────────────────────────

export const DEFAULTS = {
  enabled: true,
  modelKey: DEFAULT_MODEL,
} as const;
