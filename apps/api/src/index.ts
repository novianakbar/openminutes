import Fastify from "fastify";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import { config } from "./config";
import { adminRoutes } from "./routes/admin";
import { audioSummaryRoutes } from "./routes/audioSummaries";
import { botRoutes } from "./routes/bots";
import { internalRoutes } from "./routes/internal";
import { vncProxyRoutes } from "./services/vncProxy";
import { startScheduledBotService } from "./services/scheduledBots";

const app = Fastify({ logger: true });

app.register(websocket);
app.register(multipart);

app.get("/health", async () => ({ ok: true }));
app.get("/api/health", async () => ({ ok: true }));

// Semua endpoint better-auth (login, logout, admin user mgmt, api key mgmt).
app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const req = new Request(url.toString(), {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    const response = await auth.handler(req);
    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(response.body ? await response.text() : null);
  },
});

app.register(botRoutes, { prefix: "/api" });
app.register(audioSummaryRoutes, { prefix: "/api" });
app.register(vncProxyRoutes, { prefix: "/api" });
app.register(adminRoutes, { prefix: "/api/admin" });
app.register(internalRoutes, { prefix: "/internal" });

startScheduledBotService();

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
