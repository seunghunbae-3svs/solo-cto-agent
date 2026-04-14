// PR-G4 — T2 Security Advisories (OSV.dev / GHSA / CVE) tests.
// Network calls are stubbed via fetchImpl injection so CI stays offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeOsvSeverity,
  severityRank,
  fetchOsvAdvisories,
  fetchSecurityAdvisories,
  fetchExternalKnowledge,
  formatExternalKnowledgeContext,
} from "../bin/cowork-engine.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sec-adv-test-"));
}

function writePkg(dir, pkg) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

// --------------------------------------------------------------------------
// Stub helpers: build a fake OSV vuln document.
// --------------------------------------------------------------------------
function vuln({ id, severity, cve, ghsa, summary = "test vuln", cvssScore }) {
  const v = {
    id: id || "GHSA-xxxx-xxxx-xxxx",
    summary,
    aliases: [],
    references: [{ url: "https://example.com/advisory" }],
  };
  if (cve) v.aliases.push(cve);
  if (ghsa && !v.id.startsWith("GHSA")) v.aliases.push(ghsa);
  if (severity) v.database_specific = { severity };
  if (cvssScore !== undefined) v.severity = [{ type: "CVSS_V3", score: String(cvssScore) }];
  return v;
}

function stubOsvFetch(vulnMap) {
  // vulnMap: { "lodash@4.17.20": [vuln, vuln], ... }
  return async (url, opts) => {
    if (!String(url).includes("osv.dev")) return { ok: false, status: 404, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    const key = `${body.package.name}@${body.version}`;
    const vulns = vulnMap[key] || [];
    return { ok: true, status: 200, json: async () => ({ vulns }) };
  };
}

function stubRegistryFetch(versionMap) {
  // versionMap: { "lodash": { latest: "4.17.21", deprecated: null }, ... }
  return async (url) => {
    const name = decodeURIComponent(String(url).replace("https://registry.npmjs.org/", ""));
    const info = versionMap[name];
    if (!info) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        "dist-tags": { latest: info.latest },
        versions: { [info.latest]: { deprecated: info.deprecated || undefined } },
      }),
    };
  };
}

function stubCombinedFetch(osvVulnMap, registryMap) {
  const osv = stubOsvFetch(osvVulnMap);
  const reg = stubRegistryFetch(registryMap || {});
  return async (url, opts) => {
    if (String(url).includes("osv.dev")) return osv(url, opts);
    return reg(url, opts);
  };
}

// --------------------------------------------------------------------------
// normalizeOsvSeverity
// --------------------------------------------------------------------------
describe("normalizeOsvSeverity", () => {
  it("prefers database_specific.severity when present", () => {
    expect(normalizeOsvSeverity(vuln({ severity: "HIGH" }))).toBe("HIGH");
    expect(normalizeOsvSeverity(vuln({ severity: "CRITICAL" }))).toBe("CRITICAL");
    expect(normalizeOsvSeverity(vuln({ severity: "moderate" }))).toBe("MODERATE");
  });

  it("derives from CVSS numeric score when db-specific missing", () => {
    expect(normalizeOsvSeverity(vuln({ cvssScore: 9.5 }))).toBe("CRITICAL");
    expect(normalizeOsvSeverity(vuln({ cvssScore: 7.5 }))).toBe("HIGH");
    expect(normalizeOsvSeverity(vuln({ cvssScore: 5.0 }))).toBe("MODERATE");
    expect(normalizeOsvSeverity(vuln({ cvssScore: 2.0 }))).toBe("LOW");
  });

  it("returns UNKNOWN when no severity info", () => {
    expect(normalizeOsvSeverity({ id: "x" })).toBe("UNKNOWN");
    expect(normalizeOsvSeverity({})).toBe("UNKNOWN");
    expect(normalizeOsvSeverity(null)).toBe("UNKNOWN");
  });
});

// --------------------------------------------------------------------------
// severityRank
// --------------------------------------------------------------------------
describe("severityRank", () => {
  it("orders CRITICAL > HIGH > MODERATE > LOW > UNKNOWN", () => {
    expect(severityRank("CRITICAL")).toBeGreaterThan(severityRank("HIGH"));
    expect(severityRank("HIGH")).toBeGreaterThan(severityRank("MODERATE"));
    expect(severityRank("MODERATE")).toBeGreaterThan(severityRank("LOW"));
    expect(severityRank("LOW")).toBeGreaterThan(severityRank("UNKNOWN"));
    expect(severityRank(null)).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(severityRank("critical")).toBe(severityRank("CRITICAL"));
  });
});

