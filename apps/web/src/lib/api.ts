import type {
  MeetingDetail,
  MeetingListResponse,
  TranscriptionLanguage,
  TranscriptionMode,
} from "./types";
import type { TranscriptionSettings } from "@openminutes/shared";

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
  getMeeting: (id: string) => request<MeetingDetail>(`/meetings/${id}`),
  createBot: (input: {
    meetingUrl: string;
    title?: string;
    mode: TranscriptionMode;
    language: TranscriptionLanguage;
    botName?: string;
  }) =>
    request<{
      meetingId: string;
      title: string;
      externalMeetingId: string;
      status: string;
    }>("/bots", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
  fetchAudioBlob: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/meetings/${id}/audio`);
    if (!res.ok) {
      throw await parseError(res, `Unable to fetch audio (${res.status})`);
    }
    return res.blob();
  },
};
