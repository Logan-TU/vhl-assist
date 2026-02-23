/* ──────────────────────────────────────────────────────────
 *  VHL Assist — Popup Script
 * ────────────────────────────────────────────────────────── */

import { STORAGE_KEYS, DEFAULTS } from "../shared/types";

const enableToggle = document.getElementById("enableToggle") as HTMLInputElement;
const optionsLink = document.getElementById("optionsLink") as HTMLAnchorElement;

async function init(): Promise<void> {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.ENABLED]);
  const enabled = (storage[STORAGE_KEYS.ENABLED] as boolean) ?? DEFAULTS.enabled;

  enableToggle.checked = enabled;
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: enableToggle.checked });
  });

  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
