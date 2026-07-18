import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  FileDown,
  FileText,
  Plus,
  Printer,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ActionItem, Attendee, Decision, MeetingInfo, MeetingOut, Mom } from "@/types";
import { api, ApiError, downloadBlob } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useHistoryState } from "@/hooks/useHistoryState";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";

export default function EditorPage() {
  const { id } = useParams();
  const meetingId = Number(id);
  const { toast } = useToast();

  const { data: meeting, isLoading } = useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => api.getMeeting(meetingId),
    enabled: Number.isFinite(meetingId),
  });

  if (isLoading || !meeting) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[560px]" />
          <Skeleton className="h-[560px]" />
        </div>
      </div>
    );
  }

  if (!meeting.mom_json) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium">This meeting has no generated minutes yet.</p>
        <p className="text-sm text-slate-500">Generate it from the New Meeting flow.</p>
      </div>
    );
  }

  return <Editor meeting={meeting} onError={(m) => toast("error", m)} onOk={(m) => toast("success", m)} />;
}

function Editor({
  meeting,
  onError,
  onOk,
}: {
  meeting: MeetingOut;
  onError: (msg: string) => void;
  onOk: (msg: string) => void;
}) {
  const { state: mom, set: setMom, undo, redo, canUndo, canRedo } = useHistoryState<Mom>(
    meeting.mom_json as Mom,
  );
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [exporting, setExporting] = useState<"" | "pdf" | "docx">("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const info: MeetingInfo = {
    title: meeting.title,
    meeting_date: meeting.meeting_date,
    meeting_time: meeting.meeting_time,
    venue: meeting.venue,
    organization: meeting.organization,
    meeting_type: meeting.meeting_type,
    prepared_by: meeting.prepared_by,
    approved_by: meeting.approved_by,
  };
  const attendees: Attendee[] = meeting.attendees.map(({ id: _id, ...a }) => a);

  // Keyboard undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Live preview + autosave, debounced on edits
  useDebouncedEffect(
    () => {
      setSaving("saving");
      Promise.all([
        api.preview({ meeting: info, attendees, mom, template_slug: meeting.template_slug }),
        api.updateMeeting(meeting.id, { mom }),
      ])
        .then(([previewRes]) => {
          setHtml(previewRes.html_preview);
          setSaving("saved");
        })
        .catch((err) => {
          setSaving("idle");
          onError(err instanceof ApiError ? err.message : "Autosave failed");
        });
    },
    [mom],
    800,
  );

  // Initial preview
  useEffect(() => {
    api
      .preview({ meeting: info, attendees, mom, template_slug: meeting.template_slug })
      .then((r) => setHtml(r.html_preview))
      .catch(() => onError("Preview failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportFile = async (format: "pdf" | "docx") => {
    setExporting(format);
    try {
      const { blob, filename } = await api.exportFile(meeting.id, format);
      downloadBlob(blob, filename);
      onOk(`${format.toUpperCase()} downloaded`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting("");
    }
  };

  const print = () => {
    iframeRef.current?.contentWindow?.print();
  };

  // ---- agenda mutations
  const renameAgenda = (i: number, title: string) =>
    setMom((m) => ({ ...m, agenda: m.agenda.map((a, j) => (j === i ? { ...a, title } : a)) }));

  const deleteAgenda = (i: number) =>
    setMom((m) => ({
      ...m,
      agenda: m.agenda.filter((_, j) => j !== i),
      discussion_points: m.discussion_points
        .filter((p) => p.agenda_index !== i)
        .map((p) => ({
          ...p,
          agenda_index:
            p.agenda_index !== null && p.agenda_index > i ? p.agenda_index - 1 : p.agenda_index,
        })),
    }));

  const moveAgenda = (i: number, dir: -1 | 1) =>
    setMom((m) => {
      const j = i + dir;
      if (j < 0 || j >= m.agenda.length) return m;
      const agenda = [...m.agenda];
      [agenda[i], agenda[j]] = [agenda[j], agenda[i]];
      const remap = (idx: number | null) =>
        idx === i ? j : idx === j ? i : idx;
      return {
        ...m,
        agenda,
        discussion_points: m.discussion_points.map((p) => ({ ...p, agenda_index: remap(p.agenda_index) })),
      };
    });

  const addAgenda = () =>
    setMom((m) => ({ ...m, agenda: [...m.agenda, { title: "New agenda item", subtopics: [] }] }));

  const addSubtopic = (agendaIndex: number) =>
    setMom((m) => ({
      ...m,
      agenda: m.agenda.map((a, j) =>
        j === agendaIndex ? { ...a, subtopics: [...(a.subtopics || []), "New point"] } : a
      ),
    }));

  const updateSubtopic = (agendaIndex: number, subtopicIndex: number, value: string) =>
    setMom((m) => ({
      ...m,
      agenda: m.agenda.map((a, j) =>
        j === agendaIndex
          ? {
              ...a,
              subtopics: (a.subtopics || []).map((s, k) => (k === subtopicIndex ? value : s)),
            }
          : a
      ),
    }));

  const deleteSubtopic = (agendaIndex: number, subtopicIndex: number) =>
    setMom((m) => ({
      ...m,
      agenda: m.agenda.map((a, j) =>
        j === agendaIndex
          ? { ...a, subtopics: (a.subtopics || []).filter((_, k) => k !== subtopicIndex) }
          : a
      ),
    }));

  // ---- discussion / decisions / actions
  const setDiscussion = (i: number, text: string) =>
    setMom((m) => ({
      ...m,
      discussion_points: m.discussion_points.map((p, j) => (j === i ? { ...p, text } : p)),
    }));
  const deleteDiscussion = (i: number) =>
    setMom((m) => ({ ...m, discussion_points: m.discussion_points.filter((_, j) => j !== i) }));
  const addDiscussion = () =>
    setMom((m) => ({
      ...m,
      discussion_points: [
        ...m.discussion_points,
        { agenda_index: null, text: "" },
      ],
    }));
  const setDiscussionAgenda = (i: number, agenda_index: number | null) =>
    setMom((m) => ({
      ...m,
      discussion_points: m.discussion_points.map((p, j) => (j === i ? { ...p, agenda_index } : p)),
    }));

  const addDecision = () =>
    setMom((m) => ({
      ...m,
      decisions: [
        ...m.decisions,
        { description: "", decided_by: null, rationale: null },
      ],
    }));
  const setDecision = useCallback(
    (i: number, patch: Partial<Decision>) =>
      setMom((m) => ({
        ...m,
        decisions: m.decisions.map((d, j) => (j === i ? { ...d, ...patch } : d)),
      })),
    [setMom],
  );
  const deleteDecision = (i: number) =>
    setMom((m) => ({ ...m, decisions: m.decisions.filter((_, j) => j !== i) }));

  const setAction = useCallback(
    (i: number, patch: Partial<ActionItem>) =>
      setMom((m) => ({
        ...m,
        action_items: m.action_items.map((a, j) => (j === i ? { ...a, ...patch } : a)),
      })),
    [setMom],
  );
  const deleteAction = (i: number) =>
    setMom((m) => ({ ...m, action_items: m.action_items.filter((_, j) => j !== i) }));
  const addAction = () =>
    setMom((m) => ({
      ...m,
      action_items: [
        ...m.action_items,
        { description: "", owner: null, due_date: null, priority: null, status: "pending" },
      ],
    }));

  return (
    <div className="px-6 py-6">
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{meeting.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            {meeting.ai_confidence !== null && (
              <Badge tone={meeting.ai_confidence > 0.7 ? "green" : meeting.ai_confidence > 0.4 ? "amber" : "red"}>
                AI confidence {(meeting.ai_confidence * 100).toFixed(0)}%
              </Badge>
            )}
            <span>
              {saving === "saving" ? "Saving…" : saving === "saved" ? "All changes saved" : ""}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={print}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button variant="outline" size="sm" loading={exporting === "docx"} onClick={() => exportFile("docx")}>
          <FileDown className="h-4 w-4" /> DOCX
        </Button>
        <Button size="sm" loading={exporting === "pdf"} onClick={() => exportFile("pdf")}>
          <FileDown className="h-4 w-4" /> PDF
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Structured editor */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Agenda</CardTitle>
              <Button variant="outline" size="sm" onClick={addAgenda}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {mom.agenda.map((item, i) => (
                <motion.div key={i} layout className="space-y-2 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-sm font-semibold text-slate-400">{i + 1}.</span>
                    <Input value={item.title} onChange={(e) => renameAgenda(i, e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => moveAgenda(i, -1)} disabled={i === 0} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveAgenda(i, 1)}
                      disabled={i === mom.agenda.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteAgenda(i)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                    </Button>
                  </div>
                  
                  {/* Subtopics */}
                  <div className="pl-8 space-y-1.5 border-l border-dashed border-slate-200 dark:border-slate-700 ml-3">
                    {(item.subtopics || []).map((sub, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-xs font-semibold text-slate-400">{i + 1}.{j + 1}</span>
                        <Input
                          className="h-8 text-sm"
                          value={sub}
                          onChange={(e) => updateSubtopic(i, j, e.target.value)}
                          placeholder="Subtopic / point title"
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteSubtopic(i, j)} aria-label="Delete subtopic">
                          <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-500" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                      onClick={() => addSubtopic(i)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add subtopic/point
                    </Button>
                  </div>
                </motion.div>
              ))}
              {mom.agenda.length === 0 && (
                <p className="text-sm text-slate-500">No agenda items.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Discussion points</CardTitle>
              <Button variant="outline" size="sm" onClick={addDiscussion}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {mom.discussion_points.map((p, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <Textarea
                      className="min-h-[44px]"
                      value={p.text}
                      onChange={(e) => setDiscussion(i, e.target.value)}
                      placeholder="Discussion point details"
                    />
                    <Button variant="ghost" size="icon" onClick={() => deleteDiscussion(i)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 shrink-0">Belongs to agenda:</span>
                    <Select
                      className="h-9 text-sm"
                      value={p.agenda_index ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDiscussionAgenda(i, val === "" ? null : Number(val));
                      }}
                    >
                      <option value="">General / Unassigned</option>
                      {mom.agenda.map((item, idx) => (
                        <option key={idx} value={idx}>
                          {idx + 1}. {item.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ))}
              {mom.discussion_points.length === 0 && (
                <p className="text-sm text-slate-500">No discussion points.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Decisions</CardTitle>
              <Button variant="outline" size="sm" onClick={addDecision}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {mom.decisions.map((d, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <Textarea
                      className="min-h-[44px]"
                      value={d.description}
                      onChange={(e) => setDecision(i, { description: e.target.value })}
                      placeholder="Decision description"
                    />
                    <Button variant="ghost" size="icon" onClick={() => deleteDecision(i)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Decided by (e.g. Board, Chairperson)"
                      value={d.decided_by ?? ""}
                      onChange={(e) => setDecision(i, { decided_by: e.target.value || null })}
                    />
                    <Input
                      placeholder="Rationale"
                      value={d.rationale ?? ""}
                      onChange={(e) => setDecision(i, { rationale: e.target.value || null })}
                    />
                  </div>
                </div>
              ))}
              {mom.decisions.length === 0 && <p className="text-sm text-slate-500">No decisions.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Action items</CardTitle>
              <Button variant="outline" size="sm" onClick={addAction}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {mom.action_items.map((a, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start gap-2">
                    <Textarea
                      className="min-h-[44px]"
                      placeholder="What needs to happen"
                      value={a.description}
                      onChange={(e) => setAction(i, { description: e.target.value })}
                    />
                    <Button variant="ghost" size="icon" onClick={() => deleteAction(i)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input
                      placeholder="Owner"
                      value={a.owner ?? ""}
                      onChange={(e) => setAction(i, { owner: e.target.value || null })}
                    />
                    <Input
                      placeholder="Due date"
                      value={a.due_date ?? ""}
                      onChange={(e) => setAction(i, { due_date: e.target.value || null })}
                    />
                    <Select
                      value={a.priority ?? ""}
                      onChange={(e) =>
                        setAction(i, { priority: (e.target.value || null) as ActionItem["priority"] })
                      }
                    >
                      <option value="">Priority —</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </Select>
                    <Select
                      value={a.status}
                      onChange={(e) => setAction(i, { status: e.target.value as ActionItem["status"] })}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </Select>
                  </div>
                </div>
              ))}
              {mom.action_items.length === 0 && (
                <p className="text-sm text-slate-500">No action items.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <Card className="overflow-hidden xl:sticky xl:top-6 xl:self-start">
          <CardHeader>
            <CardTitle>Document preview</CardTitle>
          </CardHeader>
          <div className="bg-slate-100 p-3 dark:bg-slate-800">
            {html ? (
              <iframe ref={iframeRef} title="MoM preview" className="mom-preview-frame rounded-lg shadow" srcDoc={html} />
            ) : (
              <Skeleton className="h-[640px] w-full" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
