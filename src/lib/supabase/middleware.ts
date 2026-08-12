import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

function resolveServerSupabaseUrl(): string {
  const override = process.env.SUPABASE_SERVER_URL;
  if (override && override.trim().length > 0) {
    return override;
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

/**
 * Refreshes the Supabase auth session cookies on every request and returns
 * the (possibly modified) NextResponse alongside the current user. Consumed
 * by `proxy.ts` — do not call from RSC or Server Actions.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    resolveServerSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refresh the session (mutates cookies via the setAll above).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}
