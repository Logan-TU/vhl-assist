/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Popup Script
 *  Handles model selection, enable/disable toggle,
 *  and model status display.
 * ────────────────────────────────────────────────────────── */

import {
  WHISPER_MODELS,
  STORAGE_KEYS,
  DEFAULTS,
  type ModelKey,
} from "../shared/types";

// ── DOM References ──────────────────────────────────────

const enableToggle = document.getElementById("enableToggle") as HTMLInputElement;
const modelList = document.getElementById("modelList") as HTMLDivElement;
const modelStatus = document.getElementById("modelStatus") as HTMLDivElement;
const optionsLink = document.getElementById("optionsLink") as HTMLAnchorElement;

// ── Initialization ──────────────────────────────────────

async function init(): Promise<void> {
  // Load saved settings
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.MODEL_KEY,
  ]);

  const enabled = (storage[STORAGE_KEYS.ENABLED] as boolean) ?? DEFAULTS.enabled;
  const modelKey: ModelKey =
    (storage[STORAGE_KEYS.MODEL_KEY] as ModelKey) ?? DEFAULTS.modelKey;

  // Set up enable toggle
  enableToggle.checked = enabled;
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({
      [STORAGE_KEYS.ENABLED]: enableToggle.checked,
    });
  });

  // Render model list
  renderModelList(modelKey);

  // Options link
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

// ── Model List Rendering ────────────────────────────────

function renderModelList(selectedKey: ModelKey): void {
  modelList.innerHTML = "";

  for (const [key, model] of Object.entries(WHISPER_MODELS)) {
    const isSelected = key === selectedKey;

    const item = document.createElement("label");
    item.className = `model-card${isSelected ? " model-card--selected" : ""}`;

    item.innerHTML = `
      <input type="radio" name="model" value="${key}" ${isSelected ? "checked" : ""} class="model-card__radio">
      <div class="model-card__content">
        <div class="model-card__header">
          <span class="model-card__name">${model.label}</span>
          <span class="model-card__size">${model.size}</span>
        </div>
        <div class="model-card__meta">
          <span class="model-card__desc">${model.description}</span>
          <span class="model-card__accuracy">Accuracy: ${model.accuracy}</span>
        </div>
      </div>
    `;

    const radio = item.querySelector("input") as HTMLInputElement;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        selectModel(key as ModelKey);
      }
    });

    modelList.appendChild(item);
  }

  updateStatusDisplay(selectedKey);
}

// ── Model Selection ─────────────────────────────────────

function selectModel(key: ModelKey): void {
  chrome.storage.local.set({ [STORAGE_KEYS.MODEL_KEY]: key });

  // Update visual selection
  modelList.querySelectorAll(".model-card").forEach((card) => {
    card.classList.remove("model-card--selected");
  });
  const selectedCard = modelList.querySelector(
    `input[value="${key}"]`
  )?.closest(".model-card");
  selectedCard?.classList.add("model-card--selected");

  updateStatusDisplay(key);
}

// ── Status Display ──────────────────────────────────────

function updateStatusDisplay(key: ModelKey): void {
  const model = WHISPER_MODELS[key];
  modelStatus.innerHTML = `
    <span class="popup__status-text">
      <strong>${model.label}</strong> selected. Model will download on first transcription (${model.size}).
    </span>
  `;
}

// ── Boot ────────────────────────────────────────────────

init();
