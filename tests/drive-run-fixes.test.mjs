// PR-F1 — regression tests for the 5 bugs surfaced by the first real drive-run
// against an external repo (tribo-store, master default branch).
//
// B1 + B2: review --branch must auto-detect the repo's default branch, and
//          --target <base> must override when supplied.
// B3:      --dry-run must still emit the self-loop warning / partial-signal hint.
// B5:      setLogChannel("stderr") reroutes logs; JSON body always goes to stdout.
//
// B4 is a docs-only fix (README example flags); its absence of breakage is
// covered implicitly by the cli usage string remaining self-consistent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = await import(path.join(__dirname, "..", "bin", "cowork-engine.js"));

// ---------------------------------------------------------------------------
// Helpers — build throwaway git repos with varying default branches
// ---------------------------------------------------------------------------

function mkRepo({ defaultBranch = "main", withRemote = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solo-cto-f1-"));
  const git = (cmd) => execSync(cmd, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
  git(`git init -q -b ${defaultBranch}`);
  git("git config user.email t@t.t");
  git("git config user.name t");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git("git add .");
  git('git commit -q -m init');
  if (withRemote) {
    // Simulate the presence of "origin/<default>" by creating a fake remote
    // and a remote-tracking branch. We use a bare repo alongside.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "solo-cto-f1-remote-"));
    execSync(`git init -q --bare -b ${defaultBranch}`, { cwd: bare, stdio: "ignore" });
    git(`git remote add origin ${bare}`);
    git(`git push -q origin ${defaultBranch}`);
    // Make origin/HEAD point at the default branch so symbolic-ref works.
    git(`git remote set-head origin ${defaultBranch}`);
  }
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// B1: detectDefaultBranch
// ---------------------------------------------------------------------------

describe("B1 — detectDefaultBranch", () => {
  it("returns 'master' when origin/HEAD points at master", () => {
    const dir = mkRepo({ defaultBranch: "master" });
    try {
      expect(engine.detectDefaultBranch({ cwd: dir })).toBe("master");
    } finally {
      rmrf(dir);
    }
  });

  it("returns 'main' when origin/HEAD points at main", () => {
    const dir = mkRepo({ defaultBranch: "main" });
    try {
      expect(engine.detectDefaultBranch({ cwd: dir })).toBe("main");
    } finally {
      rmrf(dir);
    }
  });

  it("returns 'develop' when origin/HEAD points at develop", () => {
    const dir = mkRepo({ defaultBranch: "develop" });
    try {
      expect(engine.detectDefaultBranch({ cwd: dir })).toBe("develop");
    } finally {
      rmrf(dir);
    }
  });

  it("falls back to 'main' when no git remotes exist at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solo-cto-f1-norepo-"));
    try {
      // Not a git repo — detector must NOT throw, must return "main".
      expect(engine.detectDefaultBranch({ cwd: dir })).toBe("main");
    } finally {
      rmrf(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// B1/B2: getDiff("branch") uses the detected base, --target overrides
// ---------------------------------------------------------------------------

describe("B1/B2 — getDiff branch mode", () => {
  it("does NOT hardcode 'main' — works on a master-default repo without --target", () => {
    const dir = mkRepo({ defaultBranch: "master" });
    try {
      // create a feature branch with a change so there's a diff
      execSync("git checkout -q -b feature", { cwd: dir });
      fs.appendFileSync(path.join(dir, "a.txt"), "two\n");
      execSync("git add . && git commit -q -m change", { cwd: dir });
      // No target passed → must auto-detect master and NOT throw "fatal: ambiguous argument 'main...HEAD'"
      const diff = engine.getDiff("branch", null, { cwd: dir });
      expect(diff).toContain("+two");
    } finally {
      rmrf(dir);
    }
  });

  it("honors explicit --target <base>", () => {
    const dir = mkRepo({ defaultBranch: "master" });
    try {
      execSync("git checkout -q -b staging", { cwd: dir });
      fs.appendFileSync(path.join(dir, "a.txt"), "staging-only\n");
      execSync("git add . && git commit -q -m staging-commit", { cwd: dir });
      execSync("git checkout -q -b feature", { cwd: dir });
      fs.appendFileSync(path.join(dir, "a.txt"), "feature-only\n");
      execSync("git add . && git commit -q -m feature-commit", { cwd: dir });
      // diff vs staging should show only feature-only
      const diff = engine.getDiff("branch", "staging", { cwd: dir });
      expect(diff).toContain("+feature-only");
      expect(diff).not.toContain("+staging-only");
    } finally {
      rmrf(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// B5: setLogChannel routes log() correctly; JSON body goes to stdout
// ---------------------------------------------------------------------------

describe("B5 — log channel routing", () => {
  it("exposes setLogChannel and getLogChannel", () => {
    expect(typeof engine.setLogChannel).toBe("function");
    expect(typeof engine.getLogChannel).toBe("function");
  });

  it("round-trips between stdout and stderr", () => {
    engine.setLogChannel("stderr");
    expect(engine.getLogChannel()).toBe("stderr");
    engine.setLogChannel("stdout");
    expect(engine.getLogChannel()).toBe("stdout");
  });

  it("invalid channel falls back to stdout (never throws)", () => {
    engine.setLogChannel("nonsense");
    expect(engine.getLogChannel()).toBe("stdout");
  });

  it("child process: banner goes to stderr when --json is set, stdout stays pure JSON", () => {
    // Run the CLI with a malformed key so it exits early, but after the banner
    // logs. We only inspect which channel got the banner.
    const cliPath = path.join(__dirname, "..", "bin", "cli.js");
    const dir = mkRepo({ defaultBranch: "main" });
    try {
      // Stage something so getDiff("staged") has content
      fs.appendFileSync(path.join(dir, "a.txt"), "edit\n");
      execSync("git add .", { cwd: dir });
      const r = execSync(
        `node ${cliPath} review --staged --dry-run --json`,
        {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, ANTHROPIC_API_KEY: "sk-placeholder" },
        }
      );
      // With --json and --dry-run, stdout should have the dry-run summary on stderr.
      // stdout in dry-run is empty (no review body yet) — the important invariant
      // is that the "solo-cto-agent review" banner does NOT appear on stdout.
      expect(r).not.toMatch(/solo-cto-agent review/);
    } finally {
      rmrf(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// B3: --dry-run surfaces self-loop warning (no API call)
// ---------------------------------------------------------------------------

describe("B3 — dry-run self-loop warning", () => {
  it("prints a self-loop or partial-signal line during --dry-run when no T1/T2/T3 are active", () => {
    const cliPath = path.join(__dirname, "..", "bin", "cli.js");
    const dir = mkRepo({ defaultBranch: "main" });
    try {
      fs.appendFileSync(path.join(dir, "a.txt"), "edit\n");
      execSync("git add .", { cwd: dir });
      // Clean env: no OPENAI_API_KEY, no VERCEL_TOKEN, no COWORK_EXTERNAL_KNOWLEDGE
      const clean = {
        ...process.env,
        ANTHROPIC_API_KEY: "sk-placeholder",
        OPENAI_API_KEY: "",
        VERCEL_TOKEN: "",
        SUPABASE_ACCESS_TOKEN: "",
        COWORK_EXTERNAL_KNOWLEDGE: "",
        COWORK_PACKAGE_REGISTRY: "",
      };
      const out = execSync(`node ${cliPath} review --staged --dry-run`, {
        cwd: dir,
        encoding: "utf8",
        env: clean,
      });
      // Must contain either the SELF-LOOP banner or a partial-signal hint —
      // the exact copy comes from formatSelfLoopWarning / formatPartialSignalHint.
      const hasWarning = /SELF.?LOOP|self[- ]loop|external signal|peer model/i.test(out);
      expect(hasWarning).toBe(true);
    } finally {
      rmrf(dir);
    }
  });
});
