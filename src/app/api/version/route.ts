import { NextResponse } from "next/server";

import packageJson from "../../../../package.json";

/**
 * Version endpoint (rules §21).
 *
 * Returns the running build's identity so ops can confirm which commit is
 * deployed. `BUILD_SHA` and `BUILD_TIME` are populated by the CI pipeline at
 * build time; fall back to "dev" when running locally.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      name: packageJson.name,
      version: packageJson.version,
      commit: process.env.BUILD_SHA ?? "dev",
      built_at: process.env.BUILD_TIME ?? null,
      node_env: process.env.NODE_ENV ?? "development",
      runtime: process.version,
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
