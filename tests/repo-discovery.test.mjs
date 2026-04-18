/**
 * repo-discovery tests — mocks the `gh api` shellout via an injected
 * execFile and verifies:
 *   1. JSON parsing (fields, missing-field tolerance, non-array response)
 *   2. Default preselect behavior (top-5, excludes forks/archived)
 *   3. Selection-input parsing (numbers, ranges, 'all'/'none', repo names)
 *   4. Persistence round-trip (saveSelection → loadSelection)
 *   5. gh unavailable → fetchRepos returns null
 *   6. gh available + success → fetchRepos returns parsed array
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const repoDiscovery = require(path.join(process.cwd(), "bin", "repo-discovery.js"));

// ── Fixtures ──────────────────────────────────────────────────────
const SAMPLE_REPOS = [
  {
    name: "project-a-store",
    full_name: "acme/project-a-store",
    description: "K-beauty group buying",
    language: "TypeScript",
    pushed_at: "2026-04-18T10:00:00Z",
    private: false,
    fork: false,
    archived: false,
  },
  {
    name: "project-b-app",
    full_name: "acme/project-b-app",
    description: "PH social gifting",
    language: "TypeScript",
    pushed_at: "2026-04-17T10:00:00Z",
    private: true,
    fork: false,
    archived: false,
  },
  {
    name: "legacy-fork",
    full_name: "acme/legacy-fork",
    description: null,
    language: "Python",
    pushed_at: "2026-04-16T10:00:00Z",
    private: false,
    fork: true,
    archived: false,
  },
  {
    name: "old-archived",
    full_name: "acme/old-archived",
    description: "",
    language: "Go",
    pushed_at: "2026-04-15T10:00:00Z",
    private: false,
    fork: false,
    archived: true,
  },
  {
    name: "project-c-work",
    full_name: "acme/project-c-work",
    description: "B2G field-practice platform",
    language: "TypeScript",
    pushed_at: "2026-04-14T10:00:00Z",
    private: false,
    fork: false,
    archived: false,
  },
  {
    name: "project-d-tune",
    full_name: "acme/project-d-tune",
    description: "Wake-shift algorithm",
    language: "Swift",
    pushed_at: "2026-04-13T10:00:00Z",
    private: true,
    fork: false,
    archived: false,
  },
  {
    name: "project-e-gov",
    full_name: "acme/project-e-gov",
    description: "Grief risk governance",
    language: "Python",
    pushed_at: "2026-04-12T10:00:00Z",
    private: false,
    fork: false,
    archived: false,
  },
];

function makeExecFile({ ghMissing = false, result = SAMPLE_REPOS, failWith = null } = {}) {
  return function fakeExecFile(bin, args, opts) {
    if (bin !== "gh") throw new Error(`unexpected bin: ${bin}`);
    if (ghMissing) {
      const err = new Error("spawn gh ENOENT");
      err.code = "ENOENT";
      throw err;
    }
    if (args[0] === "--version") return "gh version 2.0.0\n";
    if (args[0] === "api") {
      if (failWith) {
        const err = new Error("gh api failed");
        err.stderr = Buffer.from(failWith);
        throw err;
      }
      return JSON.stringify(result);
    }
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
}

// ── Tests ─────────────────────────────────────────────────────────
describe("repo-discovery: parseReposJson", () => {
  it("parses gh api output into normalized shape", () => {
    const parsed = repoDiscovery.parseReposJson(JSON.stringify(SAMPLE_REPOS));
    expect(parsed).toHaveLength(7);
    expect(parsed[0]).toMatchObject({
      name: "project-a-store",
      fullName: "acme/project-a-store",
      language: "TypeScript",
      private: false,
      fork: false,
    });
  });

  it("tolerates missing fields (description null, no language)", () => {
    const parsed = repoDiscovery.parseReposJson(
      JSON.stringify([{ name: "x", full_name: "o/x" }]),
    );
    expect(parsed).toEqual([
      {
        name: "x",
        fullName: "o/x",
        description: "",
        language: "",
        pushedAt: "",
        private: false,
        fork: false,
        archived: false,
      },
    ]);
  });

  it("returns [] on non-array response (e.g. gh error envelope)", () => {
    expect(repoDiscovery.parseReposJson(JSON.stringify({ message: "Not Found" }))).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(repoDiscovery.parseReposJson("not json")).toEqual([]);
  });
});

describe("repo-discovery: defaultPreselect", () => {
  it("picks top-5 non-fork non-archived repos (sorted-by-pushed assumption)", () => {
    const parsed = repoDiscovery.parseReposJson(JSON.stringify(SAMPLE_REPOS));
    const preselected = repoDiscovery.defaultPreselect(parsed);
    expect(preselected).toEqual([
      "project-a-store",
      "project-b-app",
      "project-c-work",
      "project-d-tune",
      "project-e-gov",
    ]);
    // legacy-fork (fork) and old-archived (archived) are excluded.
    expect(preselected).not.toContain("legacy-fork");
    expect(preselected).not.toContain("old-archived");
  });

  it("respects a smaller count param", () => {
    const parsed = repoDiscovery.parseReposJson(JSON.stringify(SAMPLE_REPOS));
    expect(repoDiscovery.defaultPreselect(parsed, 2)).toEqual(["project-a-store", "project-b-app"]);
  });
});

describe("repo-discovery: parseSelectionInput", () => {
  const parsed = repoDiscovery.parseReposJson(JSON.stringify(SAMPLE_REPOS));
  const pre = repoDiscovery.defaultPreselect(parsed);

  it("empty input → returns preselected", () => {
    expect(repoDiscovery.parseSelectionInput("", parsed, pre)).toEqual(pre);
  });

  it("'all' → every repo", () => {
    expect(repoDiscovery.parseSelectionInput("all", parsed, pre)).toHaveLength(parsed.length);
  });

  it("'none' → empty list", () => {
    expect(repoDiscovery.parseSelectionInput("none", parsed, pre)).toEqual([]);
  });

  it("'1,3,5-6' → specific numeric picks + range", () => {
    const sel = repoDiscovery.parseSelectionInput("1,3,5-6", parsed, pre);
    expect(sel).toContain("project-a-store"); // #1
    expect(sel).toContain("legacy-fork"); // #3
    expect(sel).toContain("project-c-work");    // #5
    expect(sel).toContain("project-d-tune");   // #6
    expect(sel).toHaveLength(4);
  });

  it("accepts raw repo name", () => {
    expect(repoDiscovery.parseSelectionInput("project-a-store", parsed, pre)).toEqual(["project-a-store"]);
  });
});

describe("repo-discovery: fetchRepos (mocked gh)", () => {
  it("returns parsed repo list when gh is available", () => {
    const out = repoDiscovery.fetchRepos({
      org: "acme",
      execFile: makeExecFile({ result: SAMPLE_REPOS }),
    });
    expect(out).toHaveLength(7);
    expect(out[0].name).toBe("project-a-store");
  });

  it("returns null when gh is not on PATH", () => {
    const out = repoDiscovery.fetchRepos({
      org: "acme",
      execFile: makeExecFile({ ghMissing: true }),
    });
    expect(out).toBeNull();
  });

  it("throws a tagged error when gh api itself fails (auth/404)", () => {
    expect(() =>
      repoDiscovery.fetchRepos({
        org: "acme",
        execFile: makeExecFile({ failWith: "HTTP 404: Not Found" }),
      }),
    ).toThrowError(/gh api failed/);
  });

  it("uses /orgs/{org}/repos endpoint when org is given", () => {
    let capturedArgs = null;
    const exec = (bin, args) => {
      if (args[0] === "--version") return "gh 2.0.0";
      capturedArgs = args;
      return JSON.stringify(SAMPLE_REPOS);
    };
    repoDiscovery.fetchRepos({ org: "acme-org", execFile: exec });
    expect(capturedArgs[1]).toContain("/orgs/bae-org/repos");
  });

  it("uses /user/repos endpoint when org is empty", () => {
    let capturedArgs = null;
    const exec = (bin, args) => {
      if (args[0] === "--version") return "gh 2.0.0";
      capturedArgs = args;
      return JSON.stringify(SAMPLE_REPOS);
    };
    repoDiscovery.fetchRepos({ org: "", execFile: exec });
    expect(capturedArgs[1]).toContain("/user/repos");
    expect(capturedArgs[1]).toContain("affiliation=");
  });
});

describe("repo-discovery: saveSelection / loadSelection", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-disc-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips a selection", () => {
    const file = path.join(tmp, "repos.json");
    const parsed = repoDiscovery.parseReposJson(JSON.stringify(SAMPLE_REPOS));
    const selected = ["project-a-store", "project-b-app"];

    const written = repoDiscovery.saveSelection(
      { org: "acme", selected, discovered: parsed },
      file,
    );
    expect(written).toBe(file);
    expect(fs.existsSync(file)).toBe(true);

    const loaded = repoDiscovery.loadSelection(file);
    expect(loaded.org).toBe("bae");
    expect(loaded.selected).toEqual(selected);
    expect(loaded.discovered).toHaveLength(7);
    expect(loaded.version).toBe(1);
    expect(typeof loaded.updatedAt).toBe("string");
  });

  it("loadSelection returns null for missing file", () => {
    expect(repoDiscovery.loadSelection(path.join(tmp, "nope.json"))).toBeNull();
  });

  it("loadSelection returns null for corrupted file", () => {
    const file = path.join(tmp, "bad.json");
    fs.writeFileSync(file, "not json");
    expect(repoDiscovery.loadSelection(file)).toBeNull();
  });
});
