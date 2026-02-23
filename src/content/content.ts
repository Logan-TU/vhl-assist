/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Content Script
 *  Injected into VHL Central activity pages.
 *  Detects <audio> elements AND recording-v2 activities,
 *  injects Transcribe buttons, and displays transcription
 *  results inline on the page.
 * ────────────────────────────────────────────────────────── */

import {
  MSG,
  STORAGE_KEYS,
  DEFAULTS,
  type TranscribeProgress,
  type TranscribeComplete,
  type TranscribeError,
  type ProgressMessage,
} from "../shared/types";

// ── State ───────────────────────────────────────────────

/** Set of audio elements we've already processed (avoid duplicates). */
const processedAudios = new WeakSet<HTMLAudioElement>();

/** Set of recording-v2 question blocks we've already processed. */
const processedRecItems = new WeakSet<HTMLElement>();

/** Set of activity_question_blocks where we've injected a batch button. */
const processedBatchBlocks = new WeakSet<HTMLElement>();

/** Map from requestId → DOM references for active transcriptions. */
const activeRequests = new Map<
  string,
  {
    button: HTMLButtonElement;
    panel: HTMLElement;
    audioEl?: HTMLAudioElement;
  }
>();

/** Track batch transcription state. */
interface BatchState {
  total: number;
  done: number;
  button: HTMLButtonElement;
  requestIds: Set<string>;
}
let activeBatch: BatchState | null = null;

// ── Initialization ──────────────────────────────────────

async function init(): Promise<void> {
  const storage = await chrome.storage.local.get(STORAGE_KEYS.ENABLED);
  const enabled = storage[STORAGE_KEYS.ENABLED] ?? DEFAULTS.enabled;
  if (!enabled) return;

  // Scan for both activity types
  scanForAudioElements();
  scanForRecordingActivities();

  // Watch for dynamically-added elements (VHL is SPA-like)
  const observer = new MutationObserver(() => {
    scanForAudioElements();
    scanForRecordingActivities();
  });
  const target =
    document.getElementById("activity_body") ||
    document.getElementById("activity_shell") ||
    document.body;
  observer.observe(target, { childList: true, subtree: true });

  // Listen for messages from the service worker (progress / results)
  chrome.runtime.onMessage.addListener(handleServiceWorkerMessage);
}

// ── Audio Element Scanning ──────────────────────────────

function scanForAudioElements(): void {
  const audioElements = document.querySelectorAll<HTMLAudioElement>("audio");
  audioElements.forEach((audioEl) => {
    if (processedAudios.has(audioEl)) return;
    processedAudios.add(audioEl);
    injectTranscribeButton(audioEl);
  });
}

// ── Recording Activity Scanning ─────────────────────────

function scanForRecordingActivities(): void {
  const recItems = document.querySelectorAll<HTMLElement>(
    ".js-recording-v2-item[data-prompt]"
  );
  if (recItems.length === 0) return;

  // Group items by their parent activity_question_block
  const blockMap = new Map<HTMLElement, HTMLElement[]>();
  recItems.forEach((item) => {
    if (processedRecItems.has(item)) return;
    processedRecItems.add(item);

    // Create inline transcript placeholder for this question
    createInlineTranscriptPlaceholder(item);

    // Find the owning activity_question_block
    const block = item.closest<HTMLElement>(".activity_question_block");
    if (block) {
      if (!blockMap.has(block)) blockMap.set(block, []);
      blockMap.get(block)!.push(item);
    }
  });

  // For each block that has new items, ensure a "Transcribe All" button exists
  blockMap.forEach((_items, block) => {
    if (processedBatchBlocks.has(block)) return;
    processedBatchBlocks.add(block);
    injectTranscribeAllButton(block);
  });
}

function createInlineTranscriptPlaceholder(item: HTMLElement): void {
  // Place transcript AFTER the recording item — never inside it,
  // because VHL's own JS depends on the internal structure.
  const placeholder = document.createElement("div");
  placeholder.className = "vhl-assist-inline-transcript vhl-assist-inline-transcript--hidden";
  placeholder.setAttribute("role", "region");
  placeholder.setAttribute("aria-label", "Transcription");
  placeholder.dataset.questionId = item.dataset.questionId || "";
  item.after(placeholder);
}

// ── "Transcribe All" Button ─────────────────────────────

