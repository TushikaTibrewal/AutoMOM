export type Platform = "meet" | "zoom" | "teams" | "unknown";

export interface AgendaItem {
  title: string;
  subtopics: string[];
}
export interface DiscussionPoint {
  agenda_index: number | null;
  text: string;
}
export interface Decision {
  description: string;
  decided_by: string | null;
  rationale: string | null;
}
export interface ActionItem {
  description: string;
  owner: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low" | null;
  status: "pending" | "in_progress" | "done";
}
export interface Mom {
  agenda: AgendaItem[];
  discussion_points: DiscussionPoint[];
  decisions: Decision[];
  action_items: ActionItem[];
  participants: string[];
  summary: string | null;
  confidence: number | null;
}

export interface TranscriptLine {
  ts: string;
  speaker: string;
  text: string;
}

export type CaptureStatus = "idle" | "recording" | "paused" | "ended";

export interface SessionState {
  sessionId: string;
  status: CaptureStatus;
  startedAt: number | null;
  pausedMs: number;
  platform: Platform;
  meetingTitle: string;
}
