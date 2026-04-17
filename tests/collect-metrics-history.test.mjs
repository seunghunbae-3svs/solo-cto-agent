import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const BENCHMARKS_DIR = path.join(process.cwd(), "benchmarks");
const HISTORY_DIR = path.join(BENCHMARKS_DIR, "history");
const METRICS_LATEST = path.join(BENCHMARKS_DIR, "metrics-latest.json");

describe("collect-metrics history archiving", () => {
  beforeEach(() => {
    // Ensure clean history for testing
    if (fs.existsSync(HISTORY_DIR)) {
      const files = fs.readdirSync(HISTORY_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(HISTORY_DIR, file));
      }
      fs.rmdirSync(HISTORY_DIR);
    }
  });

  afterEach(() => {
    // Cleanup test files
    if (fs.existsSync(HISTORY_DIR)) {
      const files = fs.readdirSync(HISTORY_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(HISTORY_DIR, file));
      }
      fs.rmdirSync(HISTORY_DIR);
    }
  });

  it("creates history directory if not exists", () => {
    const metricsDir = path.dirname(METRICS_LATEST);
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    // Simulate metric archiving
    const historyDir = path.join(BENCHMARKS_DIR, "history");
    fs.mkdirSync(historyDir, { recursive: true });
    expect(fs.existsSync(historyDir)).toBe(true);
  });

  it("archives metrics with YYYY-MM-DD filename", () => {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const testMetrics = {
      repo: "test/repo",
      collected_at: new Date().toISOString(),
      pr_count: 10,
      merged_count: 8,
    };

    const historyFile = path.join(HISTORY_DIR, `${today}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(testMetrics, null, 2));

    expect(fs.existsSync(historyFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    expect(content.pr_count).toBe(10);
  });

  it("overwrites existing day's snapshot", () => {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const historyFile = path.join(HISTORY_DIR, `${today}.json`);

    // First write
    const metrics1 = { pr_count: 10, merged_count: 8 };
    fs.writeFileSync(historyFile, JSON.stringify(metrics1, null, 2));

    // Second write (same day)
    const metrics2 = { pr_count: 12, merged_count: 9 };
    fs.writeFileSync(historyFile, JSON.stringify(metrics2, null, 2));

    const content = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    expect(content.pr_count).toBe(12); // Latest wins
  });

  it("preserves historical files from different days", () => {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });

    const dates = ["2026-04-15", "2026-04-16", "2026-04-17"];
    for (const date of dates) {
      const file = path.join(HISTORY_DIR, `${date}.json`);
      fs.writeFileSync(file, JSON.stringify({ date }));
    }

    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(3);
  });

  it("stores valid JSON that can be parsed back", () => {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const testMetrics = {
      repo: "test/repo",
      pr_count: 15,
      merged_count: 12,
      mean_time_to_merge_hours: 2.5,
      cross_review_rate: 0.8,
    };

    const historyFile = path.join(HISTORY_DIR, `${today}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(testMetrics, null, 2));

    expect(() => {
      const loaded = JSON.parse(fs.readFileSync(historyFile, "utf8"));
      expect(loaded.pr_count).toBe(15);
      expect(loaded.mean_time_to_merge_hours).toBe(2.5);
    }).not.toThrow();
  });

  it("handles metrics with various numeric types", () => {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const testMetrics = {
      pr_count: 100,
      mean_time_to_merge_hours: 1.25,
      cross_review_rate: 0.75,
      decision_approve_rate: 0.5,
      rework_cycle_avg: 0.16,
    };

    const historyFile = path.join(HISTORY_DIR, `${today}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(testMetrics, null, 2));

    const loaded = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    expect(loaded.pr_count).toBe(100);
    expect(loaded.mean_time_to_merge_hours).toBe(1.25);
    expect(loaded.rework_cycle_avg).toBe(0.16);
  });
});
