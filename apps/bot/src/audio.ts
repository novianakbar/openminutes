import { spawn } from "node:child_process";

export interface Recorder {
  startedAt: number;
  stop: () => Promise<void>;
}

export function startRecording(outPath: string): Recorder {
  const proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-f", "pulse",
      "-i", "MeetSink.monitor",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libopus",
      "-b:a", "32k",
      outPath,
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );

  // ffmpeg bisa mati duluan (mis. PulseAudio bermasalah) — catat supaya
  // stop() tidak menunggu event exit yang sudah lewat.
  proc.once("exit", (code, signal) => {
    console.log(`ffmpeg exit (code=${code}, signal=${signal ?? "-"})`);
  });
  proc.once("error", (err) => {
    console.error("ffmpeg gagal dijalankan:", err);
  });
  // Kalau ffmpeg sudah mati, write ke stdin memicu event error pada stream —
  // tanpa handler ini, error itu meruntuhkan seluruh proses bot.
  proc.stdin.on("error", () => {});

  return {
    startedAt: Date.now(),
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          return resolve();
        }
        proc.once("exit", () => resolve());
        // 'q' menyuruh ffmpeg menutup file dengan benar; SIGKILL hanya fallback
        proc.stdin.write("q");
        setTimeout(() => proc.kill("SIGKILL"), 10_000).unref();
      }),
  };
}
