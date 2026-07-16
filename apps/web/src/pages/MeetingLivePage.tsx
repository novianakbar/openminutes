import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import RFB from "@novnc/novnc";
import {
  ArrowLeft,
  Loader2,
  MonitorPlay,
  MonitorOff,
  MousePointerClick,
  Plug,
  Unplug,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { isBotActive, StatusBadge } from "../components/StatusBadge";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

type Phase = "idle" | "connecting" | "connected" | "ended";

// Halaman live session terpisah (dibuka dari detail meeting). Koneksi VNC
// hanya dimulai lewat tombol Sambungkan — tidak pernah otomatis — supaya
// user sadar sedang membuka stream ke layar bot.
export function MeetingLivePage() {
  const { id } = useParams<{ id: string }>();
  const stageRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  // Nomor sesi — dinaikkan tiap connect/disconnect agar callback async dari
  // sesi lama (token yang baru resolve, event disconnect telat) tidak bocor
  // ke sesi baru. Sekaligus mencegah canvas ganda saat StrictMode dev
  // menjalankan efek dua kali.
  const genRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [endReason, setEndReason] = useState<string | null>(null);
  const [takeover, setTakeover] = useState(false);
  const takeoverRef = useRef(takeover);
  takeoverRef.current = takeover;

  const { data: meeting, isPending, isError } = useQuery({
    queryKey: ["meetings", id],
    queryFn: () => api.getMeeting(id!),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      isBotActive(query.state.data?.status ?? "") ? 5000 : false,
  });
  const botActive = isBotActive(meeting?.status ?? "");

  const disconnect = useCallback((reason: string | null) => {
    genRef.current += 1;
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    stageRef.current?.replaceChildren();
    setTakeover(false);
    setEndReason(reason);
    setPhase(reason == null ? "idle" : "ended");
  }, []);

  const connect = useCallback(async () => {
    if (!id) return;
    genRef.current += 1;
    const gen = genRef.current;
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    setPhase("connecting");
    setEndReason(null);

    let token: string;
    try {
      ({ token } = await api.mintViewToken(id));
    } catch (err) {
      if (gen !== genRef.current) return;
      setEndReason(
        err instanceof ApiError && err.status === 409
          ? "The session is no longer active."
          : "Unable to start Live View.",
      );
      setPhase("ended");
      return;
    }
    // Sesi sudah dibatalkan (user klik Putuskan / pindah halaman) selagi
    // menunggu token — jangan lanjut membuat koneksi.
    const el = stageRef.current;
    if (gen !== genRef.current || !el) return;

    el.replaceChildren();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/api/meetings/${id}/vnc?token=${encodeURIComponent(token)}`;
    const rfb = new RFB(el, url, { shared: true });
    rfb.viewOnly = !takeoverRef.current;
    rfb.scaleViewport = true;
    rfb.background = "transparent";
    rfbRef.current = rfb;

    rfb.addEventListener("connect", () => {
      if (gen === genRef.current) setPhase("connected");
    });
    rfb.addEventListener("disconnect", () => {
      if (gen !== genRef.current) return; // sesi lama, sudah digantikan
      rfbRef.current = null;
      setTakeover(false);
      setEndReason("Live View disconnected.");
      setPhase("ended");
    });
  }, [id]);

  // Putus rapi saat meninggalkan halaman.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      rfbRef.current?.disconnect();
      rfbRef.current = null;
    };
  }, []);

  // Bot berhenti (dihentikan / meeting selesai) saat sesi masih terbuka.
  useEffect(() => {
    if (!botActive && (phase === "connected" || phase === "connecting")) {
      disconnect("The session has ended. Live View was closed.");
    }
  }, [botActive, phase, disconnect]);

  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = !takeover;
  }, [takeover]);

  if (isPending) {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading meeting...
      </Card>
    );
  }

  if (isError || !meeting) {
    return (
      <Alert tone="danger" role="alert" title="Meeting not found">
        <Link to="/meetings" className="underline">
          Back to meetings
        </Link>
      </Alert>
    );
  }

  return (
    <div>
      <Link
        to={`/meetings/${meeting.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Meeting details
      </Link>

      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight">
                <MonitorPlay className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{meeting.title}</span>
              </h1>
              <StatusBadge status={meeting.status} />
              {phase === "connected" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                  <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  Live
                </span>
              )}
            </div>
            <p className="mt-2 truncate text-sm text-muted-foreground tabular-nums">
              Meeting ID: {meeting.externalMeetingId}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {phase === "connected" && (
              <Button
                type="button"
                variant={takeover ? "primary" : "secondary"}
                onClick={() => setTakeover((v) => !v)}
                aria-pressed={takeover}
                size="sm"
              >
                <MousePointerClick className="h-4 w-4" aria-hidden />
                {takeover ? "Control enabled" : "Take control"}
              </Button>
            )}
            {(phase === "connected" || phase === "connecting") && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => disconnect(null)}
              >
                <Unplug className="h-4 w-4" aria-hidden />
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="relative overflow-hidden rounded-xl border border-border bg-black shadow-sm">
        {/* noVNC menempelkan canvas ke div ini; aspect 16:9 mengikuti Xvfb 1280x720 */}
        <div ref={stageRef} className="aspect-video w-full" />

        {phase !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface text-sm text-muted-foreground">
            {phase === "connecting" ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                Connecting to Live View...
              </>
            ) : !botActive ? (
              <>
                <MonitorOff className="h-8 w-8" aria-hidden />
                <p>Live View is available only while the session is active.</p>
                <Link
                  to={`/meetings/${meeting.id}`}
                  className="font-semibold text-foreground underline"
                >
                  Back to meeting details
                </Link>
              </>
            ) : (
              <>
                <MonitorPlay className="h-8 w-8" aria-hidden />
                {phase === "ended" && endReason && <p>{endReason}</p>}
                <p className="max-w-md text-center">
                  {phase === "idle" &&
                    "Monitor the active meeting session when host approval or manual action is required."}
                </p>
                <Button
                  type="button"
                  onClick={connect}
                >
                  <Plug className="h-4 w-4" aria-hidden />
                  {phase === "ended" ? "Reconnect" : "Connect"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {takeover && phase === "connected" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Control mode is active. Mouse and keyboard input are forwarded to the session browser.
        </p>
      )}
    </div>
  );
}
