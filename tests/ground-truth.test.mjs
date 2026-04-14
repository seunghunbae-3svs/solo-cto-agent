// PR-E1 — T3 Ground Truth fetch + format tests.
// Network calls are stubbed via fetchImpl injection so CI stays offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveVercelProject,
  resolveSupabaseProject,
  fetchVercelGroundTruth,
  summarizeVercelDeployments,
  fetchGroundTruth,
  formatGroundTruthContext,
} from "../bin/cowork-engine.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gt-test-"));
}

describe("resolveVercelProject", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("returns null when no .vercel and no env", () => {
    const r = resolveVercelProject({ cwd: dir, env: {} });
    expect(r).toBeNull();
  });

  it("reads .vercel/project.json when present", () => {
    fs.mkdirSync(path.join(dir, ".vercel"));
    fs.writeFileSync(
      path.join(dir, ".vercel", "project.json"),
      JSON.stringify({ projectId: "prj_123", orgId: "team_abc" }),
    );
    const r = resolveVercelProject({ cwd: dir, env: {} });
    expect(r.projectId).toBe("prj_123");
    expect(r.orgId).toBe("team_abc");
    expect(r.source).toMatch(/project\.json/);
  });

  it("falls back to VERCEL_PROJECT_ID env", () => {
    const r = resolveVercelProject({ cwd: dir, env: { VERCEL_PROJECT_ID: "prj_env", VERCEL_TEAM_ID: "team_x" } });
    expect(r.projectId).toBe("prj_env");
    expect(r.orgId).toBe("team_x");
  });

  it("prefers .vercel/project.json over env", () => {
    fs.mkdirSync(path.join(dir, ".vercel"));
    fs.writeFileSync(
      path.join(dir, ".vercel", "project.json"),
      JSON.stringify({ projectId: "prj_fs" }),
    );
    const r = resolveVercelProject({ cwd: dir, env: { VERCEL_PROJECT_ID: "prj_env" } });
    expect(r.projectId).toBe("prj_fs");
  });

  it("handles corrupted project.json gracefully", () => {
    fs.mkdirSync(path.join(dir, ".vercel"));
    fs.writeFileSync(path.join(dir, ".vercel", "project.json"), "{not json");
    const r = resolveVercelProject({ cwd: dir, env: { VERCEL_PROJECT_ID: "prj_env" } });
    expect(r.projectId).toBe("prj_env");
  });
});

describe("resolveSupabaseProject", () => {
  it("returns null without SUPABASE_PROJECT_REF", () => {
    expect(resolveSupabaseProject({ env: {} })).toBeNull();
  });
  it("reads SUPABASE_PROJECT_REF", () => {
    const r = resolveSupabaseProject({ env: { SUPABASE_PROJECT_REF: "abc123" } });
    expect(r.projectRef).toBe("abc123");
  });
});

describe("summarizeVercelDeployments", () => {
  it("counts states and finds latest production / error", () => {
    const deployments = [
      { uid: "1", state: "READY", target: "production", createdAt: 3 },
      { uid: "2", state: "ERROR", target: "production", createdAt: 2 },
      { uid: "3", state: "READY", target: null, createdAt: 1 },
    ];
    const s = summarizeVercelDeployments(deployments);
    expect(s.total).toBe(3);
    expect(s.byState.READY).toBe(2);
    expect(s.byState.ERROR).toBe(1);
    expect(s.latestProduction.uid).toBe("1");
    expect(s.latestError.uid).toBe("2");
    expect(s.errorCount).toBe(1);
  });

  it("handles empty deployments list", () => {
    const s = summarizeVercelDeployments([]);
    expect(s.total).toBe(0);
    expect(s.latestProduction).toBeNull();
    expect(s.latestError).toBeNull();
    expect(s.errorCount).toBe(0);
  });
});