function injectTranscribeAllButton(block: HTMLElement): void {
  const button = document.createElement("button");
  button.className = "vhl-assist-btn vhl-assist-btn--batch";
  button.type = "button";
  button.innerHTML = `
    <svg class="vhl-assist-btn__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" fill="currentColor"/>
      <path d="M5 9a1 1 0 00-2 0 7 7 0 0014 0 1 1 0 10-2 0 5 5 0 01-10 0z" fill="currentColor"/>
      <path d="M9 16.93V18a1 1 0 102 0v-1.07A7.01 7.01 0 0017 10a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7.01 7.01 0 006 6.93z" fill="currentColor"/>
    </svg>
    <span class="vhl-assist-btn__label">Transcribe All</span>
  `;
  button.title = "Transcribe all audio on this page with VHL Assist";

  button.addEventListener("click", () => handleTranscribeAllClick(block, button));

  // Insert before the <ol> inside the block
  const ol = block.querySelector("ol");
  if (ol) {
    block.insertBefore(button, ol);
  } else {
    block.prepend(button);
  }
}

// ── Batch Transcription Click Handler ───────────────────

async function handleTranscribeAllClick(
  block: HTMLElement,
  batchButton: HTMLButtonElement
): Promise<void> {
  // Prevent double-clicks or clicking while a batch is running
  if (batchButton.classList.contains("vhl-assist-btn--loading")) return;
  if (activeBatch) return;

  const items = block.querySelectorAll<HTMLElement>(
    ".js-recording-v2-item[data-prompt]"
  );
  if (items.length === 0) return;

  // Collect audio URLs and prepare state
  const requests: { item: HTMLElement; audioUrl: string; requestId: string }[] = [];
  items.forEach((item) => {
    try {
      const promptData = JSON.parse(item.dataset.prompt || "{}");
      const audioUrl = promptData.audio_path;
      if (!audioUrl) return;

      const requestId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      requests.push({ item, audioUrl, requestId });
    } catch { /* skip malformed data-prompt */ }
  });

  if (requests.length === 0) return;

  // Set up batch state
  batchButton.classList.add("vhl-assist-btn--loading");
  batchButton.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
    `Transcribing 0/${requests.length}…`;

  const batchRequestIds = new Set<string>();
  activeBatch = {
    total: requests.length,
    done: 0,
    button: batchButton,
    requestIds: batchRequestIds,
  };

  // Register each request and send to service worker
  for (const { item, audioUrl, requestId } of requests) {
    batchRequestIds.add(requestId);

    // Transcript placeholder is a sibling after the item, not inside it
    const questionId = item.dataset.questionId || "";
    const panel = item.parentElement?.querySelector<HTMLElement>(
      `.vhl-assist-inline-transcript[data-question-id="${questionId}"]`
    ) || item.nextElementSibling as HTMLElement | null;
    if (panel) {
      showInlineLoading(panel, "Waiting…");
    }

    activeRequests.set(requestId, {
      button: batchButton,
      panel: panel || document.createElement("div"),
    });

    // Fire all requests — service worker handles fetch, offscreen queues transcription
    try {
      await chrome.runtime.sendMessage({
        type: MSG.TRANSCRIBE_REQUEST,
        audioUrl,
        requestId,
      });
    } catch (err) {
      if (panel) showInlineError(panel, `Failed: ${String(err)}`);
      batchItemDone(requestId);
    }
  }
}

// ── Button Injection ────────────────────────────────────

function injectTranscribeButton(audioEl: HTMLAudioElement): void {
  // Find the audio source URL
  const sourceEl = audioEl.querySelector("source");
  const audioUrl = audioEl.src || sourceEl?.src;
  if (!audioUrl) return;

  // Create the Transcribe button
  const button = document.createElement("button");
  button.className = "vhl-assist-btn";
  button.type = "button";
  button.innerHTML = `
    <svg class="vhl-assist-btn__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" fill="currentColor"/>
      <path d="M5 9a1 1 0 00-2 0 7 7 0 0014 0 1 1 0 10-2 0 5 5 0 01-10 0z" fill="currentColor"/>
      <path d="M9 16.93V18a1 1 0 102 0v-1.07A7.01 7.01 0 0017 10a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7.01 7.01 0 006 6.93z" fill="currentColor"/>
    </svg>
    <span class="vhl-assist-btn__label">Transcribe</span>
  `;
  button.title = "Transcribe this audio with VHL Assist";

  button.addEventListener("click", () =>
    handleTranscribeClick(audioEl, audioUrl, button)
  );

  // Insert the button after the audio element's player container
  const playerContainer =
    audioEl.closest(".player") ||
    audioEl.closest(".reference_model_content") ||
    audioEl.parentElement;
  if (playerContainer) {
    playerContainer.appendChild(button);
  }
}

// ── Transcribe Button Click Handler ─────────────────────

async function handleTranscribeClick(
  audioEl: HTMLAudioElement,
  audioUrl: string,
  button: HTMLButtonElement
): Promise<void> {
  // Prevent double-clicks
  if (button.classList.contains("vhl-assist-btn--loading")) return;
  button.classList.add("vhl-assist-btn--loading");
  button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
    "Starting…";

  // Create or reuse the transcript panel
  const panel = getOrCreateTranscriptPanel(audioEl);
  showPanelLoading(panel, "Initializing transcription…");

  // Generate a unique request ID
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  activeRequests.set(requestId, { button, panel, audioEl });

  // Send request to service worker
  try {
    await chrome.runtime.sendMessage({
      type: MSG.TRANSCRIBE_REQUEST,
      audioUrl,
      requestId,
    });
  } catch (err) {
    showPanelError(panel, `Failed to start transcription: ${String(err)}`);
    resetButton(button);
    activeRequests.delete(requestId);
  }
}

