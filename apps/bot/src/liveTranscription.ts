import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";

export interface LiveTranscriptionStream {
  stop: () => Promise<void>;
}

function liveAudioUrl(apiUrl: string, meetingId: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/internal/meetings/${meetingId}/live-audio`;
  url.search = "";
  return url.toString();
}

function waitForExit(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.once("exit", () => resolve());
  });
}

function waitForAck(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", cleanup);
      ws.off("error", cleanup);
    };
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const json = JSON.parse(Buffer.from(data as Buffer).toString("utf8")) as {
          type?: string;
        };
        if (["completed", "failed", "skipped"].includes(json.type ?? "")) {
          finish();
        }
      } catch {
        // Ignore non-control frames.
      }
    };
    ws.on("message", onMessage);
    ws.once("close", cleanup);
    ws.once("error", cleanup);
  });
}

export function startLiveTranscriptionStream(
  meetingId: string,
): LiveTranscriptionStream {
  const apiUrl = process.env.API_URL ?? "http://host.docker.internal:3000";
  const internalToken = process.env.INTERNAL_TOKEN ?? "dev-internal-token";
  const ws = new WebSocket(liveAudioUrl(apiUrl, meetingId), {
    headers: { "x-internal-token": internalToken },
  });

  let proc: ChildProcess | null = null;
  let stopped = false;

  ws.once("open", () => {
    if (stopped) return;
    const liveProc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "pulse",
        "-i",
        "MeetSink.monitor",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-acodec",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    proc = liveProc;

    liveProc.stdout.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    });
    liveProc.once("exit", (code, signal) => {
      console.log(
        `live transcription ffmpeg exit (code=${code}, signal=${signal ?? "-"})`,
      );
    });
    liveProc.once("error", (err) => {
      console.error("live transcription ffmpeg gagal dijalankan:", err);
    });
  });

  ws.once("error", (err) => {
    console.error("live transcription websocket error:", err);
    proc?.kill("SIGTERM");
  });
  ws.once("close", () => {
    proc?.kill("SIGTERM");
  });

  return {
    stop: async () => {
      stopped = true;
      if (proc && proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGTERM");
        const forceKill = setTimeout(() => proc?.kill("SIGKILL"), 5_000);
        await waitForExit(proc);
        clearTimeout(forceKill);
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "finalize" }));
        await waitForAck(ws, 15_000);
        ws.close(1000, "done");
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "done");
      }
    },
  };
}
