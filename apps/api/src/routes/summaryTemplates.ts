import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";
import { listSummaryTemplates } from "../services/summaryTemplates";

export async function summaryTemplateRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/summary-templates", async () => {
    return listSummaryTemplates({ enabledOnly: true });
  });
}
