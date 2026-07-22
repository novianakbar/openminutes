import { useEffect, useRef, useState } from "react";
import {
  Download,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
} from "lucide-react";
import { Button, buttonClass } from "./Button";

function formatAudioTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  downloadUrl,
  downloadName,
}: {
  src: string;
  downloadUrl?: string;
  downloadName: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function syncTime() {
      setCurrentTime(audio?.currentTime ?? 0);
    }
    function syncDuration() {
      setDuration(audio?.duration ?? 0);
    }
    function syncEnded() {
      setPlaying(false);
    }

    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("ended", syncEnded);

    return () => {
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("ended", syncEnded);
    };
  }, [src]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(value, 0), duration || 0);
    setCurrentTime(audio.currentTime);
  }

  function changeRate() {
    const nextRate = playbackRate === 1 ? 1.25 : playbackRate === 1.25 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          onClick={togglePlay}
          aria-label={playing ? "Pause recording" : "Play recording"}
          className="h-11 w-11 shrink-0 rounded-full"
        >
          {playing ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="h-5 w-5 translate-x-0.5" aria-hidden />
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground tabular-nums">
            <span>{formatAudioTime(currentTime)}</span>
            <span>{formatAudioTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Recording position"
            className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-accent"
            style={{
              background: `linear-gradient(to right, var(--accent) ${progress}%, var(--border) ${progress}%)`,
            }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => seek(currentTime - 15)}
          aria-label="Rewind 15 seconds"
          className="h-9 w-full"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => seek(currentTime + 15)}
          aria-label="Forward 15 seconds"
          className="h-9 w-full"
        >
          <RotateCw className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={changeRate}
          aria-label="Change playback speed"
          className="h-9"
        >
          {playbackRate}x
        </Button>
        <a
          href={downloadUrl ?? src}
          download={downloadName}
          className={buttonClass({
            variant: "secondary",
            size: "icon",
            className: "h-9 w-full",
          })}
          aria-label="Download audio"
        >
          <Download className="h-4 w-4" aria-hidden />
        </a>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Volume2 className="h-3.5 w-3.5" aria-hidden />
        Use your browser or device controls to adjust volume.
      </div>
    </div>
  );
}
