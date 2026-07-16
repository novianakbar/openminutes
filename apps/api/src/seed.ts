import { auth } from "./auth";
import { db, schema } from "./db";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const email = args[0] ?? "admin@openminutes.dev";
const password = args[1] ?? "admin12345";

try {
  await auth.api.createUser({
    body: { email, password, name: "Admin", role: "admin" },
  });
  console.log(`Admin dibuat — email: ${email}  password: ${password}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/exist/i.test(message)) {
    console.log(`User ${email} sudah ada, seed dilewati.`);
  } else {
    throw err;
  }
}

// Baris settings transcription default (kalau belum ada).
await db
  .insert(schema.appSettings)
  .values({ id: 1 })
  .onConflictDoNothing();

process.exit(0);
