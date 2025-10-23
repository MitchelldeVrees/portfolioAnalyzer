import { createClient } from "@supabase/supabase-js";

type AdminClientOptions = {
  /**
   * Skip persisting sessions when running on the server.
   * Default behaviour is fine for cron/jobs.
   */
  persistSession?: boolean;
};

export function createAdminClient(options: AdminClientOptions = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: options.persistSession ?? false,
      autoRefreshToken: false,
    },
  });
}
