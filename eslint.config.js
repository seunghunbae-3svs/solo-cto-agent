const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: ["node_modules/**", "dist/**", ".git/**"],
  },
  {
    files: ["bin/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
  prettier,
];
