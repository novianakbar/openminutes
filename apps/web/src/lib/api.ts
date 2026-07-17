import type {
  AudioSummaryDetail,
  AudioSummaryListResponse,
  MeetingDetail,
  MeetingListResponse,
  SummaryTemplate,
  TranscriptionLanguage,
  TranscriptionMode,
} from "./types";
import type { SummarySettings, TranscriptionSettings } from "@openminutes/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(res: Response, fallback: string): Promise<ApiError> {
  let message = fallback;
  try {
    const body = await res.json();
    if (typeof body.error === "string") message = body.error;
  } catch {
    // body bukan JSON, pakai pesan default
  }
  return new ApiError(res.status, message);
}

// Autentikasi lewat cookie session (dikirim otomatis, same-origin).
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // Content-Type hanya saat ada body — Fastify menolak request
      // "application/json" ber-body kosong (DELETE/GET) dengan 400.
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw await parseError(res, `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  listMeetings: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    if (params?.search) query.set("search", params.search);
    if (params?.status && params.status !== "all") {
      query.set("status", params.status);
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<MeetingListResponse>(`/meetings${suffix}`);
  },
  listAudioSummaries: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    if (params?.search) query.set("search", params.search);
    if (params?.status && params.status !== "all") {
      query.set("status", params.status);
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<AudioSummaryListResponse>(`/audio-summaries${suffix}`);
  },
  getAudioSummary: (id: string) =>
    request<AudioSummaryDetail>(`/audio-summaries/${id}`),
  uploadAudioSummary: async (input: {
    file: File;
    title?: string;
    language: TranscriptionLanguage;
  }) => {
    const formData = new FormData();
    formData.set("file", input.file);
    formData.set("language", input.language);
    if (input.title?.trim()) formData.set("title", input.title.trim());
    const res = await fetch("/api/audio-summaries", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      throw await parseError(res, `Unable to upload audio (${res.status})`);
    }
    return res.json() as Promise<AudioSummaryDetail>;
  },
  deleteAudioSummary: (id: string) =>
    request<{ audioSummaryId: string; deleted: true }>(`/audio-summaries/${id}`, {
      method: "DELETE",
    }),
  retranscribeAudioSummary: (id: string) =>
    request<{ audioSummaryId: string; status: string }>(
      `/audio-summaries/${id}/transcribe`,
      { method: "POST" },
    ),
  summarizeAudioSummary: (id: string, templateKey = "default") =>
    request<{ audioSummaryId: string; status: string }>(
      `/audio-summaries/${id}/summarize`,
      { method: "POST", body: JSON.stringify({ templateKey }) },
    ),
  getMeeting: (id: string) => request<MeetingDetail>(`/meetings/${id}`),
  createBot: (input: {
    meetingUrl: string;
    title?: string;
    mode: TranscriptionMode;
    language: TranscriptionLanguage;
    botName?: string;
    captureScreenshots?: boolean;
    scheduledStartAt?: string;
  }) =>
    request<{
      meetingId: string;
      title: string;
      externalMeetingId: string;
      status: string;
      scheduledStartAt?: string;
    }>("/bots", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  rescheduleMeeting: (id: string, scheduledStartAt: string) =>
    request<{ meetingId: string; status: string; scheduledStartAt: string }>(
      `/meetings/${id}/schedule`,
      {
        method: "PATCH",
        body: JSON.stringify({ scheduledStartAt }),
      },
    ),
  stopBot: (id: string) =>
    request<{ meetingId: string; status: string }>(`/bots/${id}`, {
      method: "DELETE",
    }),
  deleteMeeting: (id: string) =>
    request<{ meetingId: string; deleted: true }>(`/meetings/${id}`, {
      method: "DELETE",
    }),
  retranscribe: (id: string) =>
    request<{ meetingId: string; status: string }>(
      `/meetings/${id}/transcribe`,
      { method: "POST" },
    ),
  summarizeMeeting: (id: string, templateKey = "default") =>
    request<{ meetingId: string; status: string }>(
      `/meetings/${id}/summarize`,
      { method: "POST", body: JSON.stringify({ templateKey }) },
    ),
  mintViewToken: (id: string) =>
    request<{ token: string; expiresInSec: number }>(
      `/meetings/${id}/view-token`,
      { method: "POST" },
    ),
  getTranscriptionSettings: () =>
    request<TranscriptionSettings>("/admin/settings"),
  saveTranscriptionSettings: (settings: TranscriptionSettings) =>
    request<TranscriptionSettings>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getSummarySettings: () =>
    request<SummarySettings>("/admin/summary-settings"),
  saveSummarySettings: (settings: SummarySettings) =>
    request<SummarySettings>("/admin/summary-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  listSummaryTemplates: () =>
    request<SummaryTemplate[]>("/summary-templates"),
  listAdminSummaryTemplates: () =>
    request<SummaryTemplate[]>("/admin/summary-templates"),
  createSummaryTemplate: (template: Omit<SummaryTemplate, "createdAt" | "updatedAt">) =>
    request<SummaryTemplate>("/admin/summary-templates", {
      method: "POST",
      body: JSON.stringify(template),
    }),
  updateSummaryTemplate: (
    key: string,
    template: Partial<Omit<SummaryTemplate, "key" | "createdAt" | "updatedAt">>,
  ) =>
    request<SummaryTemplate>(`/admin/summary-templates/${key}`, {
      method: "PATCH",
      body: JSON.stringify(template),
    }),
  deleteSummaryTemplate: (key: string) =>
    request<{ key: string; deleted: true }>(`/admin/summary-templates/${key}`, {
      method: "DELETE",
    }),
  fetchAudioBlob: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/meetings/${id}/audio`);
    if (!res.ok) {
      throw await parseError(res, `Unable to fetch audio (${res.status})`);
    }
    return res.blob();
  },
  fetchAudioSummaryBlob: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/audio-summaries/${id}/audio`);
    if (!res.ok) {
      throw await parseError(res, `Unable to fetch audio (${res.status})`);
    }
    return res.blob();
  },
  meetingScreenshotUrl: (meetingId: string, screenshotId: number) =>
    `/api/meetings/${meetingId}/screenshots/${screenshotId}`,
};
