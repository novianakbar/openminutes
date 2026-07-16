import type { TranscriptionProvider, TranscriptSegmentInput } from "./types";

interface VerboseJsonResponse {
  text?: string;
  duration?: number;
  segments?: { start: number; end: number; text: string }[];
}

// Endpoint gaya OpenAI `POST {baseUrl}/audio/transcriptions` — dipakai untuk
// OpenAI, Groq, maupun server whisper lokal (speaches / faster-whisper-server).
// Catatan: format ini tidak menyediakan speaker diarization.
export function openaiCompatibleProvider(opts: {
  baseUrl: string;
  apiKey?: string | null;
  model?: string | null;
  language: string;
}): TranscriptionProvider {
  return {
    name: "openai_compatible",
    async transcribe(audio: Buffer): Promise<TranscriptSegmentInput[]> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: "audio/ogg" }),
        "audio.ogg",
      );
      form.append("model", opts.model || "whisper-1");
      form.append("language", opts.language);
      form.append("response_format", "verbose_json");

      const url = `${opts.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
      const res = await fetch(url, {
        method: "POST",
        headers: opts.apiKey
          ? { Authorization: `Bearer ${opts.apiKey}` }
          : undefined,
        body: form,
      });
      if (!res.ok) {
        throw new Error(`${url} ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as VerboseJsonResponse;

      if (json.segments?.length) {
        return json.segments.map((s) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          speaker: null,
          text: s.text.trim(),
        }));
      }
      // Server yang tidak mengembalikan segments (mis. response_format tidak
      // didukung) — jatuhkan ke satu segmen berisi seluruh teks.
      if (json.text?.trim()) {
        return [
          {
            startMs: 0,
            endMs: Math.round((json.duration ?? 0) * 1000),
            speaker: null,
            text: json.text.trim(),
          },
        ];
      }
      return [];
    },
  };
}