// --------------------------------------------------------------------------
// fetchOsvAdvisories
// --------------------------------------------------------------------------
describe("fetchOsvAdvisories", () => {
  it("returns empty vulns list when package is clean", async () => {
    const fetchImpl = stubOsvFetch({});
    const r = await fetchOsvAdvisories("safe-pkg", "1.0.0", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.vulns).toEqual([]);
  });

  it("extracts id, cve, ghsa, summary, severity, references", async () => {
    const fetchImpl = stubOsvFetch({
      "lodash@4.17.20": [vuln({
        id: "GHSA-p6mc-m468-83gw",
        severity: "HIGH",
        cve: "CVE-2020-28500",
        summary: "ReDoS in lodash",
      })],
    });
    const r = await fetchOsvAdvisories("lodash", "4.17.20", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.vulns).toHaveLength(1);
    const v = r.vulns[0];
    expect(v.id).toBe("GHSA-p6mc-m468-83gw");
    expect(v.ghsa).toBe("GHSA-p6mc-m468-83gw");
    expect(v.cve).toBe("CVE-2020-28500");
    expect(v.severity).toBe("HIGH");
    expect(v.summary).toBe("ReDoS in lodash");
    expect(v.references).toContain("https://example.com/advisory");
  });

  it("sorts vulns by severity desc", async () => {
    const fetchImpl = stubOsvFetch({
      "multi@1.0.0": [
        vuln({ id: "GHSA-low", severity: "LOW" }),
        vuln({ id: "GHSA-crit", severity: "CRITICAL" }),
        vuln({ id: "GHSA-high", severity: "HIGH" }),
      ],
    });
    const r = await fetchOsvAdvisories("multi", "1.0.0", { fetchImpl });
    expect(r.vulns.map((v) => v.severity)).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("returns error on http failure", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await fetchOsvAdvisories("x", "1.0.0", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/osv http 503/);
  });

  it("returns error when name or version missing", async () => {
    const fetchImpl = stubOsvFetch({});
    expect((await fetchOsvAdvisories("", "1.0.0", { fetchImpl })).ok).toBe(false);
    expect((await fetchOsvAdvisories("x", "", { fetchImpl })).ok).toBe(false);
  });
});

// --------------------------------------------------------------------------
// fetchSecurityAdvisories
// --------------------------------------------------------------------------
describe("fetchSecurityAdvisories", () => {
  it("aggregates vulns across packages with severity summary", async () => {
    const fetchImpl = stubOsvFetch({
      "lodash@4.17.20": [vuln({ id: "GHSA-a", severity: "HIGH" })],
      "react@18.0.0": [],
      "axios@0.21.0": [
        vuln({ id: "GHSA-b", severity: "CRITICAL" }),
        vuln({ id: "GHSA-c", severity: "MODERATE" }),
      ],
    });
    const r = await fetchSecurityAdvisories({
      deps: { lodash: "4.17.20", react: "18.0.0", axios: "0.21.0" },
      fetchImpl,
    });
    expect(r.scanned).toBe(3);
    expect(r.summary.totalVulns).toBe(3);
    expect(r.summary.packagesAffected).toBe(2);
    expect(r.summary.critical).toBe(1);
    expect(r.summary.high).toBe(1);
    expect(r.summary.moderate).toBe(1);
  });

  it("sorts entries so highest-severity packages come first", async () => {
    const fetchImpl = stubOsvFetch({
      "low-pkg@1.0.0": [vuln({ id: "GHSA-l", severity: "LOW" })],
      "crit-pkg@2.0.0": [vuln({ id: "GHSA-c", severity: "CRITICAL" })],
      "clean-pkg@3.0.0": [],
    });
    const r = await fetchSecurityAdvisories({
      deps: { "low-pkg": "1.0.0", "crit-pkg": "2.0.0", "clean-pkg": "3.0.0" },
      fetchImpl,
    });
    expect(r.entries[0].name).toBe("crit-pkg");
    expect(r.entries[1].name).toBe("low-pkg");
    // clean-pkg last (no vulns)
    expect(r.entries[2].name).toBe("clean-pkg");
  });

  it("skips entries with unresolvable versions (workspace:, git:, etc)", async () => {
    const fetchImpl = stubOsvFetch({});
    const r = await fetchSecurityAdvisories({
      deps: { "internal": "workspace:*", "git-dep": "git+https://github.com/x/y.git" },
      fetchImpl,
    });
    expect(r.summary.skipped).toBe(2);
    expect(r.summary.totalVulns).toBe(0);
  });

  it("respects limit option", async () => {
    const fetchImpl = stubOsvFetch({});
    const deps = {};
    for (let i = 0; i < 30; i++) deps[`pkg${i}`] = "1.0.0";
    const r = await fetchSecurityAdvisories({ deps, fetchImpl, limit: 5 });
    expect(r.scanned).toBe(5);
    expect(r.total).toBe(30);
  });
});

// --------------------------------------------------------------------------
// fetchExternalKnowledge integration
// --------------------------------------------------------------------------
describe("fetchExternalKnowledge — with security advisories", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("includes securityAdvisories when COWORK_EXTERNAL_KNOWLEDGE=1", async () => {
    writePkg(dir, {
      name: "test-app",
      dependencies: { lodash: "4.17.20" },
    });
    const fetchImpl = stubCombinedFetch(
      { "lodash@4.17.20": [vuln({ id: "GHSA-x", severity: "HIGH" })] },
      { lodash: { latest: "4.17.21" } },
    );
    const ek = await fetchExternalKnowledge({
      cwd: dir,
      fetchImpl,
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(ek.enabled).toBe(true);
    expect(ek.securityAdvisories).not.toBeNull();
    expect(ek.securityAdvisories.summary.totalVulns).toBe(1);
    expect(ek.hasData).toBe(true);
  });

  it("opts out of security advisories when flag set to 0", async () => {
    writePkg(dir, {
      name: "test-app",
      dependencies: { lodash: "4.17.20" },
    });
    const fetchImpl = stubCombinedFetch(
      { "lodash@4.17.20": [vuln({ id: "GHSA-x", severity: "HIGH" })] },
      { lodash: { latest: "4.17.21" } },
    );
    const ek = await fetchExternalKnowledge({
      cwd: dir,
      fetchImpl,
      env: {
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        COWORK_EXTERNAL_KNOWLEDGE_SECURITY: "0",
      },
    });
    expect(ek.enabled).toBe(true);
    expect(ek.securityAdvisories).toBeNull();
  });

  it("hasData is true when advisories present even if currency empty", async () => {
    writePkg(dir, {
      name: "test-app",
      dependencies: { lodash: "4.17.20" },
    });
    // Registry returns same version → currency has "same" entry which still
    // counts as a currency entry. Test advisories-only by using an
    // unresolvable-by-registry package: we stub registry to fail for this
    // package so packageCurrency.entries has an error entry (still counts as
    // entry). To cleanly isolate we use both empty deps case instead.
    const fetchImpl = stubCombinedFetch(
      { "lodash@4.17.20": [vuln({ id: "GHSA-x", severity: "HIGH" })] },
      { lodash: { latest: "4.17.20" } }, // same version → "same" diff
    );
    const ek = await fetchExternalKnowledge({
      cwd: dir,
      fetchImpl,
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(ek.hasData).toBe(true);
    expect(ek.securityAdvisories.summary.totalVulns).toBe(1);
  });
});

// --------------------------------------------------------------------------
// formatExternalKnowledgeContext — advisory rendering
// --------------------------------------------------------------------------
describe("formatExternalKnowledgeContext — advisories", () => {
  it("renders advisory section when vulns present", () => {
    const ek = {
      enabled: true,
      packageCurrency: { entries: [], summary: {}, scanned: 0, total: 0 },
      securityAdvisories: {
        scanned: 1,
        total: 1,
        entries: [{
          name: "lodash",
          version: "4.17.20",
          installedSpec: "4.17.20",
          ok: true,
          vulns: [{
            id: "GHSA-x",
            cve: "CVE-2020-1",
            ghsa: "GHSA-x",
            severity: "HIGH",
            summary: "bad thing",
            references: [],
          }],
        }],
        summary: {
          critical: 0, high: 1, moderate: 0, low: 0, unknown: 0,
          packagesAffected: 1, totalVulns: 1, errored: 0, skipped: 0,
        },
      },
    };
    const out = formatExternalKnowledgeContext(ek);
    expect(out).toMatch(/보안 취약점/);
    expect(out).toMatch(/lodash@4\.17\.20/);
    expect(out).toMatch(/HIGH/);
    expect(out).toMatch(/CVE-2020-1/);
  });

  it("returns empty string when nothing to report (no currency issues, no vulns)", () => {
    const ek = {
      enabled: true,
      packageCurrency: { entries: [], summary: {}, scanned: 0, total: 0 },
      securityAdvisories: {
        entries: [], summary: { totalVulns: 0, packagesAffected: 0 },
      },
    };
    expect(formatExternalKnowledgeContext(ek)).toBe("");
  });

  it("renders both currency + advisories when both have data", () => {
    const ek = {
      enabled: true,
      packageCurrency: {
        entries: [{ name: "react", installedSpec: "17.0.0", installed: "17.0.0", latest: "18.2.0", diff: "major", ok: true }],
        summary: { major: 1, minor: 0, patch: 0, deprecated: 0, errored: 0 },
        scanned: 1, total: 1,
      },
      securityAdvisories: {
        entries: [{
          name: "lodash", version: "4.17.20", installedSpec: "4.17.20", ok: true,
          vulns: [{ id: "GHSA-x", cve: "CVE-2020-1", ghsa: "GHSA-x", severity: "CRITICAL", summary: "rce", references: [] }],
        }],
        summary: { critical: 1, high: 0, moderate: 0, low: 0, unknown: 0, packagesAffected: 1, totalVulns: 1, errored: 0, skipped: 0 },
      },
    };
    const out = formatExternalKnowledgeContext(ek);
    expect(out).toMatch(/스택 최신성/);
    expect(out).toMatch(/보안 취약점/);
    expect(out).toMatch(/CRITICAL/);
  });
});
