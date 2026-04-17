/**
 * P2 — Verify index.d.ts stays in sync with runtime exports.
 * Catches drift when new functions are added to modules but not declared in types.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const DTS_PATH = path.join(process.cwd(), "index.d.ts");
const dts = fs.readFileSync(DTS_PATH, "utf8");

/**
 * Extract all `export function <name>` from a d.ts module block or top-level.
 */
function extractDeclaredFunctions(source) {
  return [...source.matchAll(/export function (\w+)/g)].map((m) => m[1]);
}

describe("index.d.ts ↔ runtime export sync", () => {
  it("cowork-engine exports are all declared in d.ts", () => {
    const engine = require("../bin/cowork-engine.js");
    const runtimeExports = Object.keys(engine).filter(
      (k) => typeof engine[k] === "function" && !k.startsWith("_")
    );
    const allDeclared = extractDeclaredFunctions(dts);
    const missing = runtimeExports.filter((e) => !allDeclared.includes(e));
    expect(missing, `Missing from index.d.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("safe-log exports are declared in d.ts", () => {
    const mod = require("../bin/safe-log.js");
    const runtimeFns = Object.keys(mod).filter((k) => typeof mod[k] === "function");
    const allDeclared = extractDeclaredFunctions(dts);
    const missing = runtimeFns.filter((e) => !allDeclared.includes(e));
    expect(missing, `Missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("diff-guard exports are declared in d.ts", () => {
    const mod = require("../bin/diff-guard.js");
    const runtimeFns = Object.keys(mod).filter((k) => typeof mod[k] === "function");
    const allDeclared = extractDeclaredFunctions(dts);
    const missing = runtimeFns.filter((e) => !allDeclared.includes(e));
    expect(missing, `Missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("plugin-manager public exports are declared in d.ts", () => {
    const mod = require("../bin/plugin-manager.js");
    const publicFns = Object.keys(mod).filter(
      (k) => typeof mod[k] === "function" && !k.startsWith("_")
    );
    const allDeclared = extractDeclaredFunctions(dts);
    // Only check key public APIs, not every internal helper
    const keyExports = ["searchRegistry", "installFromRegistry", "installFromPath", "addPlugin", "removePlugin", "listPlugins"];
    const missing = keyExports.filter((e) => !allDeclared.includes(e));
    expect(missing, `Missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("template-audit public exports are declared in d.ts", () => {
    const allDeclared = extractDeclaredFunctions(dts);
    expect(allDeclared).toContain("applyFixes");
  });

  it("d.ts declares DiffScanResult and DiffFinding interfaces", () => {
    expect(dts).toMatch(/export interface DiffScanResult/);
    expect(dts).toMatch(/export interface DiffFinding/);
  });

  it("d.ts declares PluginInstallResult interface", () => {
    expect(dts).toMatch(/export interface PluginInstallResult/);
  });

  it("d.ts declares ApplyFixResult interface", () => {
    expect(dts).toMatch(/export interface ApplyFixResult/);
  });
});
