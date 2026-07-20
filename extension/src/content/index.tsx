import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { SessionState, Platform, AiState } from "../types";
import widgetStyles from "./widget.css?inline";

const MIN_WIDGET_WIDTH = 220;
const MAX_WIDGET_WIDTH = 420;

const AI_STATE_LABEL: Record<AiState, string> = {
  listening: "Listening",
  transcribing: "Transcribing",
  extracting: "Extracting",
  updating: "Updating MoM",
};

// ------------------------------------------------------------- DOM Scraping Helpers
function getPlatform(): Platform {
  const host = window.location.host;
  if (host.includes("meet.google.com")) return "meet";
  if (host.includes("zoom.us")) return "zoom";
  if (host.includes("teams.microsoft.com") || host.includes("teams.live.com")) return "teams";
  return "unknown";
}

function getMeetingTitle(platform: Platform): string {
  try {
    if (platform === "meet") {
      // Google Meet meeting code or custom title from page title
      const codeMatch = window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
      return codeMatch ? `Meet: ${codeMatch[1]}` : document.title || "Google Meet";
    }
    if (platform === "zoom") {
      return document.title || "Zoom Meeting";
    }
    if (platform === "teams") {
      return document.title || "Teams Meeting";
    }
  } catch (e) {
    console.error(e);
  }
  return "Live Meeting";
}

function scrapeRoster(platform: Platform): string[] {
  const names = new Set<string>();
  try {
    if (platform === "meet") {
      // 1. Google Meet speaker labels/grid cards attributes
      const elements = document.querySelectorAll("[data-self-name], [data-name]");
      elements.forEach((el) => {
        const nameAttr = el.getAttribute("data-self-name") || el.getAttribute("data-name");
        if (nameAttr) names.add(nameAttr.trim());
      });

      // 2. Active grid cards and participant roster panel list classes (current obfuscated labels)
      const dynamicClasses = [".zW293b", ".ZjS7id", ".jVwmLb", ".yg51Mc", ".Jb02rc", ".cM3h5e"];
      dynamicClasses.forEach((cls) => {
        document.querySelectorAll(cls).forEach((el) => {
          if (el.textContent) {
            const text = el.textContent.trim();
            if (text && text.length > 2 && text.length < 50) {
              names.add(text);
            }
          }
        });
      });

      // 3. Grid tile elements (checking elements carrying participant metadata)
      document.querySelectorAll("[data-participant-id]").forEach((el) => {
        const text = el.textContent?.trim();
        if (text) {
          // Extract first line or clean text (participant panels append status icons sometimes)
          const cleanText = text.split("\n")[0].replace(/[🎙️🔇📌]/g, "").trim();
          if (cleanText && cleanText.length > 2 && cleanText.length < 50) {
            names.add(cleanText);
          }
        }
      });
    } else if (platform === "zoom") {
      // Zoom web client participant names with generic fallback for React dynamic classes
      const selectors = [
        ".participants-item__name",
        ".speaker-name",
        ".participants-item__name-text",
        "[class*='name-label']",
        "[class*='participant-name']",
      ];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (el.textContent) {
            const text = el.textContent.trim();
            if (text && text.length > 2 && text.length < 50 && !text.includes(":") && !text.includes("{")) {
              names.add(text);
            }
          }
        });
      });
    } else if (platform === "teams") {
      // Teams participant list items
      const participantItems = document.querySelectorAll("[data-cid='roster-participant'], .ui-chat__message-author");
      participantItems.forEach((el) => {
        if (el.textContent) names.add(el.textContent.trim());
      });
    }
  } catch (e) {
    console.error("Roster scrape failed", e);
  }
  return Array.from(names).filter((n) => n.length > 1);
}

// Best-effort active-speaker lookup: meeting UIs mark the currently-talking
// tile with a "speaking" aria-label or class, regardless of platform. Whisper
// itself can't diarize, so this is what lets us label segments by name.
function scrapeActiveSpeaker(): string | null {
  try {
    const el = document.querySelector(
      '[aria-label*="speaking" i], [class*="speaking" i]'
    );
    if (!el) return null;
    const label = el.getAttribute("aria-label");
    const fromLabel = label?.match(/^(.*?)\s+is speaking/i)?.[1];
    if (fromLabel) return fromLabel.trim();
    const text = el.textContent?.trim().split("\n")[0]?.trim();
    if (text && text.length > 1 && text.length < 50) return text;
  } catch (e) {
    console.error("Active speaker scrape failed", e);
  }
  return null;
}

