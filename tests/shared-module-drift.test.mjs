/**
 * shared-module drift guard — the CLI and the serverless webhook each ship
 * their own copy of the Telegram command surface and the NL orchestrator,
 * because the webhook's runtime bundle can't reach `bin/lib/`. That's a
 * deliberate decision, but it means the two copies can silently diverge.
 *
 * This test fails when they do. If you intentionally edit one, run the
 * matching `cp` to update the other, then re-run the suite.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const PAIRS = [
  [
    "bin/lib/telegram-commands.js",
    "templates/orchestrator/api/telegram-commands.js",
  ],
  [
    "bin/lib/nl-orchestrator.js",
    "templates/orchestrator/ops/lib/nl-orchestrator.js",
  ],
];

describe("shared-module drift", () => {
  for (const [primary, mirror] of PAIRS) {
    it(`${primary} and ${mirror} are byte-identical`, () => {
      const a = fs.readFileSync(path.join(ROOT, primary), "utf8");
      const b = fs.readFileSync(path.join(ROOT, mirror), "utf8");
      if (a !== b) {
        const aLines = a.split("\n").length;
        const bLines = b.split("\n").length;
        throw new Error(
          `${primary} (${aLines} lines) has drifted from ${mirror} (${bLines} lines). ` +
            `Re-run: cp "${primary}" "${mirror}"`
        );
      }
      expect(a).toBe(b);
    });
  }
});
