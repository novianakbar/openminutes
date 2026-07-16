import net from "node:net";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import { resolveVncTarget } from "./botManager";
import { verifyViewToken } from "./viewToken";

// Status meeting yang masih punya kontainer bot hidup — hanya saat ini
// live view boleh dibuka.
const LIVE_STATUSES = ["joining", "waiting_admission", "recording"];

export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.includes(status);
}

// Proxy WebSocket ↔ TCP menuju x11vnc kontainer bot (docs/live-view-design.md §5.6).
// Didaftarkan sebagai plugin terpisah dari botRoutes karena auth-nya pakai
// view-token di query string (browser tidak bisa kirim header saat upgrade WS),
// bukan preHandler session/x-api-key.
export async function vncProxyRoutes(app: FastifyInstance) {
  app.get(
    "/meetings/:id/vnc",
    { websocket: true },
    async (ws, req) => {
      const { id } = req.params as { id: string };
      const { token } = req.query as { token?: string };

      const claim = verifyViewToken(token);
      if (!claim || claim.meetingId !== id) {
        return ws.close(1008, "invalid_token");
      }

      const [meeting] = await db
        .select()
        .from(schema.meetings)
        .where(
          and(
            eq(schema.meetings.id, claim.meetingId),
            eq(schema.meetings.userId, claim.userId),
          ),
        )
        .limit(1);
      if (!meeting || !isLiveStatus(meeting.status) || !meeting.containerId) {
        return ws.close(1008, "not_found_or_ended");
      }

      const target = await resolveVncTarget(meeting.containerId);
      if (!target) return ws.close(1011, "bot_not_running");

      // Pipe byte mentah dua arah — handshake & enkode RFB terjadi end-to-end
      // antara noVNC di browser dan x11vnc; API tidak paham protokolnya.
      const tcp = net.connect(target.port, target.host);
      tcp.on("data", (buf) => {
        if (ws.readyState === ws.OPEN) ws.send(buf);
      });
      ws.on("message", (buf: Buffer) => tcp.write(buf));

      const shutdown = () => {
        tcp.destroy();
        if (ws.readyState === ws.OPEN) ws.close(1000);
      };
      tcp.on("close", shutdown);
      tcp.on("error", (err) => {
        req.log.warn({ err }, "koneksi TCP ke x11vnc putus");
        shutdown();
      });
      ws.on("close", shutdown);
      ws.on("error", shutdown);
    },
  );
}
