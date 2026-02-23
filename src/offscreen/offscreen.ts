/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Offscreen Document
 *  Runs Whisper speech-to-text (whisper-small) via
 *  Transformers.js / ONNX Runtime Web.
 * ────────────────────────────────────────────────────────── */

import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  env,
} from "@huggingface/transformers";

import { MSG } from "../shared/types";

// ── Constants ───────────────────────────────────────────

const MODEL_ID = "onnx-community/whisper-small";

// ── Configuration ───────────────────────────────────────

env.allowRemoteModels = true;
env.allowLocalModels = false;

// Point ONNX Runtime to local WASM/worker files (CDN is blocked by CSP).
// The Vite build also rewrites CDN URLs as a safety net.
const localWasmDir = chrome.runtime.getURL("/");
const onnx = env.backends.onnx;
if (onnx?.wasm) {
  onnx.wasm.wasmPaths = localWasmDir;
  onnx.wasm.proxy = false;
}

// ── State ───────────────────────────────────────────────

let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let pipelineLoading = false;

// ── Message Listener ────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.OFFSCREEN_TRANSCRIBE) {
    handleTranscription(message).catch((err) => {
      console.error("[VHL Assist] Transcription error:", err);
      send({
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

async function handleTranscription(msg: {
  audioBase64: string;
  requestId: string;
  tabId: number;
}): Promise<void> {
  const { audioBase64, requestId, tabId } = msg;

  // 1. Get or create pipeline
  const pipe = await getOrCreatePipeline(requestId, tabId);

  // 2. Decode audio
  progress(requestId, tabId, "transcribing", 60, "Decoding audio…");
  const audioData = await decodeAudioToFloat32(audioBase64);

  // 3. Transcribe
  progress(requestId, tabId, "transcribing", 70, "Transcribing…");

  const result = await pipe(audioData, {
    language: "german",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback_function: (beams: any) => {
      try {
        const ids = beams?.[0]?.output_token_ids ?? beams?.output_token_ids;
        if (ids) {
          const n = Array.isArray(ids) ? ids.length : 0;
          const pct = Math.min(95, 70 + Math.log2(n + 1) * 3);
          progressThrottled(requestId, tabId, "transcribing", pct, "Transcribing…");
        }
      } catch { /* non-critical */ }
    },
  });

  // 4. Extract text
  let transcript: string;
  if (typeof result === "string") {
    transcript = result;
  } else if (Array.isArray(result)) {
    transcript = result.map((r: { text: string }) => r.text).join(" ");
  } else {
    transcript = (result as { text: string }).text;
  }

  // 5. Done
  send({
    type: MSG.TRANSCRIBE_COMPLETE,
    requestId,
    tabId,
    transcript: transcript.trim(),
  });
}

// ── Pipeline Management ─────────────────────────────────

async function getOrCreatePipeline(
  requestId: string,
  tabId: number,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline) {
    progress(requestId, tabId, "model-loading", 55, "Model ready.");
    return cachedPipeline;
  }

  if (pipelineLoading) {
    throw new Error("Model is loading. Please wait and try again.");
  }

  pipelineLoading = true;

  try {
    progress(requestId, tabId, "model-loading", 10,
      "Loading Whisper model (~250 MB) — first time only…");

    // Try WebGPU first (GPU-accelerated), fall back to WASM (CPU)
    let device: "webgpu" | "wasm" = await detectBestDevice();
    let dtype: string = device === "webgpu" ? "fp32" : "q8";
    console.log(`[VHL Assist] Trying device=${device}, dtype=${dtype}`);

    progress(requestId, tabId, "model-loading", 15,
      `Loading model using ${device === "webgpu" ? "GPU" : "CPU"}…`);

    let pipe: AutomaticSpeechRecognitionPipeline;
    try {
      pipe = (await pipeline("automatic-speech-recognition", MODEL_ID, {
        device,
        dtype,
        progress_callback: makeProgressCb(requestId, tabId),
      })) as AutomaticSpeechRecognitionPipeline;
    } catch (err) {
      if (device === "webgpu") {
        console.warn("[VHL Assist] WebGPU failed, falling back to WASM:", err);
        device = "wasm";
        dtype = "q8";
        progress(requestId, tabId, "model-loading", 20, "GPU unavailable — using CPU…");
        pipe = (await pipeline("automatic-speech-recognition", MODEL_ID, {
          device,
          dtype,
          progress_callback: makeProgressCb(requestId, tabId),
        })) as AutomaticSpeechRecognitionPipeline;
      } else {
        throw err;
      }
    }

    cachedPipeline = pipe;
    return pipe;
  } finally {
    pipelineLoading = false;
  }
}

function makeProgressCb(requestId: string, tabId: number) {
  return (p: { status: string; progress?: number; file?: string; total?: number }) => {
    const file = p.file ? ` (${shortName(p.file)})` : "";

    if (p.status === "progress" && p.progress != null) {
      const mapped = 15 + p.progress * 0.4;
      progressThrottled(requestId, tabId, "model-loading", mapped,
        `Downloading${file}… ${Math.round(p.progress)}%`);
    } else if (p.status === "done") {
      progress(requestId, tabId, "model-loading", 50, `Downloaded${file}.`);
    } else if (p.status === "ready") {
      progress(requestId, tabId, "model-loading", 55, "Model loaded — initializing…");
    } else if (p.status === "initiate" || p.status === "download") {
      progressThrottled(requestId, tabId, "model-loading", 16, `Downloading${file}…`);
    }
  };
}

// ── Audio Decoding ──────────────────────────────────────

async function decodeAudioToFloat32(base64: string): Promise<Float32Array> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const ctx = new AudioContext({ sampleRate: 16000 });
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
  } finally {
    await ctx.close();
  }

  if (buf.sampleRate === 16000 && buf.numberOfChannels === 1) {
    return buf.getChannelData(0);
  }

  const offCtx = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offCtx.destination);
  src.start(0);
  const resampled = await offCtx.startRendering();
  return resampled.getChannelData(0);
}

// ── Device Detection ────────────────────────────────────

async function detectBestDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (nav.gpu) {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch { /* WebGPU unavailable */ }
  return "wasm";
}

// ── Communication ───────────────────────────────────────

let lastProgressT = 0;

function progressThrottled(
  rid: string, tid: number, stage: string, pct: number, msg: string,
): void {
  const now = Date.now();
  if (now - lastProgressT < 300) return;
  lastProgressT = now;
  progress(rid, tid, stage, pct, msg);
}

function progress(
  requestId: string, tabId: number, stage: string, pct: number, message: string,
): void {
  send({ type: MSG.TRANSCRIBE_PROGRESS, requestId, tabId, stage, progress: pct, message });
}

function send(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Utilities ───────────────────────────────────────────

function shortName(file: string): string {
  const name = file.split("/").pop() || file;
  return name.length > 30 ? name.slice(0, 27) + "…" : name;
}
