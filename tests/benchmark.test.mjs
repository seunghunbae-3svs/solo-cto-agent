import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");
const BENCHMARKS_DIR = path.join(process.cwd(), "benchmarks");
const METRICS_FILE = path.join(BENCHMARKS_DIR, "metrics-latest.json");

const run = (args = []) =>
  spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

// Create sample metrics for testing
function createSampleMetrics() {
  return {
    repo: "test/repo",
    orchestrator_repo: "test/orchestrator",
    window_days: 30,
    collected_at: new Date().toISOString(),
    pr_count: 50,
    merged_count: 45,
    mean_time_to_merge_hours: 0.5,
    review_count_avg: 1.5,
    changes_requested_rate: 0.1,
    cross_review_rate: 0.6,
    decision_count: 30,
    decision_approve_rate: 0.5,
    decision_revise_rate: 0.4,
    decision_hold_rate: 0.1,
    decision_mean_latency_hours: 8.5,
    comparison_report_count: 5,
    rework_cycle_total: 8,
    rework_cycle_avg: 0.16,
    prs_with_rework_rate: 0.1,
    managed_repos: ["repo-a", "repo-b", "repo-c"],
    managed_repo_count: 3,
    cross_repo_pr_count: 25,
    cross_repo_merged_count: 22,
  };
}

describe("cli benchmark", () => {
  let tmpDir;
  let metricsBackup;

  beforeEach(() => {
    // Backup existing metrics file
    if (fs.existsSync(METRICS_FILE)) {
      metricsBackup = fs.readFileSync(METRICS_FILE, "utf8");
    }
  });

  afterEach(() => {
    // Restore or clean up metrics file
    if (metricsBackup) {
      fs.writeFileSync(METRICS_FILE, metricsBackup, "utf8");
    } else if (fs.existsSync(METRICS_FILE)) {
      fs.unlinkSync(METRICS_FILE);
    }
  });

  it("displays metrics in terminal format by default", () => {
    // Create sample metrics
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("solo-cto-agent benchmark");
    expect(r.stdout).toContain("PR Metrics:");
    expect(r.stdout).toContain("Total PRs:");
    expect(r.stdout).toContain("Merged:");
    expect(r.stdout).toContain("Mean Time to Merge");
  });

  it("outputs raw JSON with --json flag", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark", "--json"]);
    expect(r.status).toBe(0);

    const output = JSON.parse(r.stdout);
    expect(output.repo).toBe("test/repo");
    expect(output.pr_count).toBe(50);
    expect(output.merged_count).toBe(45);
    expect(output.mean_time_to_merge_hours).toBe(0.5);
  });

  it("includes all key metrics in terminal output", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Review Decisions:");
    expect(r.stdout).toContain("Approve Rate:");
    expect(r.stdout).toContain("Revise Rate:");
    expect(r.stdout).toContain("Rework Metrics:");
    expect(r.stdout).toContain("Managed Repos:");
  });

  it("displays repo list in terminal output", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("repo-a");
    expect(r.stdout).toContain("repo-b");
    expect(r.stdout).toContain("repo-c");
  });

  it("formats percentages correctly", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    // 45/50 = 90%
    expect(r.stdout).toContain("90.0%");
    // 0.6 * 100 = 60%
    expect(r.stdout).toContain("60.0%");
  });

  it("formats hours correctly", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("0.50h");
  });

  it("exits with error when metrics file missing", () => {
    // Ensure metrics file doesn't exist
    if (fs.existsSync(METRICS_FILE)) {
      fs.unlinkSync(METRICS_FILE);
    }

    const r = run(["benchmark"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No benchmark metrics found");
  });

  it("validates JSON output is parseable", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark", "--json"]);
    expect(r.status).toBe(0);

    // Should not throw
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("handles missing optional fields gracefully", () => {
    const metrics = {
      repo: "test/repo",
      pr_count: 10,
      merged_count: 8,
      mean_time_to_merge_hours: 0.5,
      cross_review_rate: 0.5,
      decision_count: 5,
      decision_approve_rate: 0.4,
      decision_revise_rate: 0.6,
      decision_hold_rate: 0,
      decision_mean_latency_hours: 5,
      rework_cycle_total: 1,
      rework_cycle_avg: 0.1,
      prs_with_rework_rate: 0.05,
      managed_repo_count: 1,
      managed_repos: ["test"],
      cross_repo_pr_count: 2,
      cross_repo_merged_count: 2,
    };
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Total PRs:");
  });

  it("calculates merge rate from pr_count and merged_count", () => {
    const metrics = createSampleMetrics();
    metrics.pr_count = 100;
    metrics.merged_count = 75;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("75.0%");
  });

  it("handles zero PRs without division by zero", () => {
    const metrics = createSampleMetrics();
    metrics.pr_count = 0;
    metrics.merged_count = 0;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    // Should display 0% or NaN handling gracefully
    expect(r.stdout).toContain("PR Metrics:");
  });

  it("--html flag opens dashboard (or indicates path)", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    // On CI, the dashboard may not open, but command should try
    const r = run(["benchmark", "--html"]);
    // Check that dashboard was mentioned or tried (stdout or stderr)
    const output = r.stdout + (r.stderr || "");
    expect(output).toContain("dashboard");
  });

  it("includes collected_at timestamp in output", () => {
    const metrics = createSampleMetrics();
    const now = new Date().toISOString();
    metrics.collected_at = now;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Collected:");
  });

  it("includes window_days in output", () => {
    const metrics = createSampleMetrics();
    metrics.window_days = 14;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("14 days");
  });

  it("handles cross-repo metrics", () => {
    const metrics = createSampleMetrics();
    metrics.cross_repo_pr_count = 30;
    metrics.cross_repo_merged_count = 28;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("30");
    expect(r.stdout).toContain("28");
  });

  it("--json output includes all metrics fields", () => {
    const metrics = createSampleMetrics();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark", "--json"]);
    expect(r.status).toBe(0);

    const output = JSON.parse(r.stdout);
    expect(output).toHaveProperty("repo");
    expect(output).toHaveProperty("pr_count");
    expect(output).toHaveProperty("merged_count");
    expect(output).toHaveProperty("decision_count");
    expect(output).toHaveProperty("managed_repos");
  });

  it("rounds percentages to one decimal place", () => {
    const metrics = createSampleMetrics();
    metrics.pr_count = 33;
    metrics.merged_count = 11;
    // 11/33 = 0.3333... -> 33.3%
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("33.3%");
  });

  it("rounds hours to two decimal places", () => {
    const metrics = createSampleMetrics();
    metrics.mean_time_to_merge_hours = 1.234567;
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf8");

    const r = run(["benchmark"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1.23h");
  });
});