// ── Transcript Panel ────────────────────────────────────

function getOrCreateTranscriptPanel(audioEl: HTMLAudioElement): HTMLElement {
  // Check if we already have a panel for this audio element
  const existingPanel =
    audioEl.closest(".c-block-pair__question-column")?.querySelector(".vhl-assist-panel") ||
    audioEl.closest(".player")?.parentElement?.querySelector(".vhl-assist-panel");
  if (existingPanel) return existingPanel as HTMLElement;

  // Create the panel
  const panel = document.createElement("div");
  panel.className = "vhl-assist-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Audio Transcription");

  // Find the ideal injection point: between .c-block-pair__references and .activity_question_block
  const references = audioEl.closest(".c-block-pair__references");
  const questionColumn = audioEl.closest(".c-block-pair__question-column");

  if (references && questionColumn) {
    const questionBlock = questionColumn.querySelector(".activity_question_block");
    if (questionBlock) {
      questionColumn.insertBefore(panel, questionBlock);
      return panel;
    }
  }

  // Fallback: insert after the closest player/reference container
  const container =
    audioEl.closest(".reference_audio") ||
    audioEl.closest(".reference_model_content") ||
    audioEl.closest(".player") ||
    audioEl.parentElement;
  if (container?.parentElement) {
    container.parentElement.insertBefore(panel, container.nextSibling);
  } else {
    audioEl.after(panel);
  }

  return panel;
}

function showPanelLoading(panel: HTMLElement, message: string, progress?: number): void {
  const progressBar =
    progress !== undefined
      ? `<div class="vhl-assist-panel__progress-track">
           <div class="vhl-assist-panel__progress-fill" style="width:${progress}%"></div>
         </div>`
      : "";

  panel.innerHTML = `
    <div class="vhl-assist-panel__header">
      <span class="vhl-assist-panel__title">Transcript</span>
    </div>
    <div class="vhl-assist-panel__body vhl-assist-panel__body--loading">
      <div class="vhl-assist-panel__spinner"></div>
      <span class="vhl-assist-panel__status">${escapeHtml(message)}</span>
      ${progressBar}
    </div>
  `;
  panel.classList.remove("vhl-assist-panel--hidden");
}

function showPanelResult(panel: HTMLElement, transcript: string): void {
  panel.innerHTML = `
    <div class="vhl-assist-panel__header">
      <span class="vhl-assist-panel__title">Transcript</span>
      <div class="vhl-assist-panel__actions">
        <button class="vhl-assist-panel__copy" title="Copy transcript">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v9a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V5.414A2 2 0 0015.414 4L13 1.586A2 2 0 0011.586 1H10a2 2 0 00-2 1zm2 1h1.586L14 5.414V13h-1V7a2 2 0 00-2-2H8V4a1 1 0 011-1zm-4 4h5a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z"/>
          </svg>
        </button>
        <button class="vhl-assist-panel__close" title="Close transcript">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="vhl-assist-panel__body">
      <p class="vhl-assist-panel__text">${escapeHtml(transcript)}</p>
    </div>
  `;

  // Bind copy button
  panel.querySelector(".vhl-assist-panel__copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(transcript).then(() => {
      const copyBtn = panel.querySelector<HTMLButtonElement>(".vhl-assist-panel__copy");
      if (copyBtn) {
        copyBtn.title = "Copied!";
        copyBtn.classList.add("vhl-assist-panel__copy--done");
        setTimeout(() => {
          copyBtn.title = "Copy transcript";
          copyBtn.classList.remove("vhl-assist-panel__copy--done");
        }, 2000);
      }
    });
  });

  // Bind close button
  panel.querySelector(".vhl-assist-panel__close")?.addEventListener("click", () => {
    panel.classList.add("vhl-assist-panel--hidden");
  });
}

function showPanelError(panel: HTMLElement, error: string): void {
  panel.innerHTML = `
    <div class="vhl-assist-panel__header">
      <span class="vhl-assist-panel__title">Transcript</span>
      <button class="vhl-assist-panel__close" title="Close">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
    </div>
    <div class="vhl-assist-panel__body vhl-assist-panel__body--error">
      <span class="vhl-assist-panel__error-icon">⚠</span>
      <span>${escapeHtml(error)}</span>
    </div>
  `;
  panel.querySelector(".vhl-assist-panel__close")?.addEventListener("click", () => {
    panel.classList.add("vhl-assist-panel--hidden");
  });
}

