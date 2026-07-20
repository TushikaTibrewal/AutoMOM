import { SessionState, CaptureStatus } from "./types";

let ws: WebSocket | null = null;
let reconnectTimer: any = null;

let state: SessionState = {
  sessionId: "",
  status: "idle",
  startedAt: null,
  pausedMs: 0,
  platform: "unknown",
  meetingTitle: "Live Meeting",
  aiState: "listening",
  language: null,
};

// Most recent DOM-scraped active speaker (content script), used to label
// segments Whisper can't diarize on its own.
let lastActiveSpeaker = "";
let updatingFlashTimer: any = null;

// Keep track of connected ports (content script/sidepanel) to keep service worker alive
const ports = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
});

function getWsUrl(backendUrl: string): string {
  const clean = backendUrl.replace(/\/$/, "");
  if (clean.startsWith("https://")) {
    return clean.replace("https://", "wss://");
  } else if (clean.startsWith("http://")) {
    return clean.replace("http://", "ws://");
  }
  return "ws://localhost:8000";
}

async function getBackendSettings() {
  const result = await chrome.storage.local.get(["backendUrl", "token"]);
  const backendUrl = result.backendUrl || "https://automom-backend.onrender.com";
  const token = result.token || "";
  return { backendUrl, wsUrl: getWsUrl(backendUrl), token };
}

function broadcast(msg: any) {
  // Broadcast to all ports
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch (e) {
      ports.delete(port);
    }
  }
  // Broadcast via standard messaging
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function connectWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (state.status === "idle") return;

  const { wsUrl, token } = await getBackendSettings();
  if (!token) {
    console.error("No authorization token found. Cannot connect to live WebSocket.");
    updateStatus("idle");
    broadcast({ type: "error", message: "Please sign in to the AutoMOM app first." });
    return;
  }

  const url = `${wsUrl}/ws/live/${state.sessionId}?token=${encodeURIComponent(token)}`;
  console.log(`Connecting WebSocket to: ${url}`);

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("WebSocket connected successfully");
      // Send initial config
      ws?.send(
        JSON.stringify({
          type: "config",
          meeting: {
            title: state.meetingTitle,
          },
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WS received type:", data.type);
        broadcast(data);
        if (data.type === "ended") {
          state.status = "ended";
          broadcast({ type: "state", state });
        } else if (data.type === "ai_state") {
          setAiState(data.state);
        } else if (data.type === "mom") {
          // Flash "Updating MoM" so the widget shows the merge landing, then
          // fall back to "Listening" once the pipeline is idle again.
          setAiState("updating");
          if (updatingFlashTimer) clearTimeout(updatingFlashTimer);
          updatingFlashTimer = setTimeout(() => {
            if (state.status === "recording") setAiState("listening");
          }, 1500);
        }
      } catch (e) {
        console.error("Failed to parse WS frame", e);
      }
    };

    ws.onclose = (event) => {
      console.warn("WebSocket closed:", event.code, event.reason);
      ws = null;
      if (state.status !== "idle" && state.status !== "ended") {
        console.log("Reconnecting in 3 seconds...");
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  } catch (e) {
    console.error("WebSocket connection initiation failed", e);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

function setAiState(aiState: SessionState["aiState"]) {
  state.aiState = aiState;
  broadcast({ type: "state", state });
}

function updateStatus(status: CaptureStatus) {
  state.status = status;
  if (status === "idle") {
    state.sessionId = "";
    state.startedAt = null;
    state.pausedMs = 0;
    state.aiState = "listening";
    state.language = null;
    lastActiveSpeaker = "";
    if (updatingFlashTimer) {
      clearTimeout(updatingFlashTimer);
      updatingFlashTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    closeOffscreen();
  } else if (status === "recording") {
    state.aiState = "listening";
  }
  broadcast({ type: "state", state });
}

async function startRecording(tabId: number, platform: string, title: string) {
  const sessionId = Math.random().toString(36).substring(2, 15);
  state = {
    sessionId,
    status: "recording",
    startedAt: Date.now(),
    pausedMs: 0,
    platform: platform as any,
    meetingTitle: title || "Live Meeting",
  };

  await connectWebSocket();
  await setupOffscreen(tabId);
  updateStatus("recording");
}

function getMediaStreamIdPromise(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(streamId);
      }
    });
  });
}

