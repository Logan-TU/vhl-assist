/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Options Page Script
 * ────────────────────────────────────────────────────────── */

import { STORAGE_KEYS, DEFAULTS } from "../shared/types";

const enableToggle = document.getElementById("enableToggle") as HTMLInputElement;
const aboutVersion = document.getElementById("aboutVersion") as HTMLElement;
const aboutDesc = document.getElementById("aboutDesc") as HTMLElement;

async function init(): Promise<void> {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.ENABLED]);
  const enabled = (storage[STORAGE_KEYS.ENABLED] as boolean) ?? DEFAULTS.enabled;

  enableToggle.checked = enabled;
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: enableToggle.checked });
  });

  const manifest = chrome.runtime.getManifest();
  aboutVersion.textContent = manifest.version;
  aboutDesc.textContent = manifest.description || "—";
}

init();
