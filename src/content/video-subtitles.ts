/* ──────────────────────────────────────────────────────────
 *  Video Subtitle/Transcript Module
 *  Detects Video.js players, extracts captions, and provides
 *  a searchable transcript UI synchronized with playback.
 * ────────────────────────────────────────────────────────── */

interface CaptionCue {
  startTime: number;
  endTime: number;
  text: string;
}

interface VideoPlayerState {
  player: any; // Video.js player instance
  container: HTMLElement;
  captions: CaptionCue[];
  currentCueIndex: number;
  transcriptPanel: HTMLElement | null;
  timeUpdateHandler?: () => void;
}

const videoPlayers = new WeakMap<HTMLElement, VideoPlayerState>();
const processedVideoContainers = new WeakSet<HTMLElement>();

/**
 * Main entry point: scan for Video.js players and set up subtitle functionality
 */
export function scanForVideoPlayers(): void {
  // Look for Video.js containers (typically .video-js or .vjs-player)
  const videoContainers = document.querySelectorAll<HTMLElement>(
    ".video-js, .vjs-player, [data-vjs-player='true']"
  );

  videoContainers.forEach((container) => {
    if (processedVideoContainers.has(container)) return;
    processedVideoContainers.add(container);

    // Try to get the Video.js player instance
    const player = getVideoJsPlayer(container);
    if (!player) return;

    setupVideoPlayer(container, player);
  });
}

/**
 * Get the Video.js player instance from a container
 */
function getVideoJsPlayer(container: HTMLElement): any {
  // Video.js stores player on window or as data attribute
  const win = window as any;
  if (!win.videojs) return null;

  // Try to get player from the container's id
  const playerId = container.id || container.getAttribute("data-player-id");
  if (playerId && win.videojs.getPlayer) {
    try {
      return win.videojs.getPlayer(playerId);
    } catch {
      // Fallback: try to find player in window.videojs.players
    }
  }

  // Fallback: try to find player instance on container
  if ((container as any).player) {
    return (container as any).player;
  }

  return null;
}

/**
 * Set up transcript panel and event listeners for a video player
 */
function setupVideoPlayer(container: HTMLElement, player: any): void {
  // Extract captions from player
  const captions = extractCaptions(player);
  if (captions.length === 0) {
    // No captions available; could add auto-transcription fallback here
    return;
  }

  const state: VideoPlayerState = {
    player,
    container,
    captions,
    currentCueIndex: -1,
    transcriptPanel: null,
  };

  videoPlayers.set(container, state);

  // Create and inject transcript panel
  const panel = createTranscriptPanel(captions);
  const videoWrapper = container.closest(".vjs-player, .video-js") || container;
  videoWrapper.parentElement?.insertBefore(panel, videoWrapper.nextSibling);

  state.transcriptPanel = panel;

  // Wire up event listeners
  setupPlayerEventListeners(player, state);
}

/**
 * Extract caption tracks from Video.js player
 */
function extractCaptions(player: any): CaptionCue[] {
  const captions: CaptionCue[] = [];

  if (!player) return captions;

  try {
    // Method 1: Try textTracks() API
    if (typeof player.textTracks === "function") {
      const textTracks = player.textTracks();
      if (textTracks && textTracks.length > 0) {
        for (let i = 0; i < textTracks.length; i++) {
          const track = textTracks[i];
          // Look for caption or subtitle tracks
          if (
            track.kind !== "captions" &&
            track.kind !== "subtitles" &&
            track.kind !== "descriptions"
          ) {
            continue;
          }

          // Extract cues from this track
          if (track.cues && track.cues.length > 0) {
            for (let j = 0; j < track.cues.length; j++) {
              const cue = track.cues[j];
              captions.push({
                startTime: cue.startTime || 0,
                endTime: cue.endTime || 0,
                text: extractTextFromCue(cue),
              });
            }
            // Return after first valid track (don't combine multiple)
            return captions;
          }
        }
      }
    }

    // Method 2: Try remoteTextTracks() API (some Video.js versions)
    if (typeof player.remoteTextTracks === "function") {
      const textTracks = player.remoteTextTracks();
      if (textTracks && textTracks.length > 0) {
        for (let i = 0; i < textTracks.length; i++) {
          const track = textTracks[i];
          if (
            track.kind !== "captions" &&
            track.kind !== "subtitles" &&
            track.kind !== "descriptions"
          ) {
            continue;
          }

          if (track.cues && track.cues.length > 0) {
            for (let j = 0; j < track.cues.length; j++) {
              const cue = track.cues[j];
              captions.push({
                startTime: cue.startTime || 0,
                endTime: cue.endTime || 0,
                text: extractTextFromCue(cue),
              });
            }
            return captions;
          }
        }
      }
    }

    // Method 3: Look for <track> elements in video
    const videoEl = player.el?.() || player.tech?.()?.el?.();
    if (videoEl) {
      const trackEls = videoEl.querySelectorAll("track");
      if (trackEls.length > 0) {
        for (let i = 0; i < trackEls.length; i++) {
          const trackEl = trackEls[i];
          if (
            trackEl.kind !== "captions" &&
            trackEl.kind !== "subtitles" &&
            trackEl.kind !== "descriptions"
          ) {
            continue;
          }

          // Try to fetch and parse the track file (VTT or other format)
          const src = trackEl.getAttribute("src");
          if (src) {
            // Don't fetch async during setup, would need to handle async
            // For now, rely on player API
          }
        }
      }
    }
  } catch (error) {
    console.warn("[vhl-assist] Error extracting captions:", error);
  }

  return captions;
}

/**
 * Extract text content from a cue object (handles different caption formats)
 */