let isOffscreenOpen = false;

async function setupOffscreen(tabId: number) {
  if (isOffscreenOpen) {
    try {
      const streamId = await getMediaStreamIdPromise(tabId);
      chrome.runtime.sendMessage({ type: "start-capture", streamId }).catch(() => {});
      return;
    } catch (e) {
      console.error("tabCapture error:", e);
    }
  }

  // Create new offscreen document
  try {
    const streamId = await getMediaStreamIdPromise(tabId);
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["USER_MEDIA" as any, "DISPLAY_MEDIA" as any],
      justification: "Capture tab and mic audio for real-time translation and transcription",
    });
    isOffscreenOpen = true;
    // Let offscreen load, then send start message
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "start-capture", streamId }).catch(() => {});
    }, 1000);
  } catch (e) {
    console.error("Failed to create offscreen document:", e);
  }
}

async function closeOffscreen() {
  if (isOffscreenOpen) {
    chrome.offscreen.closeDocument().catch(() => {});
    isOffscreenOpen = false;
  }
}

// Service worker message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("SW received message:", message.type);

  if (message.type === "START_RECORDING") {
    const tabId = sender.tab?.id;
    if (tabId) {
      startRecording(tabId, message.platform, message.title);
    } else {
      console.error("No active tab found for START_RECORDING");
    }
    sendResponse({ success: true });
  } else if (message.type === "PAUSE_RECORDING") {
    if (state.status === "recording") {
      updateStatus("paused");
      chrome.runtime.sendMessage({ type: "pause-capture" }).catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.type === "RESUME_RECORDING") {
    if (state.status === "paused") {
      state.status = "recording";
      broadcast({ type: "state", state });
      ws?.send(JSON.stringify({ type: "resume" }));
      chrome.runtime.sendMessage({ type: "resume-capture" }).catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.type === "STOP_RECORDING") {
    if (state.status !== "idle") {
      updateStatus("ended");
      chrome.runtime.sendMessage({ type: "stop-capture" }).catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.type === "GET_STATE") {
    sendResponse({ state });
  } else if (message.type === "OPEN_SIDEPANEL") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch((e) => console.error(e));
    }
    sendResponse({ success: true });
  } else if (message.type === "TRANSCRIPT_SEGMENT") {
    // Segment from offscreen document -> send to backend WS.
    // Whisper doesn't diarize, so prefer the DOM-scraped active speaker when
    // the offscreen document only knows the generic "Speaker" placeholder.
    if (message.language) state.language = message.language;
    const speaker =
      message.speaker && message.speaker !== "Speaker" ? message.speaker : lastActiveSpeaker || "Participant";
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "segment",
          text: message.text,
          speaker,
          ts: message.ts,
          language: message.language || null,
        })
      );
    }
    broadcast({ type: "state", state });
    sendResponse({ success: true });
  } else if (message.type === "AI_STATE") {
    setAiState(message.state);
    sendResponse({ success: true });
  } else if (message.type === "ACTIVE_SPEAKER") {
    if (message.name) lastActiveSpeaker = message.name;
    sendResponse({ success: true });
  } else if (message.type === "ROSTER_NAMES") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "roster",
          names: message.names,
        })
      );
    }
    sendResponse({ success: true });
  } else if (message.type === "EDIT_MOM") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "mom_edit",
          mom: message.mom,
        })
      );
    }
    sendResponse({ success: true });
  } else if (message.type === "CONFIG_CHANGE") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "config",
          meeting: message.meeting,
          template_slug: message.template_slug,
        })
      );
    }
    sendResponse({ success: true });
  } else if (message.type === "SAVE_MEETING") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "save" }));
    }
    sendResponse({ success: true });
  } else if (message.type === "RESET_SESSION") {
    updateStatus("idle");
    sendResponse({ success: true });
  }
  return true;
});

// Setup extension click panel behavior
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error(e));
});
