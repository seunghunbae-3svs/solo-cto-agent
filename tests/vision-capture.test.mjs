// PR-G5 — URL → screenshot capture (Playwright-free path).
// Network calls stubbed via fetchImpl injection.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { captureScreenshotFromUrl, VIEWPORT_DIMS } from "../bin/uiux-engine.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vision-capture-"));
}

function makePngResponse(bytes = 1024) {
  const buf = Buffer.alloc(bytes, 0x42);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

describe("VIEWPORT_DIMS", () => {
  it("defines mobile / tablet / desktop dimensions", () => {
    expect(VIEWPORT_DIMS.mobile).toEqual({ width: 375, height: 812 });
    expect(VIEWPORT_DIMS.tablet).toEqual({ width: 768, height: 1024 });
    expect(VIEWPORT_DIMS.desktop).toEqual({ width: 1280, height: 800 });
  });
});

describe("captureScreenshotFromUrl", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes a screenshot file for a valid URL", async () => {
    let capturedShotUrl = null;
    const fetchImpl = async (u) => { capturedShotUrl = String(u); return makePngResponse(2048); };
    const outPath = path.join(dir, "shot.png");
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "desktop",
      outPath,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(outPath);
    expect(r.bytes).toBe(2048);
    expect(r.source).toBe("thum.io");
    expect(fs.existsSync(outPath)).toBe(true);
    expect(capturedShotUrl).toMatch(/thum\.io/);
    expect(capturedShotUrl).toMatch(/width\/1280/);
    expect(capturedShotUrl).toMatch(/https%3A%2F%2Fexample\.com/);
  });

  it("uses mobile viewport width when requested", async () => {
    let capturedShotUrl = null;
    const fetchImpl = async (u) => { capturedShotUrl = String(u); return makePngResponse(); };
    const outPath = path.join(dir, "m.png");
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "mobile",
      outPath,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.viewport).toBe("mobile");
    expect(capturedShotUrl).toMatch(/width\/375/);
  });

  it("falls back to desktop for unknown viewport name", async () => {
    let capturedShotUrl = null;
    const fetchImpl = async (u) => { capturedShotUrl = String(u); return makePngResponse(); };
    const outPath = path.join(dir, "x.png");
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "ultrawide-5k",
      outPath,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(capturedShotUrl).toMatch(/width\/1280/);
  });

  it("returns error on http failure", async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "desktop",
      outPath: path.join(dir, "fail.png"),
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/capture http 502/);
  });

  it("returns error when url missing", async () => {
    const fetchImpl = async () => makePngResponse();
    const r = await captureScreenshotFromUrl("", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/url required/);
  });

  it("returns error on empty response body", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "desktop",
      outPath: path.join(dir, "empty.png"),
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty screenshot/);
  });

  it("auto-generates outPath in tmp dir when not provided", async () => {
    const fetchImpl = async () => makePngResponse(512);
    const r = await captureScreenshotFromUrl("https://example.com", {
      viewport: "desktop",
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.path).toMatch(/uiux-capture-\d+\.png$/);
    expect(fs.existsSync(r.path)).toBe(true);
    // Clean up
    fs.unlinkSync(r.path);
  });
});
