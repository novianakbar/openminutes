import type { Page } from "playwright";

export interface JoinOptions {
  meetingUrl: string;
  botName: string;
  joinTimeoutMs: number;
  onWaitingAdmission: () => void;
}

export interface MeetingPlatform {
  join(page: Page, opts: JoinOptions): Promise<void>;
  waitForEnd(page: Page): Promise<string>;
}
