/**
 * self-evolve.js — Public API for the self-evolve engine.
 *
 * Provides a single entry point for all self-evolve functionality:
 *   - Error pattern collection & tracking
 *   - Quality analysis & scoring
 *   - Skill auto-improvement (3-strike rule)
 *   - User feedback collection (L1) & pattern detection (L2)
 *   - Weekly report generation
 *   - External trends scanning (L3)
 *   - Skill scouting & compatibility checking
 *
 * Usage from CLI:
 *   solo-cto-agent self-evolve status
 *   solo-cto-agent self-evolve init
 *   solo-cto-agent self-evolve error --skill <name> --symptom <text> [--category build] [--cause text] [--fix text]
 *   solo-cto-agent self-evolve quality --type code --skill <name> --checks "build:pass,ts:warn"
 *   solo-cto-agent self-evolve feedback --skill <name> --score 4 [--task text] [--reason text]
 *   solo-cto-agent self-evolve improve --check | --apply
 *   solo-cto-agent self-evolve report [--weeks 1]
 *   solo-cto-agent self-evolve trends [--npm-dir /path]
 *   solo-cto-agent self-evolve scout --installed | --evaluate <name>
 *
 * Usage as module:
 *   const selfEvolve = require('./self-evolve');
 *   selfEvolve.collectError(projectDir, { skill, category, symptom, cause, fix });
 *   selfEvolve.analyzeQuality(projectDir, { type, skill, checks });
 *   selfEvolve.recordFeedback(projectDir, { skill, score, task, reason });
 *   selfEvolve.getStatus(projectDir);
 */

const path = require("path");

// ── Lazy-load sub-modules ──
// This way, missing files don't crash the entire CLI.

function load(name) {
  try {
    return require(`./self-evolve/${name}`);
  } catch (e) {
    return null;
  }
}

const errorCollector = load("error-collector");
const qualityAnalyzer = load("quality-analyzer");
const skillImprover = load("skill-improver");
const feedbackCollector = load("feedback-collector");
const weeklyReport = load("weekly-report");
const skillScout = load("skill-scout");
const externalTrends = load("external-trends");
const orchestrator = load("self-evolve-orchestrator");

// ── Re-export all public APIs ──

module.exports = {
  // Error collection
  collectError: errorCollector ? errorCollector.collectError : null,
  getTopErrors: errorCollector ? errorCollector.getTopErrors : null,
  getImprovementTriggers: errorCollector ? errorCollector.getImprovementTriggers : null,
  readErrorPatterns: errorCollector ? errorCollector.readErrorPatterns : null,

  // Quality analysis
  analyzeQuality: qualityAnalyzer ? qualityAnalyzer.analyzeQuality : null,
  getQualityTrend: qualityAnalyzer ? qualityAnalyzer.getQualityTrend : null,
  getWarnFailPatterns: qualityAnalyzer ? qualityAnalyzer.getWarnFailPatterns : null,
  DEFAULT_CHECKLISTS: qualityAnalyzer ? qualityAnalyzer.DEFAULT_CHECKLISTS : {},

  // Skill improvement
  checkTriggers: skillImprover ? skillImprover.checkTriggers : null,
  applyImprovement: skillImprover ? skillImprover.applyImprovement : null,
  logChange: skillImprover ? skillImprover.logChange : null,

  // Feedback (L1/L2)
  recordSatisfaction: feedbackCollector ? feedbackCollector.recordFeedback : null,
  getLowScorePatterns: feedbackCollector ? feedbackCollector.getLowScorePatterns : null,
  getFeedbackSummary: feedbackCollector ? feedbackCollector.getFeedbackSummary : null,
  generateFeedbackPrompt: feedbackCollector ? feedbackCollector.generateFeedbackPrompt : null,

  // Weekly report
  generateWeeklyReport: weeklyReport ? weeklyReport.generateWeeklyReport : null,

  // Skill scouting
  getInstalledSkills: skillScout ? skillScout.getInstalledSkills : null,
  evaluateSkill: skillScout ? skillScout.evaluateSkill : null,
  findConflict: skillScout ? skillScout.findConflict : null,
  checkCompatibility: skillScout ? skillScout.checkCompatibility : null,

  // External trends (L3)
  checkNpmOutdated: externalTrends ? externalTrends.checkNpmOutdated : null,
  parseGitHubTrending: externalTrends ? externalTrends.parseGitHubTrending : null,
  generateTrendsReport: externalTrends ? externalTrends.generateTrendsReport : null,

  // Orchestrator
  runPostTask: orchestrator ? orchestrator.runPostTask : null,
  runSessionEnd: orchestrator ? orchestrator.runSessionEnd : null,
  runWeekly: orchestrator ? orchestrator.runWeekly : null,
  runFull: orchestrator ? orchestrator.runFull : null,
  getStatus: orchestrator ? orchestrator.getStatus : null,
  initializeDataFiles: orchestrator ? orchestrator.initializeDataFiles : null,
};