// ------------------------------------------------------------- React Floating Widget
const FloatingWidget: React.FC = () => {
  const platform = getPlatform();
  const [session, setSession] = useState<SessionState>({
    sessionId: "",
    status: "idle",
    startedAt: null,
    pausedMs: 0,
    platform,
    meetingTitle: getMeetingTitle(platform),
  });

  const [durationText, setDurationText] = useState("00:00");
  const [position, setPosition] = useState({ x: 30, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [showEndedPrompt, setShowEndedPrompt] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, width: 260 });
  const durationInterval = useRef<any>(null);

  // Connect to background to get live status updates and keep background worker alive
  useEffect(() => {
    portRef.current = chrome.runtime.connect({ name: "automom-widget" });
    
    const handleBackgroundMessage = (msg: any) => {
      if (msg.type === "state") {
        setSession(msg.state);
        if (msg.state.status === "ended") {
          setShowEndedPrompt(true);
        } else {
          setShowEndedPrompt(false);
        }
      } else if (msg.type === "ended") {
        setShowEndedPrompt(true);
      }
    };

    portRef.current.onMessage.addListener(handleBackgroundMessage);
    
    // Request current state on mount
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (res && res.state) {
        setSession(res.state);
        if (res.state.status === "ended") {
          setShowEndedPrompt(true);
        }
      }
    });

    return () => {
      portRef.current?.disconnect();
    };
  }, []);

  // Sync Timer Duration
  useEffect(() => {
    if (session.status === "recording" && session.startedAt) {
      if (durationInterval.current) clearInterval(durationInterval.current);
      
      const updateDuration = () => {
        const totalSecs = Math.floor((Date.now() - session.startedAt!) / 1000);
        const mins = Math.floor(totalSecs / 60).toString().padStart(2, "0");
        const secs = (totalSecs % 60).toString().padStart(2, "0");
        setDurationText(`${mins}:${secs}`);
      };
      
      updateDuration();
      durationInterval.current = setInterval(updateDuration, 1000);
    } else if (session.status === "paused" || session.status === "ended") {
      if (durationInterval.current) clearInterval(durationInterval.current);
    } else {
      setDurationText("00:00");
      if (durationInterval.current) clearInterval(durationInterval.current);
    }

    return () => {
      if (durationInterval.current) clearInterval(durationInterval.current);
    };
  }, [session.status, session.startedAt]);

  // Periodic Roster Scraping during recording
  useEffect(() => {
    if (session.status !== "recording") return;

    const scrapeAndSend = () => {
      const names = scrapeRoster(platform);
      if (names.length > 0) {
        chrome.runtime.sendMessage({ type: "ROSTER_NAMES", names }).catch(() => {});
      }
    };

    // Scrape immediately and then every 10s
    scrapeAndSend();
    const rosterInterval = setInterval(scrapeAndSend, 10000);

    return () => clearInterval(rosterInterval);
  }, [session.status, platform]);

  // Track the currently-talking tile so segments can be labelled by speaker.
  useEffect(() => {
    if (session.status !== "recording") return;

    const sendActiveSpeaker = () => {
      const name = scrapeActiveSpeaker();
      if (name) {
        chrome.runtime.sendMessage({ type: "ACTIVE_SPEAKER", name }).catch(() => {});
      }
    };

    sendActiveSpeaker();
    const speakerInterval = setInterval(sendActiveSpeaker, 3000);

    return () => clearInterval(speakerInterval);
  }, [session.status]);

  // Handle Drag Events
  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      // Keep widget inside viewport bounds
      const nextX = Math.max(0, Math.min(window.innerWidth - 260, e.clientX - dragStart.current.x));
      const nextY = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragStart.current.y));
      setPosition({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  // Handle Resize Events (bottom-right grip)
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    resizeStart.current = { x: e.clientX, width };
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const next = resizeStart.current.width + (e.clientX - resizeStart.current.x);
      setWidth(Math.max(MIN_WIDGET_WIDTH, Math.min(MAX_WIDGET_WIDTH, next)));
    };
    const onMouseUp = () => setIsResizing(false);

    if (isResizing) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  const handleStart = () => {
    chrome.runtime.sendMessage({
      type: "START_RECORDING",
      platform,
      title: getMeetingTitle(platform),
    });
  };

  const handlePause = () => {
    chrome.runtime.sendMessage({ type: "PAUSE_RECORDING" });
  };

  const handleResume = () => {
    chrome.runtime.sendMessage({ type: "RESUME_RECORDING" });
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  };

  const handleOpenSidePanel = () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
  };

  const handleKeepRecording = () => {
    setShowEndedPrompt(false);
    chrome.runtime.sendMessage({ type: "RESUME_RECORDING" });
  };

  const handleFinalize = () => {
    chrome.runtime.sendMessage({ type: "SAVE_MEETING" });
    chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
    chrome.runtime.sendMessage({ type: "RESET_SESSION" });
    setShowEndedPrompt(false);
  };

  return (
    <div
      className="draggable-widget fixed z-[99999] glass rounded-xl text-slate-100 flex flex-col overflow-hidden"
      style={{ left: `${position.x}px`, top: `${position.y}px`, width: `${width}px` }}
    >
      {/* Widget Header/Handle */}
      <div
        onMouseDown={onMouseDown}
        className="handle px-4 py-2 bg-slate-900/60 border-b border-white/5 flex items-center justify-between text-xs font-semibold text-slate-300"
      >
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
          <span>AutoMOM Live</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">{platform}</span>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((c) => !c)}
            className="text-slate-400 hover:text-slate-200 text-xs leading-none w-4 h-4 flex items-center justify-center"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </div>
      </div>

      {/* Widget Body */}
      {!collapsed && (
        <div className="p-4 flex flex-col gap-3.5">
          {/* State Display */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-slate-400 font-medium">Session Timer</span>
              <span className="text-xl font-bold tracking-tight">{durationText}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs text-slate-400 font-medium">Status</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                {session.status === "recording" && (
                  <>
                    <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                    <span className="text-xs font-bold text-rose-400 uppercase">Live Recording</span>
                  </>
                )}
                {session.status === "paused" && (
                  <>
                    <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                    <span className="text-xs font-bold text-amber-400 uppercase">Paused</span>
                  </>
                )}
                {session.status === "ended" && (
                  <>
                    <span className="h-2 w-2 rounded-full bg-slate-500"></span>
                    <span className="text-xs font-bold text-slate-400 uppercase">Ended</span>
                  </>
                )}
                {session.status === "idle" && (
                  <>
                    <span className="h-2 w-2 rounded-full bg-slate-600"></span>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Ready</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* AI Pipeline State + Detected Language */}
          {session.status === "recording" && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="px-2 py-0.5 rounded-full bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 font-semibold uppercase tracking-wide">
                {AI_STATE_LABEL[session.aiState || "listening"]}
              </span>
              {session.language && (
                <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold">
                  {session.language}
                </span>
              )}
            </div>
          )}

          {/* Buttons Controls */}
          <div className="flex flex-col gap-2">
            {session.status === "idle" ? (
              <button
                onClick={handleStart}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 transition-all font-semibold rounded-lg text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-1.5"
              >
                Start Recording
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {session.status === "recording" ? (
                  <button
                    onClick={handlePause}
                    className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 transition-all font-semibold rounded-md text-xs flex items-center justify-center"
                  >
                    Pause
                  </button>
                ) : (
                  session.status === "paused" && (
                    <button
                      onClick={handleResume}
                      className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 transition-all font-semibold rounded-md text-xs flex items-center justify-center"
                    >
                      Resume
                    </button>
                  )
                )}
                <button
                  onClick={handleStop}
                  className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-500 transition-all font-semibold rounded-md text-xs flex items-center justify-center"
                >
                  Stop
                </button>
              </div>
            )}

            <button
              onClick={handleOpenSidePanel}
              className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 border border-white/5 transition-all text-slate-300 font-semibold rounded-md text-xs flex items-center justify-center gap-1"
            >
              Open Live MoM
            </button>
          </div>

          {/* Resize grip (bottom-right) */}
          <div
            onMouseDown={onResizeMouseDown}
            className="absolute bottom-1 right-1 w-3 h-3 cursor-nwse-resize opacity-40 hover:opacity-80"
            title="Drag to resize"
          >
            <svg viewBox="0 0 10 10" className="w-full h-full">
              <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
        </div>
      )}

      {/* Auto-Ended Alert Prompt */}
      {showEndedPrompt && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col p-4 justify-between animate-fade-in">
          <div>
            <h3 className="text-sm font-bold text-rose-400 mb-1">Meeting End Detected</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              We detected phrases indicating the meeting has concluded. Would you like to finalize and save the MoM, or continue recording?
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleFinalize}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 transition-all font-semibold rounded-md text-xs text-center"
            >
              Save & Finalize
            </button>
            <button
              onClick={handleKeepRecording}
              className="w-full py-1.5 bg-slate-800 hover:bg-slate-750 transition-all font-semibold rounded-md text-xs text-slate-300 text-center"
            >
              Keep Recording
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------- Setup DOM Mount Node
function init() {
  const platform = getPlatform();
  if (platform === "unknown") return;

  console.log(`AutoMOM Content Script initialized for platform: ${platform}`);

  const host = document.createElement("div");
  host.id = "automom-widget-host";
  
  // Style the host to prevent layout collapse, clipping, or blocking mouse events
  host.style.position = "fixed";
  host.style.zIndex = "999999";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "visible";
  
  // Isolate styles by appending styled DOM to Shadow Root
  const shadowRoot = host.attachShadow({ mode: "open" });
  
  const container = document.createElement("div");
  shadowRoot.appendChild(container);

  // Inject tailwind styles inside the Shadow DOM
  const styleEl = document.createElement("style");
  styleEl.textContent = widgetStyles;
  shadowRoot.appendChild(styleEl);

  document.body.appendChild(host);

  const root = createRoot(container);
  root.render(<FloatingWidget />);
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init);
}
