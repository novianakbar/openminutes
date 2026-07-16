export interface TranscriptSegmentInput {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

export interface TranscriptionProvider {
  name: string;
  transcribe(audio: Buffer): Promise<TranscriptSegmentInput[]>;
}
