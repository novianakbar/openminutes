import { spawn } from "node:child_process";

const VIDEO_SIZE = "1280x720";
const VIDEO_FPS = "10";
const VIDEO_CRF = "28";
const VIDEO_AUDIO_BITRATE = "64k";

export interface VideoRecorder {
  stop: () => Promise<void>;
}

export function startVideoRecording(outPath: string): VideoRecorder {
  const proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-thread_queue_size", "512",
      "-f", "x11grab",
      "-video_size", VIDEO_SIZE,
      "-framerate", VIDEO_FPS,
      "-i", `${process.env.DISPLAY ?? ":99"}.0`,
      "-thread_queue_size", "512",
      "-f", "pulse",
      "-i", "MeetSink.monitor",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", VIDEO_CRF,
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", VIDEO_AUDIO_BITRATE,
      "-ac", "1",
      "-movflags", "+faststart",
      outPath,
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );

  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  let processError: Error | null = null;
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", (code, signal) => {
      exitCode = code;
      signalCode = signal;
      console.log(`video ffmpeg exit (code=${code}, signal=${signal ?? "-"})`);
      resolve();
    });
    proc.once("error", (err) => {
      processError = err;
      console.error("video ffmpeg gagal dijalankan:", err);
      resolve();
    });
  });
  proc.stdin.on("error", () => {});

  return {
    stop: async () => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.stdin.write("q");
        setTimeout(() => proc.kill("SIGKILL"), 10_000).unref();
      }
      await exited;
      if (processError) {
        throw processError;
      }
      if (exitCode !== 0) {
        throw new Error(
          `Video recording exited unexpectedly (code=${exitCode}, signal=${signalCode ?? "-"})`,
        );
      }
    },
  };
}
