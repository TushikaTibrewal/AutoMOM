import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  MonitorSpeaker,
  Radio,
  Save,
  Sparkles,
  Square,
  Users,
} from "lucide-react";
import type { Attendee, MeetingInfo, Mom } from "@/types";
import { api, ApiError } from "@/lib/api";
import { detectMeetingEnd, SPEECH_LANGUAGES } from "@/lib/meetingCues";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useMeetingCapture } from "@/hooks/useMeetingCapture";

const emptyInfo: MeetingInfo = {
  title: "",
  meeting_date: new Date().toISOString().slice(0, 10),
  meeting_time: new Date().toTimeString().slice(0, 5),
  venue: "",
  organization: "",
  meeting_type: "General",
  prepared_by: "",
  approved_by: "",
};

type Phase = "setup" | "recording" | "ended";

export default function LiveMeetingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("setup");
  const [info, setInfo] = useState<MeetingInfo>(emptyInfo);
  const [lang, setLang] = useState<string>("en-IN");
  const [templateSlug, setTemplateSlug] = useState("classic");
  const [transcript, setTranscript] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [mom, setMom] = useState<Mom | null>(null);
  const [html, setHtml] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const langRef = useRef(lang);
  langRef.current = lang;
  const lastExtractLenRef = useRef(0);
  const extractingRef = useRef(false);
  const endedRef = useRef(false);
  const attendeesRef = useRef<Attendee[]>([]);
  attendeesRef.current = attendees;
  const infoRef = useRef(info);
  infoRef.current = info;

  // Merge newly-detected participant names into the attendee list (never removes).
  const mergeParticipants = useCallback((names: string[]) => {
    if (!names?.length) return;
    setAttendees((prev) => {
      const have = new Set(prev.map((a) => a.name.toLowerCase()));
      const additions = names
        .filter((n) => n && !have.has(n.toLowerCase()))
        .map<Attendee>((n) => ({ name: n, role: "", department: "", present: true, group: "member" }));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, []);

  // ---- audio capture -> Whisper -> transcript
  const onSegment = useCallback(async (blob: Blob) => {
    setTranscribing(true);
    try {
      const { text } = await api.transcribeAudio(blob, langRef.current);
      const clean = text.trim();
      if (clean) {
        setTranscript((prev) => {
          const next = (prev ? prev + " " : "") + clean;
          if (!endedRef.current && detectMeetingEnd(clean)) {
            endedRef.current = true;
            queueMicrotask(() => endMeeting(true));
          }
          return next;
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast("error", "Transcription unavailable — set GROQ_API_KEY on the server.");
        endMeeting(false);
      }
    } finally {
      setTranscribing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const capture = useMeetingCapture({ onSegment, segmentMs: 6000 });

  // ---- incremental extraction as transcript grows
  const runExtract = useCallback(async () => {
    if (extractingRef.current) return;
    const text = transcript.trim();
    if (text.length < 40 || text.length - lastExtractLenRef.current < 80) return;
    extractingRef.current = true;
    setExtracting(true);
    lastExtractLenRef.current = text.length;
    try {
      const res = await api.extract({
        meeting: infoRef.current,
        attendees: attendeesRef.current,
        transcript: text,
        template_slug: templateSlug,
      });
      if (res.mom) {
        setMom(res.mom);
        setHtml(res.html_preview);
        mergeParticipants(res.mom.participants);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) lastExtractLenRef.current = 0;
    } finally {
      extractingRef.current = false;
      setExtracting(false);
    }
  }, [transcript, templateSlug, mergeParticipants]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(runExtract, 7000);
    return () => window.clearInterval(timer);
  }, [phase, runExtract]);

  useEffect(() => () => capture.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startMeeting = async () => {
    if (!info.title.trim()) {
      toast("error", "Give the meeting a title first");
      return;
    }
    endedRef.current = false;
    const ok = await capture.start();
    if (ok) {
      setPhase("recording");
      toast("success", "Capturing meeting audio");
    }
  };

  const endMeeting = (fromCue: boolean) => {
    capture.stop();
    setPhase("ended");
    runExtract();
    toast(
      fromCue ? "info" : "success",
      fromCue ? "Meeting-end cue detected — official minutes closed" : "Capture stopped",
    );
  };

  const saveAndEdit = async () => {
    if (!transcript.trim()) {
      toast("error", "Nothing captured yet");
      return;
    }
    setSaving(true);
    try {
      const res = await api.generate({
        meeting: info,
        attendees,
        transcript,
        template_slug: templateSlug,
      });
      toast("success", `Minutes saved (${res.provider})`);
      navigate(`/meetings/${res.meeting_id}`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- setup view
  if (phase === "setup") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Live meeting</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Capture a Google Meet / Zoom call and draft minutes in real time.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Meeting title *</Label>
              <Input
                placeholder="Weekly Product Sync"
                value={info.title}
                onChange={(e) => setInfo({ ...info, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Organization</Label>
              <Input value={info.organization} onChange={(e) => setInfo({ ...info, organization: e.target.value })} />
            </div>
            <div>
              <Label>Spoken language</Label>
              <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                {SPEECH_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Template</Label>
              <Select value={templateSlug} onChange={(e) => setTemplateSlug(e.target.value)}>
                {(templates ?? [{ slug: "classic", name: "Classic Formal" }]).map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Prepared by</Label>
              <Input value={info.prepared_by} onChange={(e) => setInfo({ ...info, prepared_by: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/25 dark:text-brand-200">
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <MonitorSpeaker className="h-4 w-4" /> How capture works
          </p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Open your Google Meet / Zoom meeting in another browser tab.</li>
            <li>Click <strong>Start capture</strong> — the browser asks what to share.</li>
            <li>Pick that meeting tab and <strong>tick “Share tab audio”</strong> (or system audio).</li>
            <li>AutoMOM mixes the call audio with your mic and transcribes both sides.</li>
          </ol>
          <p className="mt-2 text-xs opacity-80">Chrome or Edge on desktop required. Sharing is your consent.</p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={startMeeting}>
            <MonitorSpeaker className="h-4 w-4" /> Start capture
          </Button>
        </div>
        {capture.error && <p className="mt-3 text-sm text-rose-500">{capture.error}</p>}
      </div>
    );
  }

  // -------------------------------------------------------------- live/ended view
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col px-4 py-4 md:h-screen md:px-6 md:py-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{info.title}</h1>
          <div className="mt-0.5 flex items-center gap-3 text-xs">
            {phase === "recording" ? (
              <span className="flex items-center gap-1.5 font-medium text-rose-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Capturing
              </span>
            ) : (
              <Badge tone="neutral">Ended</Badge>
            )}
            {transcribing && <span className="text-slate-400">transcribing…</span>}
            {extracting && (
              <span className="flex items-center gap-1 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> updating minutes
              </span>
            )}
            <span className="flex items-center gap-1 text-slate-400">
              <Users className="h-3 w-3" /> {attendees.length} detected
            </span>
          </div>
        </div>

        {phase === "recording" ? (
          <Button variant="danger" onClick={() => endMeeting(false)}>
            <Square className="h-4 w-4" /> End meeting
          </Button>
        ) : (
          <Button onClick={saveAndEdit} loading={saving}>
            <Save className="h-4 w-4" /> Save &amp; edit
          </Button>
        )}
      </div>

      {phase === "ended" && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Official meeting ended. Review the minutes, then Save &amp; edit for full control and export.
        </div>
      )}

      {/* Detected attendees */}
      {attendees.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attendees</span>
          {attendees.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">
              {a.name}
              <button
                onClick={() => setAttendees((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-rose-500"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* Left: transcript */}
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSpeaker className="h-4 w-4 text-rose-500" /> Meeting transcript
            </CardTitle>
            <span className="text-xs text-slate-400">{transcript.length.toLocaleString()} chars</span>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <Textarea
              className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[13px] leading-relaxed focus:ring-0"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Both sides of the call will appear here once you share the meeting tab's audio…"
            />
          </CardContent>
        </Card>

        {/* Right: live MoM */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-brand-500" /> Minutes of Meeting (live)
            </CardTitle>
            {mom?.confidence != null && (
              <Badge tone={mom.confidence > 0.7 ? "green" : mom.confidence > 0.4 ? "amber" : "red"}>
                {(mom.confidence * 100).toFixed(0)}% confident
              </Badge>
            )}
          </CardHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 dark:bg-slate-800">
            {html ? (
              <iframe title="Live MoM" className="h-full min-h-[400px] w-full rounded-lg bg-white shadow" srcDoc={html} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                {transcript.trim().length > 0 ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
                    <p className="text-sm text-slate-500">Drafting minutes from the conversation…</p>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-40 w-full max-w-sm" />
                    <p className="text-sm text-slate-400">Minutes appear here as the meeting is transcribed.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {capture.error && <p className="mt-2 text-xs text-rose-500">{capture.error}</p>}
    </div>
  );
}