// ── Message Handling ────────────────────────────────────

function handleServiceWorkerMessage(
  message: ProgressMessage,
  _sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): void {
  if (!message || !("requestId" in message)) return;

  const requestId = message.requestId;
  const request = activeRequests.get(requestId);
  if (!request) return;

  const { button, panel } = request;
  const isBatch = activeBatch?.requestIds.has(requestId) ?? false;

  switch (message.type) {
    case MSG.TRANSCRIBE_PROGRESS: {
      const msg = message as TranscribeProgress;
      if (isBatch) {
        // Update inline transcript area for this question
        const displayMsg = msg.message || "Transcribing…";
        showInlineLoading(panel, displayMsg);
        // Update batch button label
        button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
          `Transcribing ${activeBatch!.done}/${activeBatch!.total}…`;
      } else {
        // Original single-audio panel behavior
        const stageLabel =
          msg.stage === "model-loading" ? "Loading model" : "Transcribing";
        const displayMsg = msg.message || `${stageLabel}…`;
        button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
          `${Math.round(msg.progress)}%`;
        showPanelLoading(panel, displayMsg, msg.progress);
      }
      break;
    }
    case MSG.TRANSCRIBE_COMPLETE: {
      const msg = message as TranscribeComplete;
      if (isBatch) {
        showInlineResult(panel, msg.transcript);
        batchItemDone(requestId);
      } else {
        showPanelResult(panel, msg.transcript);
        resetButton(button);
      }
      activeRequests.delete(requestId);
      break;
    }
    case MSG.TRANSCRIBE_ERROR: {
      const msg = message as TranscribeError;
      if (isBatch) {
        showInlineError(panel, msg.error);
        batchItemDone(requestId);
      } else {
        showPanelError(panel, msg.error);
        resetButton(button);
      }
      activeRequests.delete(requestId);
      break;
    }
  }
}

// ── Batch State Management ──────────────────────────────

function batchItemDone(requestId: string): void {
  if (!activeBatch) return;
  activeBatch.requestIds.delete(requestId);
  activeBatch.done++;

  const { done, total, button } = activeBatch;
  button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
    `Transcribing ${done}/${total}…`;

  if (activeBatch.requestIds.size === 0) {
    // All done
    button.classList.remove("vhl-assist-btn--loading");
    button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
      "Transcribe All";
    activeBatch = null;
  }
}

// ── Inline Transcript Helpers (for batch/recording activities) ──

function showInlineLoading(el: HTMLElement, message: string): void {
  el.classList.remove("vhl-assist-inline-transcript--hidden");
  el.innerHTML = `
    <div class="vhl-assist-inline-transcript__loading">
      <div class="vhl-assist-inline-transcript__spinner"></div>
      <span class="vhl-assist-inline-transcript__status">${escapeHtml(message)}</span>
    </div>
  `;
}

function showInlineResult(el: HTMLElement, transcript: string): void {
  el.classList.remove("vhl-assist-inline-transcript--hidden");
  el.innerHTML = `
    <div class="vhl-assist-inline-transcript__result">
      <span class="vhl-assist-inline-transcript__text">${escapeHtml(transcript)}</span>
      <button class="vhl-assist-inline-transcript__copy" title="Copy">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v9a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V5.414A2 2 0 0015.414 4L13 1.586A2 2 0 0011.586 1H10a2 2 0 00-2 1zm2 1h1.586L14 5.414V13h-1V7a2 2 0 00-2-2H8V4a1 1 0 011-1zm-4 4h5a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z"/>
        </svg>
      </button>
    </div>
  `;
  el.querySelector(".vhl-assist-inline-transcript__copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(transcript).then(() => {
      const btn = el.querySelector<HTMLButtonElement>(".vhl-assist-inline-transcript__copy");
      if (btn) {
        btn.title = "Copied!";
        btn.classList.add("vhl-assist-inline-transcript__copy--done");
        setTimeout(() => { btn.title = "Copy"; btn.classList.remove("vhl-assist-inline-transcript__copy--done"); }, 2000);
      }
    });
  });
}

function showInlineError(el: HTMLElement, error: string): void {
  el.classList.remove("vhl-assist-inline-transcript--hidden");
  el.innerHTML = `
    <div class="vhl-assist-inline-transcript__error">
      <span class="vhl-assist-inline-transcript__error-icon">⚠</span>
      <span>${escapeHtml(error)}</span>
    </div>
  `;
}

// ── Utilities ───────────────────────────────────────────

function resetButton(button: HTMLButtonElement): void {
  button.classList.remove("vhl-assist-btn--loading");
  button.querySelector<HTMLSpanElement>(".vhl-assist-btn__label")!.textContent =
    "Transcribe";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Boot ────────────────────────────────────────────────
init();
