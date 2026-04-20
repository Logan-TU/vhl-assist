/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Background Service Worker
 *  Orchestrates communication between content script and
 *  offscreen document. Fetches audio files and manages the
 *  offscreen document lifecycle.
 * ────────────────────────────────────────────────────────── */

import {
  MSG,
  STORAGE_KEYS,
  DEFAULTS,
  isTranscriptionLanguage,
} from "../shared/types";

// ── State ───────────────────────────────────────────────

let offscreenDocumentCreated = false;
let offscreenCreatingPromise: Promise<void> | null = null;

// ── Message Listener ────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (!message?.type) return false;

    switch (message.type) {
      case MSG.TRANSCRIBE_REQUEST:
        handleTranscribeRequest(message, sender).catch((err) =>
          console.error("[VHL Assist] Transcribe request error:", err)
        );
        return false;

      // Forward progress/complete/error messages from offscreen → content script
      case MSG.TRANSCRIBE_PROGRESS:
      case MSG.TRANSCRIBE_COMPLETE:
      case MSG.TRANSCRIBE_ERROR:
        forwardToContentScript(message);
        return false;

      case MSG.GET_MODEL_STATUS:
        sendResponse({ status: "ok" });
        return false;

      default:
        return false;
    }
  }
);

// ── Transcription Request Handler ───────────────────────

async function handleTranscribeRequest(
  message: { audioUrl: string; requestId: string },
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const { audioUrl, requestId } = message;
  const tabId = sender.tab?.id;
  if (!tabId) {
    console.error("[VHL Assist] No tab ID in sender");
    return;
  }

  try {
    // 1. Notify content script: starting
    chrome.tabs.sendMessage(tabId, {
      type: MSG.TRANSCRIBE_PROGRESS,
      requestId,
      stage: "model-loading",
      progress: 0,
      message: "Fetching audio file…",
    });

    // 2. Fetch the audio file
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: HTTP ${response.status}`);
    }
    const audioData = await response.arrayBuffer();

    // 4. Ensure offscreen document exists
    await ensureOffscreenDocument();

    // 5. Notify content script: sending to model
    chrome.tabs.sendMessage(tabId, {
      type: MSG.TRANSCRIBE_PROGRESS,
      requestId,
      stage: "model-loading",
      progress: 5,
      message: "Preparing transcription engine…",
    });

    // 6. Send audio to offscreen document for transcription
    // We can't send ArrayBuffer directly via chrome.runtime.sendMessage,
    // so we convert to a transferable format (base64).
    const base64Audio = arrayBufferToBase64(audioData);
    const storage = await chrome.storage.local.get([
      STORAGE_KEYS.TRANSCRIPTION_LANGUAGE,
    ]);
    const languageRaw = storage[STORAGE_KEYS.TRANSCRIPTION_LANGUAGE];
    const language = isTranscriptionLanguage(languageRaw)
      ? languageRaw
      : DEFAULTS.transcriptionLanguage;

    chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_TRANSCRIBE,
      audioBase64: base64Audio,
      requestId,
      tabId,
      language,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: MSG.TRANSCRIBE_ERROR,
        requestId,
        error: errorMsg,
      });
    }
  }
}

// ── Offscreen Document Management ───────────────────────

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenDocumentCreated) return;

  // If another call is already creating the document, wait for it
  if (offscreenCreatingPromise) {
    await offscreenCreatingPromise;
    return;
  }

  offscreenCreatingPromise = (async () => {
    // Check if one already exists (e.g., after service worker restart)
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
    });

    if (existingContexts.length > 0) {
      offscreenDocumentCreated = true;
      return;
    }

    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        "Run Whisper speech-to-text model via ONNX Runtime Web for audio transcription.",
    });
    offscreenDocumentCreated = true;
  })();

  try {
    await offscreenCreatingPromise;
  } finally {
    offscreenCreatingPromise = null;
  }
}

// ── Forward Messages to Content Script ──────────────────

function forwardToContentScript(message: {
  type: string;
  requestId: string;
  tabId?: number;
  [key: string]: unknown;
}): void {
  const tabId = message.tabId as number | undefined;
  if (!tabId) return;

  // Strip tabId before forwarding to content script
  const { tabId: _, ...forwardMsg } = message;
  chrome.tabs.sendMessage(tabId, forwardMsg).catch(() => {
    // Tab may have been closed — ignore
  });
}

// ── Utilities ───────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Extension Install / Update ──────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.set({
      [STORAGE_KEYS.ENABLED]: DEFAULTS.enabled,
      [STORAGE_KEYS.TRANSCRIPTION_LANGUAGE]: DEFAULTS.transcriptionLanguage,
    });
  }
});
