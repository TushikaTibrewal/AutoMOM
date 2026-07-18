export type AttendeeGroup = "chairperson" | "faculty" | "core_team" | "member" | "guest";

export interface Attendee {
  name: string;
  role: string;
  department: string;
  present: boolean;
  group: AttendeeGroup;
}

export interface MeetingInfo {
  title: string;
  meeting_date: string;
  meeting_time: string;
  venue: string;
  organization: string;
  meeting_type: string;
  prepared_by: string;
  approved_by: string;
}

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
  summary: string | null;
  confidence: number | null;
}

export interface MeetingListItem {
  id: number;
  title: string;
  meeting_date: string;
  organization: string;
  meeting_type: string;
  status: string;
  updated_at: string;
}

export interface MeetingOut extends MeetingInfo {
  id: number;
  transcript: string;
  mom_json: Mom | null;
  template_slug: string;
  status: string;
  ai_confidence: number | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
  attendees: (Attendee & { id: number })[];
}

export interface GenerateResponse {
  meeting_id: number;
  mom: Mom;
  html_preview: string;
  prompt_version: string;
  provider: string;
}

export interface TemplateMeta {
  slug: string;
  name: string;
  description: string;
  version: string;
}

export interface ExportRecord {
  id: number;
  meeting_id: number;
  meeting_title: string;
  format: "pdf" | "docx";
  file_name: string;
  created_at: string;
}

export interface UserOut {
  id: number;
  email: string;
  full_name: string;
  created_at: string;
}
