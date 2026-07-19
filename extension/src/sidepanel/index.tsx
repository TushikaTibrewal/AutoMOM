import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { AgendaItem, Decision, ActionItem, Mom, TranscriptLine, SessionState } from "../types";
import "./index.css";

const App: React.FC = () => {
  const [session, setSession] = useState<SessionState>({
    sessionId: "",
    status: "idle",
    startedAt: null,
    pausedMs: 0,
    platform: "unknown",
    meetingTitle: "Live Meeting",
  });

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [mom, setMom] = useState<Mom>({
    agenda: [],
    discussion_points: [],
    decisions: [],
    action_items: [],
    participants: [],
    summary: "",
    confidence: 0,
  });

  // Settings
  const [backendUrl, setBackendUrl] = useState("https://automom-backend.onrender.com");
  const [token, setToken] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Tabs for narrow layout
  const [activeTab, setActiveTab] = useState<"transcript" | "mom">("transcript");
  
  // State for tracking generated meeting ID for exports
  const [savedMeetingId, setSavedMeetingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [exportLoading, setExportLoading] = useState<"pdf" | "docx" | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Load Settings on Mount
  useEffect(() => {
    chrome.storage.local.get(["backendUrl", "token"], (result) => {
      if (result.backendUrl) setBackendUrl(result.backendUrl);
      if (result.token) setToken(result.token);
    });
  }, []);

  // Connect to Background
  useEffect(() => {
    portRef.current = chrome.runtime.connect({ name: "automom-sidepanel" });

    const handleBackgroundMessage = (msg: any) => {
      console.log("Sidepanel received WS type:", msg.type);
      if (msg.type === "state") {
        setSession(msg.state);
        if (msg.transcript) setTranscript(msg.transcript);
        if (msg.mom) setMom(msg.mom);
      } else if (msg.type === "transcript") {
        setTranscript((prev) => [...prev, msg.line]);
      } else if (msg.type === "mom") {
        setMom(msg.mom);
      } else if (msg.type === "attendees") {
        setMom((prev) => ({
          ...prev,
          participants: msg.attendees.map((a: any) => a.name),
        }));
      } else if (msg.type === "saved") {
        setSavedMeetingId(msg.meeting_id);
        setIsSaving(false);
        showToast("success", "Meeting minutes successfully saved to database!");
      } else if (msg.type === "error") {
        showToast("error", msg.message);
      }
    };

    portRef.current.onMessage.addListener(handleBackgroundMessage);

    // Sync state on load
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (res && res.state) {
        setSession(res.state);
      }
    });

    return () => {
      portRef.current?.disconnect();
    };
  }, []);

  // Scroll to bottom of transcript
  useEffect(() => {
    if (activeTab === "transcript") {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, activeTab]);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const handleSettingsSave = () => {
    chrome.storage.local.set({ backendUrl, token }, () => {
      showToast("success", "API settings saved successfully!");
      setIsSettingsOpen(false);
    });
  };

  // Push local edits back to WS server (via background.ts)
  const pushMomEdit = (updatedMom: Mom) => {
    setMom(updatedMom);
    chrome.runtime.sendMessage({ type: "EDIT_MOM", mom: updatedMom });
  };

  // --- MoM Form Editors
  const handleAgendaChange = (index: number, field: keyof AgendaItem, value: any) => {
    const updated = [...mom.agenda];
    updated[index] = { ...updated[index], [field]: value } as AgendaItem;
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleAddAgenda = () => {
    const updated = [...mom.agenda, { title: "New Agenda Topic", subtopics: [] }];
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleRemoveAgenda = (index: number) => {
    const updated = mom.agenda.filter((_, i) => i !== index);
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleSubtopicChange = (agendaIndex: number, subIndex: number, value: string) => {
    const updated = [...mom.agenda];
    const subtopics = [...updated[agendaIndex].subtopics];
    subtopics[subIndex] = value;
    updated[agendaIndex] = { ...updated[agendaIndex], subtopics };
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleAddSubtopic = (agendaIndex: number) => {
    const updated = [...mom.agenda];
    const subtopics = [...updated[agendaIndex].subtopics, "New subtopic point"];
    updated[agendaIndex] = { ...updated[agendaIndex], subtopics };
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleRemoveSubtopic = (agendaIndex: number, subIndex: number) => {
    const updated = [...mom.agenda];
    const subtopics = updated[agendaIndex].subtopics.filter((_, i) => i !== subIndex);
    updated[agendaIndex] = { ...updated[agendaIndex], subtopics };
    pushMomEdit({ ...mom, agenda: updated });
  };

  const handleDecisionChange = (index: number, field: keyof Decision, value: string) => {
    const updated = [...mom.decisions];
    updated[index] = { ...updated[index], [field]: value } as Decision;
    pushMomEdit({ ...mom, decisions: updated });
  };

  const handleAddDecision = () => {
    const updated = [
      ...mom.decisions,
      { description: "New Decision details", decided_by: "", rationale: "" },
    ];
    pushMomEdit({ ...mom, decisions: updated });
  };

  const handleRemoveDecision = (index: number) => {
    const updated = mom.decisions.filter((_, i) => i !== index);
    pushMomEdit({ ...mom, decisions: updated });
  };

  const handleActionChange = (index: number, field: keyof ActionItem, value: any) => {
    const updated = [...mom.action_items];
    updated[index] = { ...updated[index], [field]: value } as ActionItem;
    pushMomEdit({ ...mom, action_items: updated });
  };

  const handleAddAction = () => {
    const updated = [
      ...mom.action_items,
      {
        description: "Action item description",
        owner: "",
        due_date: "",
        priority: "medium" as any,
        status: "pending" as any,
      },
    ];
    pushMomEdit({ ...mom, action_items: updated });
  };

  const handleRemoveAction = (index: number) => {
    const updated = mom.action_items.filter((_, i) => i !== index);
    pushMomEdit({ ...mom, action_items: updated });
  };

  const handleAddParticipant = (name: string) => {
    if (!name.trim()) return;
    if (mom.participants.includes(name.trim())) return;
    pushMomEdit({ ...mom, participants: [...mom.participants, name.trim()] });
  };

  const handleRemoveParticipant = (name: string) => {
    pushMomEdit({ ...mom, participants: mom.participants.filter((p) => p !== name) });
  };

  // --- Save & Exports
  const handleSave = () => {
    setIsSaving(true);
    chrome.runtime.sendMessage({ type: "SAVE_MEETING" });
  };

  const handleExport = async (format: "pdf" | "docx") => {
    if (!savedMeetingId) {
      // Prompt user to save first
      setIsSaving(true);
      chrome.runtime.sendMessage({ type: "SAVE_MEETING" });
      showToast("error", "Saving meeting details first. Click download again in 2 seconds.");
      return;
    }

    setExportLoading(format);
    const url = `${backendUrl.replace(/\/$/, "")}/api/export/${format}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ meeting_id: savedMeetingId }),
      });

      if (res.status === 200) {
        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `meeting_minutes_${savedMeetingId}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast("success", `Successfully downloaded ${format.toUpperCase()} export!`);
      } else {
        const errData = await res.json();
        showToast("error", `Export failed: ${errData.detail || "Unknown error"}`);
      }
    } catch (e) {
      console.error(e);
      showToast("error", `Failed to connect to export endpoint.`);
    } finally {
      setExportLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-slate-950 text-slate-100 select-text overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
          <h1 className="text-sm font-bold tracking-tight text-slate-200">{session.meetingTitle || "AutoMOM Live Editor"}</h1>
        </div>
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700 transition-all text-slate-300"
        >
          API Settings
        </button>
      </header>

      {/* Settings Modal overlay */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-sm p-4 flex flex-col justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl flex flex-col gap-4">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-2">API Connection Settings</h2>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold">Backend HTTP URL</label>
              <input
                type="text"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-600 w-full"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold">JWT Bearer Token</label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={4}
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-600 w-full font-mono resize-none"
                placeholder="Paste Bearer Token from Vercel WebApp localStorage"
              />
            </div>

            <div className="flex gap-2.5 mt-2">
              <button
                onClick={handleSettingsSave}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-md text-xs font-semibold text-white transition-all"
              >
                Save Settings
              </button>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-750 rounded-md text-xs font-semibold text-slate-300 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toastMsg && (
        <div
          className={`absolute top-14 left-4 right-4 z-40 p-3 rounded-lg border text-xs shadow-xl flex items-center gap-2 animate-fade-in ${
            toastMsg.type === "success"
              ? "bg-emerald-950/90 border-emerald-800 text-emerald-300"
              : "bg-rose-950/90 border-rose-800 text-rose-300"
          }`}
        >
          <span className="font-bold">{toastMsg.type === "success" ? "✓" : "⚠"}</span>
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Main split-view layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Toggle navigation for small screens */}
        <div className="md:hidden flex border-b border-slate-800 bg-slate-900/60">
          <button
            onClick={() => setActiveTab("transcript")}
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "transcript"
                ? "border-indigo-600 text-indigo-400 bg-slate-850/50"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Live Transcript ({transcript.length})
          </button>
          <button
            onClick={() => setActiveTab("mom")}
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "mom"
                ? "border-indigo-600 text-indigo-400 bg-slate-850/50"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Live MoM Editor
          </button>
        </div>

        {/* --- LEFT PANEL: Live Transcript --- */}
        <div
          className={`flex-1 md:w-1/2 flex flex-col border-r border-slate-800 bg-slate-950 overflow-hidden ${
            activeTab === "transcript" ? "flex" : "hidden md:flex"
          }`}
        >
          <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Live Transcript</span>
            <span className="text-[10px] bg-slate-850 border border-slate-800 px-2 py-0.5 rounded text-slate-400 font-semibold">
              {transcript.length} lines
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3">
            {transcript.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 p-4">
                <span className="text-xl mb-2">🎙️</span>
                <p className="text-xs">No transcription yet. Click start on the floating widget to begin capturing.</p>
              </div>
            ) : (
              transcript.map((line, idx) => (
                <div key={idx} className="flex flex-col gap-0.5 bg-slate-900/40 p-2.5 rounded-lg border border-white/5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                    <span className="text-indigo-400 font-semibold">{line.speaker}</span>
                    <span>{line.ts}</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed font-normal">{line.text}</p>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* --- RIGHT PANEL: Minutes of Meeting Editor --- */}
        <div
          className={`flex-1 md:w-1/2 flex flex-col bg-slate-900/40 overflow-hidden ${
            activeTab === "mom" ? "flex" : "hidden md:flex"
          }`}
        >
          {/* Section Header */}
          <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">MoM Editor</span>
            {mom.confidence !== null && mom.confidence > 0 && (
              <span className="text-[10px] bg-indigo-950/40 border border-indigo-850 px-2 py-0.5 rounded text-indigo-400 font-bold">
                AI Confidence: {Math.round(mom.confidence * 100)}%
              </span>
            )}
          </div>

          {/* Form Fields */}
          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-5">
            {/* 1. General Info / Summary */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-bold text-slate-400 border-b border-slate-800 pb-1 uppercase tracking-wide">Summary</h3>
              <textarea
                value={mom.summary || ""}
                onChange={(e) => pushMomEdit({ ...mom, summary: e.target.value })}
                rows={3}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-indigo-600 resize-none font-normal"
                placeholder="No summary generated yet. Minutes will populate automatically as discussion progresses."
              />
            </div>

            {/* 2. Participants */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-bold text-slate-400 border-b border-slate-800 pb-1 uppercase tracking-wide">Participants</h3>
              <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg">
                {mom.participants.length === 0 ? (
                  <span className="text-xs text-slate-500 p-1">No participants identified yet.</span>
                ) : (
                  mom.participants.map((name) => (
                    <div
                      key={name}
                      className="bg-slate-850 border border-slate-750 px-2 py-0.5 rounded-full text-[10px] font-semibold text-slate-300 flex items-center gap-1.5"
                    >
                      <span>{name}</span>
                      <button
                        onClick={() => handleRemoveParticipant(name)}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Add participant name..."
                  id="new-participant"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const input = e.currentTarget;
                      handleAddParticipant(input.value);
                      input.value = "";
                    }
                  }}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-600"
                />
                <button
                  onClick={() => {
                    const input = document.getElementById("new-participant") as HTMLInputElement;
                    if (input) {
                      handleAddParticipant(input.value);
                      input.value = "";
                    }
                  }}
                  className="px-3 py-1 bg-slate-850 hover:bg-slate-750 rounded-md border border-slate-850 text-xs font-bold transition-all text-slate-300"
                >
                  + Add
                </button>
              </div>
            </div>

            {/* 3. Agenda Items & Subtopics */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Agenda & Subtopics</h3>
                <button
                  onClick={handleAddAgenda}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider"
                >
                  + Add Topic
                </button>
              </div>

              {mom.agenda.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-1">No agenda items defined.</p>
              ) : (
                mom.agenda.map((item, idx) => (
                  <div key={idx} className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg flex flex-col gap-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => handleAgendaChange(idx, "title", e.target.value)}
                        className="bg-transparent border-b border-transparent hover:border-slate-800 focus:border-indigo-600 focus:outline-none text-xs font-bold text-slate-200 w-full"
                      />
                      <button
                        onClick={() => handleRemoveAgenda(idx)}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold"
                        title="Delete Agenda Topic"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Subtopics */}
                    <div className="pl-3 border-l border-slate-850 flex flex-col gap-2">
                      {item.subtopics.map((sub, sIdx) => (
                        <div key={sIdx} className="flex items-center justify-between gap-2 group">
                          <input
                            type="text"
                            value={sub}
                            onChange={(e) => handleSubtopicChange(idx, sIdx, e.target.value)}
                            className="bg-transparent border-b border-transparent hover:border-slate-800 focus:border-indigo-600 focus:outline-none text-[11px] text-slate-300 w-full"
                          />
                          <button
                            onClick={() => handleRemoveSubtopic(idx, sIdx)}
                            className="text-slate-500 hover:text-rose-400 text-xs font-bold"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleAddSubtopic(idx)}
                        className="self-start text-[10px] text-slate-400 hover:text-indigo-400 font-bold transition-all"
                      >
                        + Add discussion point
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 4. Decisions */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Key Decisions</h3>
                <button
                  onClick={handleAddDecision}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider"
                >
                  + Add Decision
                </button>
              </div>

              {mom.decisions.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-1">No decisions recorded yet.</p>
              ) : (
                mom.decisions.map((dec, idx) => (
                  <div key={idx} className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg flex flex-col gap-2.5 shadow-sm">
                    <div className="flex gap-2">
                      <textarea
                        value={dec.description}
                        onChange={(e) => handleDecisionChange(idx, "description", e.target.value)}
                        rows={2}
                        placeholder="What was decided?"
                        className="bg-transparent border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none text-xs text-slate-200 leading-normal w-full p-1.5 rounded"
                      />
                      <button
                        onClick={() => handleRemoveDecision(idx)}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold self-start mt-1"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="flex gap-2 text-[10px] text-slate-400">
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Decided By</span>
                        <input
                          type="text"
                          value={dec.decided_by || ""}
                          onChange={(e) => handleDecisionChange(idx, "decided_by", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                        />
                      </div>
                      <div className="flex-2 flex flex-col gap-1 w-[60%]">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Rationale</span>
                        <input
                          type="text"
                          value={dec.rationale || ""}
                          onChange={(e) => handleDecisionChange(idx, "rationale", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 5. Action Items */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Action Items & Tasks</h3>
                <button
                  onClick={handleAddAction}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider"
                >
                  + Add Task
                </button>
              </div>

              {mom.action_items.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-1">No action items assigned.</p>
              ) : (
                mom.action_items.map((act, idx) => (
                  <div key={idx} className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg flex flex-col gap-2.5 shadow-sm">
                    <div className="flex gap-2">
                      <textarea
                        value={act.description}
                        onChange={(e) => handleActionChange(idx, "description", e.target.value)}
                        rows={2}
                        placeholder="Task description..."
                        className="bg-transparent border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none text-xs text-slate-200 leading-normal w-full p-1.5 rounded"
                      />
                      <button
                        onClick={() => handleRemoveAction(idx)}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold self-start mt-1"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Owner</span>
                        <input
                          type="text"
                          value={act.owner || ""}
                          onChange={(e) => handleActionChange(idx, "owner", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Due Date</span>
                        <input
                          type="text"
                          value={act.due_date || ""}
                          onChange={(e) => handleActionChange(idx, "due_date", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                          placeholder="e.g. Friday"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Priority</span>
                        <select
                          value={act.priority || "medium"}
                          onChange={(e) => handleActionChange(idx, "priority", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-500 uppercase tracking-wider">Status</span>
                        <select
                          value={act.status || "pending"}
                          onChange={(e) => handleActionChange(idx, "status", e.target.value)}
                          className="bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-600 focus:outline-none px-2 py-0.5 rounded text-slate-300"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="done">Done</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Footer Controls */}
          <footer className="p-4 bg-slate-900 border-t border-slate-800 flex flex-col gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 transition-all font-semibold rounded-lg text-xs text-center text-white"
            >
              {isSaving ? "Saving Live Minutes..." : "Save Minutes to Database"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExport("pdf")}
                disabled={exportLoading !== null}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-750 transition-all font-semibold rounded-md border border-slate-700 text-xs text-slate-300 text-center"
              >
                {exportLoading === "pdf" ? "Exporting..." : "Download PDF"}
              </button>
              <button
                onClick={() => handleExport("docx")}
                disabled={exportLoading !== null}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-750 transition-all font-semibold rounded-md border border-slate-700 text-xs text-slate-300 text-center"
              >
                {exportLoading === "docx" ? "Exporting..." : "Download DOCX"}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

// Mount sidepanel
const rootNode = document.getElementById("root");
if (rootNode) {
  const root = createRoot(rootNode);
  root.render(<App />);
}
