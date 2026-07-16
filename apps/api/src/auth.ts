import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { config } from "./config";
import { db, schema } from "./db";

export const auth = betterAuth({
  baseURL: config.baseUrl,
  secret: config.authSecret,
  trustedOrigins: [config.webOrigin],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    // Registrasi publik dimatikan — hanya admin yang membuat user
    // (lewat endpoint admin plugin / seed).
    disableSignUp: true,
  },
  plugins: [
    admin(),
    apiKey({
      defaultPrefix: "an_",
      // Request ber-header x-api-key valid diperlakukan seperti punya session,
      // jadi satu getSession() menangani cookie maupun API key.
      enableSessionForAPIKeys: true,
    }),
  ],
});
