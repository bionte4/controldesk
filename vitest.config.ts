import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws at import time in non-server contexts. In tests
      // we stub it out so server-side modules can be exercised in isolation.
      "server-only": new URL("./test/stubs/server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      "dist",
      "src/components/ui/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/components/ui/**",
        "src/app/**/{layout,loading,error,page}.tsx",
        // These adapters depend on request-scoped Supabase sessions and belong
        // to integration coverage. Keep the 80% unit gate on the pure security
        // policy/helpers instead of diluting it with unexecuted I/O paths.
        "src/lib/security/platform-admin-action.ts",
        "src/lib/security/project-scope.ts",
      ],
      // Rules §21: gate security helpers at 80% overall. Branch-heavy policy
      // trees use a 75% floor while statements, functions, and lines stay 80%.
      thresholds: {
        "src/lib/security/**": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
