/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Options Page Script
 *  Mirrors popup settings + version/about info.
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
const aboutVersion = document.getElementById("aboutVersion") as HTMLElement;
const aboutDesc = document.getElementById("aboutDesc") as HTMLElement;

// ── Initialization ──────────────────────────────────────

async function init(): Promise<void> {
  // Load settings
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.MODEL_KEY,
  ]);

  const enabled = (storage[STORAGE_KEYS.ENABLED] as boolean) ?? DEFAULTS.enabled;
  const modelKey: ModelKey =
    (storage[STORAGE_KEYS.MODEL_KEY] as ModelKey) ?? DEFAULTS.modelKey;

  // Enable toggle
  enableToggle.checked = enabled;
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({
      [STORAGE_KEYS.ENABLED]: enableToggle.checked,
    });
  });

  // Model list
  renderModelList(modelKey);

  // About info
  const manifest = chrome.runtime.getManifest();
  aboutVersion.textContent = manifest.version;
  aboutDesc.textContent = manifest.description || "—";
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
          <span class="model-card__badge">${model.accuracy}</span>
        </div>
        <div class="model-card__details">
          <span>${model.description}</span>
          <span class="model-card__size">${model.size} download</span>
        </div>
      </div>
    `;

    const radio = item.querySelector("input") as HTMLInputElement;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        chrome.storage.local.set({ [STORAGE_KEYS.MODEL_KEY]: key });
        modelList.querySelectorAll(".model-card").forEach((c) =>
          c.classList.remove("model-card--selected")
        );
        item.classList.add("model-card--selected");
      }
    });

    modelList.appendChild(item);
  }
}

// ── Boot ────────────────────────────────────────────────

init();