function extractTextFromCue(cue: any): string {
  if (typeof cue.text === "string") {
    return cue.text;
  }

  // Handle VTTCue objects with data-content property
  if (cue.data && typeof cue.data === "string") {
    return cue.data;
  }

  // Handle cues with content property
  if (cue.content && typeof cue.content === "string") {
    return cue.content;
  }

  // Fallback: try to extract text from HTML content
  if (cue.innerHTML) {
    const temp = document.createElement("div");
    temp.innerHTML = cue.innerHTML;
    return temp.textContent || "";
  }

  return "";
}

/**
 * Create the transcript UI panel
 */
function createTranscriptPanel(captions: CaptionCue[]): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "vhl-assist-transcript-panel";
  panel.innerHTML = `
    <div class="vhl-assist-transcript-panel__header">
      <span class="vhl-assist-transcript-panel__title">Transcript</span>
      <div class="vhl-assist-transcript-panel__controls">
        <input 
          type="text" 
          class="vhl-assist-transcript-panel__search" 
          placeholder="Search transcript…"
          aria-label="Search transcript"
        />
        <button 
          class="vhl-assist-transcript-panel__close" 
          title="Close" 
          aria-label="Close transcript"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="vhl-assist-transcript-panel__body">
      <div class="vhl-assist-transcript-panel__captions"></div>
    </div>
  `;

  const captionsContainer = panel.querySelector(
    ".vhl-assist-transcript-panel__captions"
  ) as HTMLElement;

  // Render captions
  captions.forEach((cue, index) => {
    const cueEl = document.createElement("div");
    cueEl.className = "vhl-assist-transcript-cue";
    cueEl.setAttribute("data-index", String(index));
    cueEl.setAttribute("data-start", String(cue.startTime));
    cueEl.setAttribute("data-end", String(cue.endTime));
    cueEl.textContent = cue.text;
    captionsContainer.appendChild(cueEl);
  });

  // Close button
  panel.querySelector(".vhl-assist-transcript-panel__close")?.addEventListener("click", () => {
    panel.style.display = "none";
  });

  // Search functionality
  const searchInput = panel.querySelector(
    ".vhl-assist-transcript-panel__search"
  ) as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      filterTranscript(panel, query);
    });
  }

  return panel;
}

/**
 * Filter transcript based on search query
 */
function filterTranscript(panel: HTMLElement, query: string): void {
  const cues = panel.querySelectorAll(".vhl-assist-transcript-cue");
  cues.forEach((cue) => {
    const text = cue.textContent?.toLowerCase() || "";
    const matches = query === "" || text.includes(query);
    cue.classList.toggle("vhl-assist-transcript-cue--hidden", !matches);
    cue.classList.toggle("vhl-assist-transcript-cue--highlighted", matches && query !== "");
  });
}

/**
 * Set up event listeners for video player
 */
function setupPlayerEventListeners(player: any, state: VideoPlayerState): void {
  if (!player) return;

  // Update current cue on timeupdate
  const timeUpdateHandler = () => {
    updateCurrentCue(state);
  };

  state.timeUpdateHandler = timeUpdateHandler;

  // Click on cues to seek
  const panel = state.transcriptPanel;
  if (panel) {
    const cues = panel.querySelectorAll(".vhl-assist-transcript-cue");
    cues.forEach((cueEl) => {
      cueEl.addEventListener("click", () => {
        const startTime = parseFloat(cueEl.getAttribute("data-start") || "0");
        if (typeof player.currentTime === "function") {
          player.currentTime(startTime);
        } else {
          player.currentTime = startTime;
        }
      });
    });
  }

  // Attach timeupdate listener
  if (typeof player.on === "function") {
    player.on("timeupdate", timeUpdateHandler);
  } else if (player.addEventListener) {
    player.addEventListener("timeupdate", timeUpdateHandler);
  }
}

/**
 * Update which caption is highlighted based on current playback time
 */
function updateCurrentCue(state: VideoPlayerState): void {
  const { player, captions, transcriptPanel, currentCueIndex } = state;
  if (!player || !transcriptPanel) return;

  let currentTime = 0;
  if (typeof player.currentTime === "function") {
    currentTime = player.currentTime();
  } else if (typeof player.currentTime === "number") {
    currentTime = player.currentTime;
  }

  let newCueIndex = -1;

  for (let i = 0; i < captions.length; i++) {
    const cue = captions[i];
    if (currentTime >= cue.startTime && currentTime < cue.endTime) {
      newCueIndex = i;
      break;
    }
  }

  if (newCueIndex === currentCueIndex) return;

  // Update highlighting
  const cueEls = transcriptPanel.querySelectorAll(".vhl-assist-transcript-cue");

  if (currentCueIndex >= 0 && currentCueIndex < cueEls.length) {
    cueEls[currentCueIndex].classList.remove("vhl-assist-transcript-cue--active");
  }

  if (newCueIndex >= 0 && newCueIndex < cueEls.length) {
    const activeEl = cueEls[newCueIndex] as HTMLElement;
    activeEl.classList.add("vhl-assist-transcript-cue--active");
    // Scroll into view
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  state.currentCueIndex = newCueIndex;
}

/**
 * Initialize and watch for video players
 */
export function initVideoSubtitles(): void {
  scanForVideoPlayers();

  // Watch for dynamically-added videos (VHL is SPA-like)
  const observer = new MutationObserver(() => {
    scanForVideoPlayers();
  });

  const target =
    document.getElementById("activity_body") ||
    document.getElementById("activity_shell") ||
    document.body;

  observer.observe(target, { childList: true, subtree: true });
}