describe("fetchVercelGroundTruth (mocked fetch)", () => {
  it("returns ok:false without token", async () => {
    const r = await fetchVercelGroundTruth({ token: null, projectId: "p" });
    expect(r.ok).toBe(false);
  });

  it("returns ok:false without projectId", async () => {
    const r = await fetchVercelGroundTruth({ token: "t", projectId: null });
    expect(r.ok).toBe(false);
  });

  it("returns deployments when API returns 200", async () => {
    const fetchImpl = async (url, opts) => {
      expect(url).toMatch(/api\.vercel\.com\/v6\/deployments/);
      expect(opts.headers.Authorization).toBe("Bearer tok");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          deployments: [
            { uid: "d1", state: "READY", url: "app.vercel.app", target: "production", created: 1000 },
            { uid: "d2", state: "ERROR", url: "app-preview.vercel.app", created: 900 },
          ],
        }),
      };
    };
    const r = await fetchVercelGroundTruth({ token: "tok", projectId: "prj", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.deployments).toHaveLength(2);
    expect(r.summary.errorCount).toBe(1);
    expect(r.summary.latestProduction.uid).toBe("d1");
  });

  it("returns ok:false on http error", async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await fetchVercelGroundTruth({ token: "bad", projectId: "p", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it("returns ok:false with 'timeout' on AbortError", async () => {
    const fetchImpl = async (_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };
    const r = await fetchVercelGroundTruth({ token: "t", projectId: "p", fetchImpl, timeoutMs: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
  });
});

describe("fetchGroundTruth orchestrator", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("returns empty result when no T3 env vars set", async () => {
    const r = await fetchGroundTruth({ env: {}, cwd: dir });
    expect(r.vercel).toBeNull();
    expect(r.supabase).toBeNull();
    expect(r.hasData).toBe(false);
  });

  it("returns project-not-identified when VERCEL_TOKEN set but no project", async () => {
    const r = await fetchGroundTruth({ env: { VERCEL_TOKEN: "t" }, cwd: dir });
    expect(r.vercel.ok).toBe(false);
    expect(r.vercel.error).toMatch(/project not identified/);
    expect(r.hasData).toBe(false);
  });

  it("fetches Vercel data when token + project resolved via env", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ uid: "d1", state: "READY", target: "production", created: 1 }] }),
    });
    const r = await fetchGroundTruth({
      env: { VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.vercel.ok).toBe(true);
    expect(r.hasData).toBe(true);
  });

  it("surfaces supabase project-not-identified when token set without ref", async () => {
    const r = await fetchGroundTruth({ env: { SUPABASE_ACCESS_TOKEN: "t" }, cwd: dir });
    expect(r.supabase.ok).toBe(false);
    expect(r.supabase.error).toMatch(/SUPABASE_PROJECT_REF/);
  });
});

describe("formatGroundTruthContext", () => {
  it("returns empty string for null input", () => {
    expect(formatGroundTruthContext(null)).toBe("");
  });

  it("returns empty string when no fetcher attempted", () => {
    const gt = { vercel: null, supabase: null, hasData: false };
    expect(formatGroundTruthContext(gt)).toBe("");
  });

  it("includes '최근 프로덕션 신호' header when data present", () => {
    const gt = {
      vercel: {
        ok: true,
        deployments: [{ uid: "d1", state: "READY", target: "production", createdAt: 1000 }],
        summary: summarizeVercelDeployments([{ uid: "d1", state: "READY", target: "production", createdAt: 1000 }]),
      },
      hasData: true,
    };
    const out = formatGroundTruthContext(gt);
    expect(out).toMatch(/최근 프로덕션 신호/);
    expect(out).toMatch(/Vercel/);
    expect(out).toMatch(/T3 Ground Truth/);
  });

  it("warns about recent ERROR deployment when present", () => {
    const deps = [
      { uid: "d1", state: "ERROR", target: "production", createdAt: 2000 },
      { uid: "d2", state: "READY", target: "production", createdAt: 1000 },
    ];
    const gt = {
      vercel: { ok: true, deployments: deps, summary: summarizeVercelDeployments(deps) },
      hasData: true,
    };
    const out = formatGroundTruthContext(gt);
    expect(out).toMatch(/ERROR 배포 있음/);
    expect(out).toMatch(/d1/);
  });

  it("shows vercel error message when fetch failed", () => {
    const gt = { vercel: { ok: false, error: "vercel http 401" }, hasData: false };
    const out = formatGroundTruthContext(gt);
    expect(out).toMatch(/조회 실패/);
    expect(out).toMatch(/401/);
    expect(out).toMatch(/미검증/);
  });
});
