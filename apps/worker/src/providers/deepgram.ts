import type { TranscriptionProvider, TranscriptSegmentInput } from "./types";

interface DeepgramUtterance {
  start: number;
  end: number;
  speaker?: number;
  transcript: string;
}

export function deepgramProvider(opts: {
  apiKey: string;
  model?: string | null;
  language: string;
}): TranscriptionProvider {
  return {
    name: "deepgram",
    async transcribe(audio: Buffer): Promise<TranscriptSegmentInput[]> {
      const params = new URLSearchParams({
        model: opts.model || "nova-2",
        language: opts.language,
        smart_format: "true",
        diarize: "true",
        utterances: "true",
      });
      const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${opts.apiKey}`,
          "Content-Type": "audio/ogg",
        },
        body: new Uint8Array(audio),
      });
      if (!res.ok) {
        throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as {
        results?: { utterances?: DeepgramUtterance[] };
      };
      return (json.results?.utterances ?? []).map((u) => ({
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        speaker: u.speaker != null ? `Speaker ${u.speaker}` : null,
        text: u.transcript,
      }));
    },
  };
}
