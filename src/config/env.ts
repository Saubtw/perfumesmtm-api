import { z } from 'zod';
const positive = (value: number) => z.coerce.number().int().positive().default(value);
export const env = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'), PORT: positive(3001),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'), CATALOG_SOURCE: z.enum(['archive','supabase']).default('archive'),
  SUPABASE_URL: z.url().default('https://tzucfbbuovdfnwzugotv.supabase.co'), SUPABASE_PUBLISHABLE_KEY: z.string().default(''),
  SUPABASE_CATALOG_MAPPING: z.string().default(''), OPENAI_API_KEY: z.string().default(''), OPENAI_AGENT_ID: z.string().default(''),
  SUPABASE_SECRET_KEY:z.string().default(''),
  COOKIE_SECRET: z.string().default(''), COOKIE_SAME_SITE: z.enum(['lax','none','strict']).default('lax'),
  SESSION_DB_PATH: z.string().default('./data/sessions.sqlite'), SESSION_RETENTION_DAYS: positive(7),
  CHAT_MAX_MESSAGE_LENGTH: positive(2000), CHAT_RATE_LIMIT_PER_MINUTE: positive(10), CHAT_MAX_MESSAGES_PER_SESSION: positive(40),
  CHAT_MAX_MESSAGES_PER_VISITOR_DAY: positive(80), CHAT_TIMEOUT_MS: positive(90000),
  WEATHER_PROVIDER: z.enum(['','openweather','weatherapi']).default(''), WEATHER_API_KEY: z.string().default(''),
  IP_GEO_PROVIDER: z.enum(['','ipapi','cloudflare']).default(''), TRUST_HOSTING_HEADERS:z.enum(['true','false']).default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0)
}).parse(process.env);
if (env.NODE_ENV === 'production' && (env.CATALOG_SOURCE !== 'supabase' || !env.SUPABASE_SECRET_KEY || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_CATALOG_MAPPING || !env.OPENAI_API_KEY || !env.OPENAI_AGENT_ID || env.COOKIE_SECRET.length < 32 || !env.CLIENT_ORIGIN.startsWith('https:'))) {
  throw new Error('Production requires Supabase catalog and session credentials, reviewed mapping, OpenAI credentials, HTTPS origin and COOKIE_SECRET of at least 32 characters');
}
