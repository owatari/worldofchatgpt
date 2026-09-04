import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const configSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgresql://worldofchatgpt:worldofchatgpt@localhost:5432/worldofchatgpt'),
  JWT_SECRET: z.string().min(16).default('dev-only-change-this-secret'),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export const config = configSchema.parse(process.env);
