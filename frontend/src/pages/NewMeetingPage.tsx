import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Languages, Mic, MicOff, Sparkles, Upload } from "lucide-react";
import type { Attendee, MeetingInfo } from "@/types";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AttendeeTable } from "@/components/AttendeeTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useSpeech } from "@/hooks/useSpeech";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";

const DRAFT_KEY = "automom_new_meeting_draft";
const MEETING_TYPES = ["General", "Board", "Faculty", "Committee", "Project Review", "Standup", "Client", "Other"];

interface Draft {
  info: MeetingInfo;
  attendees: Attendee[];
  transcript: string;
  template_slug: string;
}

const emptyInfo: MeetingInfo = {
  title: "",
  meeting_date: "",
  meeting_time: "",
  venue: "",
  organization: "",
  meeting_type: "General",
  prepared_by: "",
  approved_by: "",
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* corrupted draft */
  }
  return { info: emptyInfo, attendees: [], transcript: "", template_slug: "classic" };
}

const steps = ["Meeting info", "Attendees", "Notes & generate"];

export default function NewMeetingPage() {
  const [step, setStep] = useState(0);
  const draft = useRef(loadDraft()).current;
  const [attendees, setAttendees] = useState<Attendee[]>(draft.attendees);
  const [transcript, setTranscript] = useState(draft.transcript);
  const [templateSlug, setTemplateSlug] = useState(draft.template_slug);
  const [generating, setGenerating] = useState(false);
  const [translating, setTranslating] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, getValues, trigger, watch, formState: { errors } } = useForm<MeetingInfo>({
    defaultValues: draft.info,
    mode: "onBlur",
  });
  const watchedInfo = watch();

  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const speech = useSpeech((finalText) => setTranscript((t) => (t ? t + " " : "") + finalText.trim()));

  // Autosave draft to localStorage
  useDebouncedEffect(
    () => {
      const payload: Draft = { info: getValues(), attendees, transcript, template_slug: templateSlug };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    },
    [watchedInfo, attendees, transcript, templateSlug],
    600,
  );

  useEffect(() => () => speech.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const nextStep = async () => {
    if (step === 0) {
      const valid = await trigger();
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleUpload = async (file: File) => {
    try {
      const { text } = await api.transcribeFile(file);
      setTranscript((t) => (t ? t + "\n" : "") + text);
      toast("success", `Imported ${text.length.toLocaleString()} characters`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Upload failed");
    }
  };

  const handleTranslate = async () => {
    if (!transcript.trim()) {
      toast("error", "Enter some notes to translate first");
      return;
    }
    setTranslating(true);
    try {
      const { translated_text } = await api.translate(transcript);
      if (translated_text) {
        setTranscript(translated_text);
        toast("success", "Notes translated to English");
      }
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  };

  const generate = async () => {
    if (!transcript.trim()) {
      toast("error", "Add some meeting notes first");
      return;
    }
    speech.stop();
    setGenerating(true);
    const cleanAttendees = attendees.filter((a) => a.name.trim() !== "");
    try {
      const res = await api.generate({
        meeting: getValues(),
        attendees: cleanAttendees,
        transcript,
        template_slug: templateSlug,
      });
      localStorage.removeItem(DRAFT_KEY);
      toast("success", `Minutes generated (${res.provider})`);
      navigate(`/meetings/${res.meeting_id}`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">New meeting</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Three steps: details, people, notes. The AI extracts — templates format.
      </p>

      {/* Stepper */}
      <div className="mb-8 flex items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                i < step
                  ? "bg-brand-600 text-white"
                  : i === step
                    ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500 dark:bg-brand-900/50 dark:text-brand-200"
                    : "bg-slate-100 text-slate-400 dark:bg-slate-800",
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </button>
            <span
              className={cn(
                "text-sm max-sm:hidden",
                i === step ? "font-semibold" : "text-slate-500 dark:text-slate-400",
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
        >
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Meeting information</CardTitle>
                <CardDescription>Metadata that appears in the document header</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Meeting title *</Label>
                  <Input placeholder="Q3 Curriculum Review" {...register("title", { required: true })} />
                  {errors.title && <p className="mt-1 text-xs text-rose-500">Title is required</p>}
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" {...register("meeting_date")} />
                </div>
                <div>
                  <Label>Time</Label>
                  <Input type="time" {...register("meeting_time")} />
                </div>
                <div>
                  <Label>Venue</Label>
                  <Input placeholder="Conference Room B" {...register("venue")} />
                </div>
                <div>
                  <Label>Organization</Label>
                  <Input placeholder="ABC Institute of Technology" {...register("organization")} />
                </div>
                <div>
                  <Label>Meeting type</Label>
                  <Select {...register("meeting_type")}>
                    {MEETING_TYPES.map((t) => (
                      <option key={t}>{t}</option>
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
                  <Input placeholder="Secretary name" {...register("prepared_by")} />
                </div>
                <div>
                  <Label>Approved by</Label>
                  <Input placeholder="Chairperson name" {...register("approved_by")} />
                </div>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Attendees</CardTitle>
                <CardDescription>
                  Grouped as Chairperson, Faculty, Core Team, Members and Guests in the document
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AttendeeTable attendees={attendees} onChange={setAttendees} />
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Meeting notes</CardTitle>
                <CardDescription>
                  Type, dictate, paste or upload — messy is fine, that is the point
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant={speech.listening ? "danger" : "outline"}
                    size="sm"
                    onClick={speech.listening ? speech.stop : speech.start}
                    disabled={!speech.supported}
                    title={speech.supported ? "" : "Not supported in this browser"}
                  >
                    {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {speech.listening ? "Stop dictation" : "Dictate"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Upload transcript
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTranslate}
                    loading={translating}
                    disabled={!transcript.trim()}
                    title="Translate Hinglish/Hindi notes to English"
                  >
                    <Languages className="h-4 w-4" /> Translate to English
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept=".txt,.md,.vtt,.srt,.text"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload(file);
                      e.target.value = "";
                    }}
                  />
                  {speech.listening && (
                    <span className="flex items-center gap-2 text-xs text-rose-500">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                      Listening… {speech.interim && <em className="text-slate-400">{speech.interim}</em>}
                    </span>
                  )}
                  {speech.error && <span className="text-xs text-rose-500">{speech.error}</span>}
                </div>

                <Textarea
                  className="min-h-[320px] font-mono text-[13px] leading-relaxed"
                  placeholder={
                    "Paste or type raw notes...\n\nAgenda: Budget review\nRavi will prepare cost sheet by Friday\nDecided to approve the new lab equipment purchase\n..."
                  }
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <p className="mt-2 text-right text-xs text-slate-500 dark:text-slate-400">
                  {transcript.length.toLocaleString()} characters
                </p>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={nextStep}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={generate} loading={generating} size="lg">
            <Sparkles className="h-4 w-4" /> Generate minutes
          </Button>
        )}
      </div>
    </div>
  );
}
