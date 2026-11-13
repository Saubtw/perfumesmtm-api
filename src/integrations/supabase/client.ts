import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { unavailable } from '../../utils/errors.js';
export function supabaseClient() {
  if (!env.SUPABASE_PUBLISHABLE_KEY) throw unavailable('Supabase');
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) }
  });
}
