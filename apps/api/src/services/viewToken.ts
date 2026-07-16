import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

// Token berumur pendek untuk membuka WebSocket live view — browser tidak bisa
// mengirim header auth saat upgrade WS, dan menaruh API key di URL berisiko
// bocor di log (docs/live-view-design.md §5.5).

export const VIEW_TOKEN_TTL_SEC = 60;

export interface ViewTokenClaim {
  meetingId: string;
  userId: string;
  exp: number; // epoch detik
}

function sign(payload: string): string {
  return createHmac("sha256", config.internalToken)
    .update(payload)
    .digest("base64url");
}

export function mintViewToken(meetingId: string, userId: string): string {
  const claim: ViewTokenClaim = {
    meetingId,
    userId,
    exp: Math.floor(Date.now() / 1000) + VIEW_TOKEN_TTL_SEC,
  };
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyViewToken(token: unknown): ViewTokenClaim | null {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  let claim: ViewTokenClaim;
  try {
    claim = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof claim.meetingId !== "string" ||
    typeof claim.userId !== "string" ||
    typeof claim.exp !== "number"
  ) {
    return null;
  }
  if (claim.exp * 1000 < Date.now()) return null;
  return claim;
}
