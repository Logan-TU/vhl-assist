/* ──────────────────────────────────────────────────────────
 *  Video Subtitle/Transcript Module
 *  Detects HTML5 video elements in Video.js players and
 *  extracts captions from <track> elements to display a
 *  searchable, synchronized transcript panel.
 * ────────────────────────────────────────────────────────── */

interface CaptionCue {
  startTime: number;
  endTime: number;
  text: string;
}

interface VideoPlayerState {
  videoEl: HTMLVideoElement;
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
export function initVideoSubtitles(): void {
  console.log("[vhl-assist] Video subtitles module initialized");
  
  // Scan for video players
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

/**
 * Scan for video players in .video-js and .vjs-player containers
 */
function scanForVideoPlayers(): void {
  // Look for Video.js containers
  const videoContainers = document.querySelectorAll<HTMLElement>(
    ".video-js, .vjs-player, [data-vjs-player='true']"
  );
  console.log("[vhl-assist] Found video containers:", videoContainers.length);

  videoContainers.forEach((container) => {
    if (processedVideoContainers.has(container)) return;
    processedVideoContainers.add(container);

    // Look for native HTML5 video element inside the container
    const videoEl = container.querySelector<HTMLVideoElement>("video");
    console.log("[vhl-assist] Found video element:", !!videoEl);
    
    if (videoEl) {
      setupVideoPlayerFromElement(container, videoEl);
    } else {
      console.log("[vhl-assist] No <video> element found in container");
    }
  });
}

/**
 * Set up transcript panel from an HTML5 <video> element
 */
function setupVideoPlayerFromElement(container: HTMLElement, videoEl: HTMLVideoElement): void {
  // Look for <track> elements with captions
  const tracks = videoEl.querySelectorAll<HTMLTrackElement>(
    "track[kind='captions'], track[kind='subtitles'], track[kind='descriptions']"
  );
  console.log("[vhl-assist] Found track elements:", tracks.length);
  
  if (tracks.length === 0) {
    console.log("[vhl-assist] No caption tracks found");
    return;
  }
  
  // Try to extract captions from tracks
  const captions = extractCaptionsFromTracks(videoEl);
  console.log("[vhl-assist] Extracted captions:", captions.length);
  
  if (captions.length === 0) {
    console.log("[vhl-assist] No captions could be extracted from tracks");
    return;
  }
  
  const state: VideoPlayerState = {
    videoEl,
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
  console.log("[vhl-assist] Transcript panel injected into DOM");
  
  state.transcriptPanel = panel;
  
  // Wire up event listeners
  setupPlayerEventListenersFromElement(videoEl, state);
}

/**
 * Extract captions from a video element's text tracks
 */
function extractCaptionsFromTracks(videoEl: HTMLVideoElement): CaptionCue[] {
  const captions: CaptionCue[] = [];
  
  // VideoElement.textTracks is a live list of available tracks
  const textTracks = videoEl.textTracks;
  if (!textTracks) return captions;
  
  for (let i = 0; i < textTracks.length; i++) {
    const track = textTracks[i];
    
    // Look for caption/subtitle/description tracks
    if (track.kind !== "captions" && track.kind !== "subtitles" && track.kind !== "descriptions") {
      continue;
    }
    
    console.log("[vhl-assist] Processing track:", track.label, "kind:", track.kind);
    
    // Extract cues
    if (track.cues) {
      for (let j = 0; j < track.cues.length; j++) {
        const cue = track.cues[j];
        if (cue && cue.startTime !== undefined && cue.endTime !== undefined) {
          captions.push({
            startTime: cue.startTime,
            endTime: cue.endTime,
            text: cue.text,
          });
        }
      }
    }
    
    // Return after first valid track (don't combine multiple)
    if (captions.length > 0) break;
  }
  
  return captions;
}

/**
 * Set up player event listeners for HTML5 video element
 */
function setupPlayerEventListenersFromElement(videoEl: HTMLVideoElement, state: VideoPlayerState): void {
  const handler = () => updateCurrentCue(videoEl.currentTime, state);
  
  videoEl.addEventListener("timeupdate", handler);
  state.timeUpdateHandler = handler;
}

/**
 * Update which caption is currently active
 */
function updateCurrentCue(currentTime: number, state: VideoPlayerState): void {
  const { captions, transcriptPanel, currentCueIndex } = state;
  if (!transcriptPanel) return;
  
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
 * Create the transcript panel UI
 */
function createTranscriptPanel(captions: CaptionCue[]): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "vhl-assist-transcript-panel";
  
  // Header
  const header = document.createElement("div");
  header.className = "vhl-assist-transcript-panel__header";
  header.textContent = "Transcript";
  panel.appendChild(header);
  
  // Search input
  const searchContainer = document.createElement("div");
  searchContainer.className = "vhl-assist-transcript-panel__search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search transcript...";
  searchInput.addEventListener("input", (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase();
    const cueEls = panel.querySelectorAll(".vhl-assist-transcript-cue");
    
    cueEls.forEach((el) => {
      const text = el.textContent || "";
      el.classList.toggle("vhl-assist-transcript-cue--hidden", !text.toLowerCase().includes(query));
    });
  });
  searchContainer.appendChild(searchInput);
  panel.appendChild(searchContainer);
  
  // Captions list
  const captionList = document.createElement("div");
  captionList.className = "vhl-assist-transcript-panel__list";
  
  captions.forEach((caption, index) => {
    const cueEl = document.createElement("div");
    cueEl.className = "vhl-assist-transcript-cue";
    cueEl.textContent = caption.text;
    cueEl.style.cursor = "pointer";
    
    // Click to seek
    cueEl.addEventListener("click", () => {
      const state = Array.from(videoPlayers.values()).find(s => s.captions === captions);
      if (state && state.videoEl) {
        state.videoEl.currentTime = caption.startTime;
        state.videoEl.play();
      }
    });
    
    captionList.appendChild(cueEl);
  });
  
  panel.appendChild(captionList);
  
  return panel;
}
