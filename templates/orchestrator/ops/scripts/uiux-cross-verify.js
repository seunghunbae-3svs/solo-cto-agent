#!/usr/bin/env node

import { performCodeReview } from "./uiux-code-review.js";
import { performVisualReview } from "./uiux-visual-review.js";
import {
  generateReviewCommentBody,
  sendTelegramAlert,
  postReviewComment,
} from "../lib/uiux-utils.js";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Stage 3: Cross-Verification
 * - Runs both Stage 1 (code) and Stage 2 (visual)
 * - Compares findings
 * - Generates unified quality report
 * - Applies labels and creates alerts
 */

async function performCrossVerification(
  owner,
  repo,
  prNumber,
  previewUrl,
  projectKey
) {
  console.log(`\n🔄 [Stage 3] Cross-Verification for ${owner}/${repo}#${prNumber}\n`);

  try {
    // Run both reviews in parallel
    const [codeReview, visualReview] = await Promise.all([
      performCodeReview(owner, repo, prNumber),
      previewUrl
        ? performVisualReview(previewUrl, projectKey, prNumber)
        : { success: false, error: "No preview URL" },
    ]);

    // Cross-reference findings
    const crossRef = crossReferenceFindings(codeReview, visualReview);

    // Generate unified report
    const report = generateUnifiedReport(codeReview, visualReview, crossRef);

    // Determine quality gate decision
    const decision = makeQualityDecision(report);

    console.log("\n✅ Cross-Verification Complete\n");
    console.log(`Decision: ${decision.label}`);
    console.log(`Recommendation: ${decision.recommendation}\n`);

    // Apply GitHub label
    if (decision.shouldLabel) {
      await applyGitHubLabel(owner, repo, prNumber, decision.label);
      console.log(`✓ Applied label: ${decision.label}`);
    }

    // Send alert if critical issues
    if (decision.shouldAlert) {
      const alertMessage = `
${decision.label}
Repo: ${repo}
PR: #${prNumber}
Overall Score: ${report.overallScore}/10

Issues: ${report.totalIssues} (${report.criticalIssues} critical)
Recommendation: ${decision.recommendation}
      `.trim();

      await sendTelegramAlert(alertMessage, null, {
        repoName: repo,
        prNumber,
        severity: decision.shouldAlert ? "CRITICAL" : "WARNING",
      });
    }

    // Post PR comment
    const commentBody = generateCrossVerifyComment(report, decision);
    if (process.env.GITHUB_TOKEN) {
      await postReviewComment(owner, repo, prNumber, {
        body: commentBody,
      });
      console.log("✓ Posted review comment on PR");
    }

    return {
      success: true,
      codeReview,
      visualReview,
      crossRef,
      report,
      decision,
    };
  } catch (error) {
    console.error("❌ Cross-verification failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

function crossReferenceFindings(codeReview, visualReview) {
  const refs = {
    matches: [],
    codeOnlyIssues: [],
    visualOnlyIssues: [],
  };

  if (!codeReview.issues || !visualReview.viewports) {
    return refs;
  }

  // Check for responsive issues flagged in both
  const codeResponsiveIssues = codeReview.issues.filter(
    (i) => i.category === "responsive"
  );
  const visualResponsiveIssues = Object.values(visualReview.viewports).flatMap(
    (v) => v.issues?.filter((i) => i.type === "layout") || []
  );

  if (codeResponsiveIssues.length > 0 && visualResponsiveIssues.length > 0) {
    refs.matches.push({
      category: "responsive design",
      codeIssues: codeResponsiveIssues.length,
      visualIssues: visualResponsiveIssues.length,
      confidence: "high",
    });
  }

  // Spacing issues cross-reference
  const codeSpacingIssues = codeReview.issues.filter(
    (i) => i.category === "design-system"
  );
  const visualSpacingIssues = Object.values(visualReview.viewports).flatMap(
    (v) => v.issues?.filter((i) => i.type === "spacing") || []
  );

  if (codeSpacingIssues.length > 0 && visualSpacingIssues.length > 0) {
    refs.matches.push({
      category: "spacing consistency",
      codeIssues: codeSpacingIssues.length,
      visualIssues: visualSpacingIssues.length,
      confidence: "high",
    });
  }

  // Accessibility cross-reference
  const codeA11yIssues = codeReview.issues.filter(
    (i) => i.category === "accessibility"
  );
  const visualA11yIssues = Object.values(visualReview.viewports).flatMap(
    (v) => v.issues?.filter((i) => i.type === "accessibility") || []
  );

  if (codeA11yIssues.length > 0 && visualA11yIssues.length > 0) {
    refs.matches.push({
      category: "accessibility",
      codeIssues: codeA11yIssues.length,
      visualIssues: visualA11yIssues.length,
      confidence: "high",
    });
  }

  return refs;
}

function generateUnifiedReport(codeReview, visualReview, crossRef) {
  const report = {
    timestamp: new Date().toISOString(),
    codeReviewSuccess: codeReview.success || false,
    visualReviewSuccess: visualReview.success || false,

    // Code review stats
    codeIssues: codeReview.issues || [],
    criticalCode: codeReview.criticalCount || 0,
    warningCode: codeReview.warningCount || 0,

    // Visual review stats
    visualScore: visualReview.overallScore || 0,
    visualIssues: visualReview.issues || [],

    // Cross-reference
    crossRefMatches: crossRef.matches || [],

    // Aggregated
    totalIssues: (codeReview.issues?.length || 0) + (visualReview.issues?.length || 0),
    criticalIssues: (codeReview.criticalCount || 0) +
      (visualReview.issues?.filter((i) => i.severity === "critical").length || 0),
  };

  // Calculate composite score
  const hasCodeIssues = report.codeIssues.length > 0;
  const visualScore = report.visualScore || 7;

  if (!hasCodeIssues && visualScore >= 7) {
    report.overallScore = Math.round(visualScore);
  } else if (!hasCodeIssues && visualScore >= 5) {
    report.overallScore = Math.round(visualScore - 1);
  } else {
    report.overallScore = Math.max(1, Math.round(visualScore - 2));
  }

  return report;
}

function makeQualityDecision(report) {
  const score = report.overallScore;
  const criticalCount = report.criticalIssues;

  // Decision logic
  if (score >= 7 && criticalCount === 0) {
    return {
      label: "uiux-verified",
      recommendation: "✅ Ready to merge - UI/UX quality gate passed",
      shouldLabel: true,
      shouldAlert: false,
      canMerge: true,
    };
  }

  if (score >= 5 && score < 7 && criticalCount === 0) {
    return {
      label: "uiux-minor-issues",
      recommendation:
        "⚠️  Minor issues found. Review suggestions and consider fixes before merge.",
      shouldLabel: true,
      shouldAlert: false,
      canMerge: true,
    };
  }

  return {
    label: "uiux-review-needed",
    recommendation:
      "❌ Critical issues or low score. Rework required before merge.",
    shouldLabel: true,
    shouldAlert: true,
    canMerge: false,
  };
}

async function applyGitHubLabel(owner, repo, prNumber, labelName) {
  try {
    // Ensure label exists
    try {
      await octokit.issues.getLabel({
        owner,
        repo,
        name: labelName,
      });
    } catch {
      // Create label if it doesn't exist
      const colors = {
        "uiux-verified": "28a745",
        "uiux-minor-issues": "ffd700",
        "uiux-review-needed": "d73a49",
      };

      await octokit.issues.createLabel({
        owner,
        repo,
        name: labelName,
        color: colors[labelName] || "808080",
        description: `UI/UX quality gate: ${labelName}`,
      });
    }

    // Apply label to PR
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [labelName],
    });
  } catch (error) {
    console.warn(`Failed to apply label ${labelName}:`, error.message);
  }
}

function generateCrossVerifyComment(report, decision) {
  const sections = [];

  sections.push("## UI/UX Quality Gate — Cross-Verification Report\n");

  // Decision banner
  const banner =
    decision.label === "uiux-verified"
      ? "✅ PASSED"
      : decision.label === "uiux-minor-issues"
        ? "⚠️  MINOR ISSUES"
        : "❌ NEEDS REVIEW";

  sections.push(`**Status:** ${banner}\n`);

  // Overall score
  const scoreBar =
    "█".repeat(Math.round(report.overallScore)) +
    "░".repeat(10 - Math.round(report.overallScore));
  sections.push(`**Overall Score:** ${scoreBar} ${report.overallScore}/10\n`);

  // Code review summary
  if (report.codeReviewSuccess) {
    sections.push("### Code Review (Stage 1)\n");
    if (report.codeIssues.length === 0) {
      sections.push("✓ No code-level UI/UX issues detected\n");
    } else {
      const critical = report.codeIssues.filter((i) => i.severity === "critical").length;
      const warnings = report.codeIssues.filter((i) => i.severity === "warning").length;
      sections.push(`Found ${report.codeIssues.length} issue(s):`);
      if (critical > 0) sections.push(`  • 🔴 ${critical} critical`);
      if (warnings > 0) sections.push(`  • 🟡 ${warnings} warning(s)`);
      sections.push("");
    }
  }

  // Visual review summary
  if (report.visualReviewSuccess) {
    sections.push("### Visual Review (Stage 2)\n");
    sections.push(`**Visual Score:** ${report.visualScore}/10\n`);
    if (report.visualIssues.length > 0) {
      const vCritical = report.visualIssues.filter((i) => i.severity === "critical").length;
      const vWarnings = report.visualIssues.filter((i) => i.severity === "warning").length;
      sections.push(`Found ${report.visualIssues.length} issue(s):`);
      if (vCritical > 0) sections.push(`  • 🔴 ${vCritical} critical`);
      if (vWarnings > 0) sections.push(`  • 🟡 ${vWarnings} warning(s)`);
      sections.push("");
    }
  }

  // Cross-verification insights
  if (report.crossRefMatches.length > 0) {
    sections.push("### Cross-Reference Verification\n");
    sections.push("Code and visual reviews confirmed these issues:");
    report.crossRefMatches.forEach((match) => {
      sections.push(`  • **${match.category}**: ${match.codeIssues} code + ${match.visualIssues} visual`);
    });
    sections.push("");
  }

  // Recommendation
  sections.push(`### Recommendation\n${decision.recommendation}\n`);

  return sections.join("\n");
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let owner = "seunghunbae-3svs";
  let repo = "tribo-store";
  let prNumber = 1;
  let previewUrl = process.env.VERCEL_PREVIEW_URL || "";
  let projectKey = "tribo-store";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--owner") owner = args[++i];
    if (args[i] === "--repo") repo = args[++i];
    if (args[i] === "--pr") prNumber = parseInt(args[++i]);
    if (args[i] === "--url") previewUrl = args[++i];
    if (args[i] === "--project") projectKey = args[++i];
  }

  const result = await performCrossVerification(
    owner,
    repo,
    prNumber,
    previewUrl,
    projectKey
  );
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { performCrossVerification };
