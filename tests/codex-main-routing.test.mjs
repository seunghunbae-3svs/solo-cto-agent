import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";

const SCRIPT = path.join(
  process.cwd(),
  "templates",
  "orchestrator",
  "ops",
  "orchestrator",
  "routing-engine.js"
);

function runRouting(args) {
  const result = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe("codex-main routing models", () => {
  it("routes agent-codex issues into codex solo single-agent mode", () => {
    const decision = runRouting([
      "--labels",
      "agent-codex,enhancement",
      "--repo",
      "masked-org/project-alpha",
      "--issue",
      "17",
    ]);

    expect(decision.mode).toBe("single-agent");
    expect(decision.implementer).toBe("codex");
    expect(decision.reviewer).toBe("claude");
    expect(decision.telegram_tier).toBe("notify");
    expect(decision.max_rounds).toBe(2);
  });

  it("routes dual-review issues into codex + cowork dual-agent mode", () => {
    const decision = runRouting([
      "--labels",
      "dual-review,auth",
      "--repo",
      "masked-org/project-alpha",
      "--issue",
      "42",
    ]);

    expect(decision.mode).toBe("dual-agent");
    expect(decision.telegram_tier).toBe("decision");
    expect(decision.max_rounds).toBe(2);
    expect(decision.reasoning.join(" ")).toMatch(/dual-review/);
  });
});
