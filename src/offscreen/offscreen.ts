/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Offscreen Document
 *  Runs Whisper speech-to-text model using Transformers.js
 *  (ONNX Runtime Web) with WebGPU or WASM backend.
 *  This document has full DOM + WebGPU access, unlike the
 *  service worker.
 * ────────────────────────────────────────────────────────── */

import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  env,
} from "@huggingface/transformers";

import { MSG, WHISPER_MODELS, type ModelKey } from "../shared/types";

// ── Configuration ───────────────────────────────────────

env.allowRemoteModels = true;
env.allowLocalModels = false;

// ── State ───────────────────────────────────────────────

let currentPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let currentModelKey: ModelKey | null = null;
let pipelineLoading = false;

// ── Message Listener ────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.OFFSCREEN_TRANSCRIBE) {
    handleTranscription(message).catch((err) => {
      console.error("[VHL Assist Offscreen] Transcription error:", err);
      sendMessage({
        type: MSG.TRANSCRIBE_ERROR,
        requestId: message.requestId,
        tabId: message.tabId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return false;
});

// ── Transcription Handler ───────────────────────────────

async function handleTranscription(message: {
  audioBase64: string;
  modelKey: ModelKey;
  requestId: string;
  tabId: number;
}): Promise<void> {
  const { audioBase64, modelKey, requestId, tabId } = message;

  // 1. Load or reuse the pipeline
  const pipe = await getOrCreatePipeline(modelKey, requestId, tabId);

  // 2. Decode the audio to 16kHz mono Float32Array
  sendProgress(requestId, tabId, "transcribing", 60, "Decoding audio…");
  const audioData = await decodeAudioToFloat32(audioBase64);

  // 3. Run transcription
  sendProgress(requestId, tabId, "transcribing", 70, "Transcribing audio — this may take a moment…");

  const result = await pipe(audioData, {
    language: "german",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  });

  // 4. Extract the transcript text
  let transcript: string;
  if (typeof result === "string") {
    transcript = result;
  } else if (Array.isArray(result)) {
    transcript = result.map((r: { text: string }) => r.text).join(" ");
  } else {
    transcript = (result as { text: string }).text;
  }

  // 5. Send the result back
  sendMessage({
    type: MSG.TRANSCRIBE_COMPLETE,
    requestId,
    tabId,
    transcript: transcript.trim(),
  });
}

// ── Pipeline Management ─────────────────────────────────

async function getOrCreatePipeline(
  modelKey: ModelKey,
  requestId: string,
  tabId: number
): Promise<AutomaticSpeechRecognitionPipeline> {
  // Reuse existing pipeline if model hasn't changed
  if (currentPipeline && currentModelKey === modelKey) {
    sendProgress(requestId, tabId, "model-loading", 55, "Model ready.");
    return currentPipeline;
  }

  if (pipelineLoading) {
    throw new Error("A model is currently loading. Please try again in a moment.");
  }

  pipelineLoading = true;

  try {
    // Dispose old pipeline if switching models
    if (currentPipeline) {
      await currentPipeline.dispose();
      currentPipeline = null;
      currentModelKey = null;
    }

    const modelConfig = WHISPER_MODELS[modelKey];
    if (!modelConfig) {
      throw new Error(`Unknown model key: ${modelKey}`);
    }

    sendProgress(
      requestId,
      tabId,
      "model-loading",
      10,
      `Loading ${modelConfig.label} model (${modelConfig.size})… This only happens once.`
    );

    // Determine the best available device
    const device = await detectBestDevice();
    const dtype = device === "webgpu" ? "fp32" : "q8";

    sendProgress(
      requestId,
      tabId,
      "model-loading",
      15,
      `Loading ${modelConfig.label} model using ${device.toUpperCase()}…`
    );

    // Create the pipeline with progress reporting
    const pipe = await pipeline(
      "automatic-speech-recognition",
      modelConfig.id,
      {
        device,
        dtype,
        progress_callback: (progress: {
          status: string;
          progress?: number;
          file?: string;
        }) => {
          if (progress.status === "progress" && progress.progress != null) {
            // Map model loading progress to 15–55% of overall progress
            const mapped = 15 + progress.progress * 0.4;
            const file = progress.file
              ? ` (${formatFileName(progress.file)})`
              : "";
            sendProgress(
              requestId,
              tabId,
              "model-loading",
              mapped,
              `Downloading model${file}… ${Math.round(progress.progress)}%`
            );
          } else if (progress.status === "ready") {
            sendProgress(requestId, tabId, "model-loading", 55, "Model loaded.");
          }
        },
      }
    );

    currentPipeline = pipe as AutomaticSpeechRecognitionPipeline;
    currentModelKey = modelKey;
    return currentPipeline;
  } finally {
    pipelineLoading = false;
  }
}

// ── Audio Decoding ──────────────────────────────────────

/**
 * Decode base64-encoded audio (MP3) to 16kHz mono Float32Array
 * using the Web Audio API (OfflineAudioContext).
 */
async function decodeAudioToFloat32(base64: string): Promise<Float32Array> {
  // Base64 → ArrayBuffer
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Decode compressed audio to PCM
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
  } finally {
    await audioCtx.close();
  }

  // If already 16kHz mono, return directly
  if (audioBuffer.sampleRate === 16000 && audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  // Resample to 16kHz mono via OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * 16000),
    16000
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampledBuffer = await offlineCtx.startRendering();
  return resampledBuffer.getChannelData(0);
}

// ── Device Detection ────────────────────────────────────

async function detectBestDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (nav.gpu) {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {
    // WebGPU unavailable — fall back to WASM
  }
  return "wasm";
}

// ── Communication Helpers ───────────────────────────────

function sendProgress(
  requestId: string,
  tabId: number,
  stage: "model-loading" | "transcribing",
  progress: number,
  message: string
): void {
  sendMessage({
    type: MSG.TRANSCRIBE_PROGRESS,
    requestId,
    tabId,
    stage,
    progress,
    message,
  });
}

function sendMessage(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Service worker may have restarted — safe to ignore
  });
}

// ── Utilities ───────────────────────────────────────────

function formatFileName(file: string): string {
  const parts = file.split("/");
  const name = parts[parts.length - 1];
  return name.length > 30 ? name.slice(0, 27) + "…" : name;
}
