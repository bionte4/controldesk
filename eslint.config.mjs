import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Shadcn-generated primitives — keep formatting/idioms verbatim so
    // future `shadcn add` re-syncs stay conflict-free.
    "src/components/ui/**",
    "src/hooks/use-mobile.ts",
    // Supabase CLI generates ephemeral edge-runtime bundles under `.temp/`
    // when running `supabase start`. Not committed, not our code.
    "supabase/.temp/**",
  ]),
  {
    rules: {
      // Allow intentional unused args/vars when prefixed with an underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
