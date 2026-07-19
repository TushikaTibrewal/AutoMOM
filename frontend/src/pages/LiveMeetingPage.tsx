import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mic, MicOff, Radio, Save, Sparkles, Square } from "lucide-react";
import type { MeetingInfo, Mom } from "@/types";
import { api, ApiError } from "@/lib/api";
import { detectMeetingEnd, SPEECH_LANGUAGES } from "@/lib/meetingCues";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSpeech } from "@/hooks/useSpeech";

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
  const [mom, setMom] = useState<Mom | null>(null);
  const [html, setHtml] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const lastExtractLenRef = useRef(0);
  const extractingRef = useRef(false);
  const endedRef = useRef(false);

  const appendFinal = useCallback((text: string) => {
    setTranscript((prev) => {
      const next = (prev ? prev + " " : "") + text.trim();
      // End-cue detection runs on the newly spoken chunk.
      if (!endedRef.current && detectMeetingEnd(text)) {
        endedRef.current = true;
        // Defer state changes out of the setState updater.
        queueMicrotask(() => endMeeting(true));
      }
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const speech = useSpeech(appendFinal, lang);

  // Incremental extraction: regenerate the MoM as the transcript grows.
  const runExtract = useCallback(async () => {
    if (extractingRef.current) return;
    const text = transcript.trim();
    if (text.length < 40 || text.length - lastExtractLenRef.current < 60) return;
    extractingRef.current = true;
    setExtracting(true);
    lastExtractLenRef.current = text.length;
    try {
      const res = await api.extract({ meeting: info, attendees: [], transcript: text, template_slug: templateSlug });
      if (res.mom) {
        setMom(res.mom);
        setHtml(res.html_preview);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Live polling hit the rate limit — back off silently, try again later.
        lastExtractLenRef.current = 0;
      }
    } finally {
      extractingRef.current = false;
      setExtracting(false);
    }
  }, [transcript, info, templateSlug]);

  // Poll every 6s while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(runExtract, 6000);
    return () => window.clearInterval(timer);
  }, [phase, runExtract]);

  useEffect(() => () => speech.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startMeeting = () => {
    if (!info.title.trim()) {
      toast("error", "Give the meeting a title first");
      return;
    }
    if (!speech.supported) {
      toast("error", "Live transcription needs Chrome or Edge with microphone access");
      return;
    }
    endedRef.current = false;
    setPhase("recording");
    speech.start();
  };

  const endMeeting = (fromCue: boolean) => {
    speech.stop();
    setPhase("ended");
    runExtract();
    toast(fromCue ? "info" : "success", fromCue ? "Meeting-end cue detected — official minutes closed" : "Recording stopped");
  };

  const resumeMeeting = () => {
    endedRef.current = false;
    setPhase("recording");
    speech.start();
    toast("info", "Recording resumed");
  };

  const saveAndEdit = async () => {
    if (!transcript.trim()) {
      toast("error", "Nothing recorded yet");
      return;
    }
    setSaving(true);
    try {
      const res = await api.generate({ meeting: info, attendees: [], transcript, template_slug: templateSlug });
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
              Speak naturally — minutes are drafted in real time as you talk.
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

        {!speech.supported && (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            Live transcription uses the browser Speech Recognition API — available in Chrome and Edge.
            In other browsers, use the standard New Meeting flow instead.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={startMeeting} disabled={!speech.supported}>
            <Mic className="h-4 w-4" /> Start live meeting
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- live/ended view
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col px-4 py-4 md:h-screen md:px-6 md:py-5">
      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{info.title}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs">
            {phase === "recording" ? (
              <span className="flex items-center gap-1.5 font-medium text-rose-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Recording
              </span>
            ) : (
              <Badge tone="neutral">Ended</Badge>
            )}
            {extracting && (
              <span className="flex items-center gap-1 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> updating minutes…
              </span>
            )}
          </div>
        </div>

        {phase === "recording" ? (
          <Button variant="danger" onClick={() => endMeeting(false)}>
            <Square className="h-4 w-4" /> End meeting
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={resumeMeeting}>
              <Mic className="h-4 w-4" /> Resume
            </Button>
            <Button onClick={saveAndEdit} loading={saving}>
              <Save className="h-4 w-4" /> Save &amp; edit
            </Button>
          </>
        )}
      </div>

      {phase === "ended" && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Official meeting ended. Anything said after this isn't recorded unless you press Resume.
        </div>
      )}

      {/* Split panes */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* Left: live transcript */}
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {phase === "recording" ? (
                <Mic className="h-4 w-4 text-rose-500" />
              ) : (
                <MicOff className="h-4 w-4 text-slate-400" />
              )}
              Live transcript
            </CardTitle>
            <span className="text-xs text-slate-400">{transcript.length.toLocaleString()} chars</span>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <Textarea
              className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[13px] leading-relaxed focus:ring-0"
              value={transcript + (speech.interim ? ` ${speech.interim}` : "")}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Start speaking… your words appear here and can be corrected by typing."
            />
          </CardContent>
        </Card>

        {/* Right: live MoM preview */}
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
                    <p className="text-sm text-slate-500">Drafting minutes from what's been said…</p>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-40 w-full max-w-sm" />
                    <p className="text-sm text-slate-400">The minutes will appear here as you speak.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {speech.error && <p className="mt-2 text-xs text-rose-500">{speech.error}</p>}
    </div>
  );
}
