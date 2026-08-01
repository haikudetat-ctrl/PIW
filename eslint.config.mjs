import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "apps/**/.next/**",
    "apps/**/node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "supabase/.temp/**",
    "supabase/.branches/**",
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
