import type {
  Attendee,
  ExportRecord,
  GenerateResponse,
  MeetingInfo,
  MeetingListItem,
  MeetingOut,
  Mom,
  TemplateMeta,
  UserOut,
} from "@/types";

const TOKEN_KEY = "automom_token";

// Empty in dev (Vite proxies /api to the backend). On Vercel, set
// VITE_API_URL=https://your-backend-host so the static SPA reaches the API.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const url = (path: string) => `${API_BASE}${path}`;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  password: "Password",
  full_name: "Full name",
  title: "Meeting title",
  transcript: "Meeting notes",
  name: "Name",
};

/** Turn a FastAPI error body into one readable sentence.
 *  422 bodies are a list of {loc, msg}; strings pass through. */
function formatDetail(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((err: { loc?: unknown[]; msg?: string }) => {
      const field = err.loc?.[err.loc.length - 1];
      const label = typeof field === "string" ? FIELD_LABELS[field] ?? field : "";
      let msg = (err.msg ?? "is invalid").replace(/^value error,?\s*/i, "");
      if (msg.length > 120) msg = msg.slice(0, 117) + "…";
      return label ? `${label}: ${msg}` : msg;
    });
    return [...new Set(parts)].join(". ");
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url(path), { ...options, headers });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    clearToken();
    window.dispatchEvent(new Event("automom:unauthorized"));
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = formatDetail(await res.json(), res.statusText);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestBlob(path: string, options: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(url(path), { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = formatDetail(await res.json(), res.statusText);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? "minutes" };
}

export const api = {
  register: (email: string, full_name: string, password: string) =>
    request<{ access_token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, full_name, password }),
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<UserOut>("/api/auth/me"),
  verifyEmail: (token: string) =>
    request<UserOut>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  resendVerification: (email: string) =>
    request<{ message: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  generate: (payload: {
    meeting: MeetingInfo;
    attendees: Attendee[];
    transcript: string;
    template_slug: string;
    meeting_id?: number | null;
  }) => request<GenerateResponse>("/api/generate", { method: "POST", body: JSON.stringify(payload) }),

  preview: (payload: { meeting: MeetingInfo; attendees: Attendee[]; mom: Mom; template_slug: string }) =>
    request<{ html_preview: string }>("/api/preview", { method: "POST", body: JSON.stringify(payload) }),

  extract: (payload: {
    meeting: MeetingInfo;
    attendees: Attendee[];
    transcript: string;
    template_slug: string;
  }) =>
    request<{ mom: Mom | null; html_preview: string; provider: string }>("/api/extract", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listMeetings: (q?: string) =>
    request<MeetingListItem[]>(`/api/meetings${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getMeeting: (id: number) => request<MeetingOut>(`/api/meetings/${id}`),
  updateMeeting: (
    id: number,
    payload: Partial<{
      meeting: MeetingInfo;
      attendees: Attendee[];
      mom: Mom;
      template_slug: string;
      status: string;
    }>,
  ) => request<MeetingOut>(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteMeeting: (id: number) => request<void>(`/api/meetings/${id}`, { method: "DELETE" }),
  getRevisions: (id: number) => request<{ mom: Mom; saved_at: string | null }[]>(`/api/meetings/${id}/revisions`),

  exportFile: (meetingId: number, format: "pdf" | "docx") =>
    requestBlob(`/api/export/${format}`, { method: "POST", body: JSON.stringify({ meeting_id: meetingId }) }),
  recentExports: () => request<ExportRecord[]>("/api/exports/recent"),

  listTemplates: () => request<TemplateMeta[]>("/api/templates"),
  templatePreviewUrl: (slug: string) => url(`/api/templates/${slug}/preview`),
  uploadTemplate: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ slug: string }>("/api/template/upload", { method: "POST", body: form });
  },

  transcribeFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ text: string; characters: number }>("/api/transcribe", {
      method: "POST",
      body: form,
    });
  },
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
