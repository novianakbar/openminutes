import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

// baseURL tidak diisi — same-origin, /api/auth di-proxy Vite ke API.
export const authClient = createAuthClient({
  plugins: [adminClient(), apiKeyClient()],
});

export type SessionUser = (typeof authClient.$Infer.Session)["user"];
