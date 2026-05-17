import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * The boundaries config enforces the wallet/security seam declared in
 * ARCHITECTURE.md §3.2. Order matters: more-specific element patterns
 * (e.g. app/api) must come before less-specific ones (e.g. app/**).
 */
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow leading-underscore args/vars as the convention for "intentionally unused".
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
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "api", pattern: "app/api/**/*" },
        { type: "ui", pattern: ["app/**/*", "components/**/*"] },
        { type: "wallet", pattern: "lib/wallet/**/*" },
        { type: "security", pattern: "lib/security/**/*" },
        { type: "chain", pattern: "lib/chain/**/*" },
        { type: "shared", pattern: "lib/shared/**/*" },
      ],
      "boundaries/include": ["app/**/*", "components/**/*", "lib/**/*"],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // UI is the composition root — wires wallet + security via DI.
            { from: "ui", allow: ["ui", "wallet", "security", "chain", "shared"] },
            // API routes (server-side). Wallet is client-only (Privy SDK), stays out.
            { from: "api", allow: ["api", "security", "chain", "shared"] },
            // Non-negotiable: wallet may NOT reach into security internals.
            // It only sees SecurityLayer (the interface) re-exported from shared.
            { from: "wallet", allow: ["wallet", "chain", "shared"] },
            // Security is pure: never imports wallet, never mutates wallet state.
            { from: "security", allow: ["security", "chain", "shared"] },
            { from: "chain", allow: ["chain", "shared"] },
            { from: "shared", allow: ["shared"] },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
