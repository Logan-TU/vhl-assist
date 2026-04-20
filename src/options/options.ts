/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Options Page Script
 * ────────────────────────────────────────────────────────── */

import {
  STORAGE_KEYS,
  DEFAULTS,
  isTranscriptionLanguage,
} from "../shared/types";

const enableToggle = document.getElementById("enableToggle") as HTMLInputElement;
const languageSelect = document.getElementById("languageSelect") as HTMLSelectElement;
const aboutVersion = document.getElementById("aboutVersion") as HTMLElement;
const aboutDesc = document.getElementById("aboutDesc") as HTMLElement;

async function init(): Promise<void> {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.TRANSCRIPTION_LANGUAGE,
  ]);
  const enabled = (storage[STORAGE_KEYS.ENABLED] as boolean) ?? DEFAULTS.enabled;
  const languageRaw = storage[STORAGE_KEYS.TRANSCRIPTION_LANGUAGE];
  const language = isTranscriptionLanguage(languageRaw)
    ? languageRaw
    : DEFAULTS.transcriptionLanguage;

  enableToggle.checked = enabled;
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: enableToggle.checked });
  });

  languageSelect.value = language;
  languageSelect.addEventListener("change", () => {
    const selected = languageSelect.value;
    if (!isTranscriptionLanguage(selected)) {
      console.warn(
        `[VHL Assist] Unsupported language "${selected}". Reverting to auto-detect.`
      );
      languageSelect.value = DEFAULTS.transcriptionLanguage;
      chrome.storage.local.set({
        [STORAGE_KEYS.TRANSCRIPTION_LANGUAGE]: DEFAULTS.transcriptionLanguage,
      });
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEYS.TRANSCRIPTION_LANGUAGE]: selected });
  });

  const manifest = chrome.runtime.getManifest();
  aboutVersion.textContent = manifest.version;
  aboutDesc.textContent = manifest.description || "—";
}

init();
