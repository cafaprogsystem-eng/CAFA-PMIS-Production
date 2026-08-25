import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        navigator: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      // Use an explicit version string — "detect" calls getFilename() which is
      // not available in ESLint 10 flat config mode and throws a TypeError.
      react: { version: "18.3.0" },
    },
    rules: {
      // ── Hook integrity ────────────────────────────────────────────────
      // Prevents hooks inside conditions, loops, and nested functions.
      "react-hooks/rules-of-hooks": "error",

      // Warns when hook dependency arrays are incomplete.
      "react-hooks/exhaustive-deps": "warn",

      // ── Component stability ───────────────────────────────────────────
      // This rule is the primary guard against the class of bug fixed in this
      // session: components defined inside a parent render body get a new
      // function identity on every parent render, causing React to unmount and
      // remount the entire subtree on every cycle and corrupting hook
      // reconciliation across the tree.
      //
      // "allowAsProps: true" permits render-prop and children-as-function
      // patterns that are valid and intentional.
      "react/no-unstable-nested-components": ["error", { allowAsProps: true }],

      // ── TypeScript ───────────────────────────────────────────────────
      // Disable the base no-undef — TypeScript's type checker already catches
      // references to undeclared names more accurately, and the ESLint rule
      // produces false positives for TypeScript type imports and global types.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      // ── React ────────────────────────────────────────────────────────
      "react/react-in-jsx-scope": "off",   // Not needed with the new JSX transform
      "react/prop-types": "off",            // TypeScript handles this
    },
  },
  {
    // Ignore generated files and build outputs
    ignores: [
      "dist/**",
      "dev-dist/**",
      "node_modules/**",
      "*.config.{js,ts}",
      "scripts/**",
    ],
  },
  {
    // Source-analysis test suites intentionally keep some imported fixtures and
    // helper mirrors available for independent sentinel cases. Their unused
    // symbols do not ship to the application and are not a runtime correctness
    // signal; production source remains subject to the strict rule above.
    files: ["src/test/**/*.{ts,tsx}", "src/__tests__/**/*.{ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
