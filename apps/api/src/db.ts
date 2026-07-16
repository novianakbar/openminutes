import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@openminutes/shared/schema";
import { config } from "./config";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });
export { schema };
