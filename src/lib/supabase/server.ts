import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Resolve the Supabase base URL for server-side calls.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is what the browser bundle needs (e.g.
 * `http://127.0.0.1:54321` on developer laptops so the client can reach the
 * host-side Supabase CLI). Next.js/Turbopack inlines that value into the
 * server bundle too, which breaks Docker deployments where the container
 * itself cannot reach `127.0.0.1:54321`.
 *
 * `SUPABASE_SERVER_URL` gives ops an escape hatch: when set, all
 * server-side Supabase clients use it instead. Docker Compose sets this to
 * `http://kong:8000` so the container talks to Supabase across the shared
 * bridge network, while the browser still resolves the public URL from
 * `NEXT_PUBLIC_SUPABASE_URL`.
 */
function resolveServerSupabaseUrl(): string {
  const override = process.env.SUPABASE_SERVER_URL;
  if (override && override.trim().length > 0) {
    return override;
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

/**
 * Server Supabase client for use in RSC, Server Actions, and Route Handlers.
 * All auth mutations (`set`, `remove`) are performed against the incoming
 * cookie store. When called from a Server Component (which cannot mutate
 * cookies), Supabase's session refresh writes are silently ignored — the
 * proxy layer at `proxy.ts` is responsible for keeping the session alive.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    resolveServerSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Ignored: RSC render can't mutate cookies. Handled by proxy.ts.
          }
        },
      },
    },
  );
}

/**
 * Elevated server client using the service role key. NEVER expose this
 * anywhere the response can reach a browser — use only in trusted server
 * code (webhook handlers, admin scripts, custom access token hook, etc.).
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    resolveServerSupabaseUrl(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
