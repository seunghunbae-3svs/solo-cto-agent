#!/usr/bin/env node

import {
  captureScreenshots,
  analyzeWithClaude,
  loadDesignGuidelines,
} from "../lib/uiux-utils.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Stage 2: Visual UI/UX Review
 * After Vercel preview deployment:
 * - Capture screenshots at multiple viewports
 * - Use Claude Vision to analyze
 * - Score layout, typography, spacing, color, a11y
 */

async function performVisualReview(previewUrl, projectKey, prNumber) {
  console.log(
    `\n👁️  [Stage 2] Visual UI/UX Review for ${projectKey} (PR #${prNumber})\n`
  );

  try {
    // Load design guidelines
    const guidelines = await loadDesignGuidelines(projectKey);
    if (!guidelines) {
      console.warn(`⚠️  No design guidelines found for ${projectKey}`);
    }

    const viewports = guidelines?.viewports || [375, 768, 1440];
    const viewportNames = ["mobile", "tablet", "desktop"];

    // Capture screenshots
    console.log("📸 Capturing screenshots...");
    const screenshots = await captureScreenshots(previewUrl, viewports);

    const results = {
      projectKey,
      prNumber,
      previewUrl,
      screenshotTimestamp: new Date().toISOString(),
      viewports: {},
      overallScore: 0,
      issues: [],
    };

    // Analyze each viewport
    for (const [viewport, buffer] of Object.entries(screenshots)) {
      console.log(`\n🔍 Analyzing ${viewport} view...`);

      const analysisPrompt = `You are a UI/UX expert. Analyze this ${viewport} screenshot for a web application.

Project: ${projectKey}
Design theme: ${guidelines?.theme || "Standard"}
Primary colors: ${guidelines?.primaryColor || "Not specified"}

Evaluate these dimensions (0-10 scale):
1. **Layout Balance** - visual hierarchy, spacing, alignment
2. **Typography** - font sizes, weights, readability
3. **Spacing** - padding, margins, whitespace consistency
4. **Color Harmony** - contrast, color usage, accessibility
5. **Accessibility** - button sizes (48px+?), color contrast, semantic structure
6. **Overall Polish** - professional appearance, no AI slop, authentic design

Return JSON:
{
  "viewport": "${viewport}",
  "scores": {
    "layout": 0-10,
    "typography": 0-10,
    "spacing": 0-10,
    "color": 0-10,
    "accessibility": 0-10,
    "polish": 0-10
  },
  "issues": [
    {
      "type": "layout|typography|spacing|color|accessibility|polish",
      "severity": "critical|warning|info",
      "description": "Issue description",
      "location": "Area of screen (e.g., 'header', 'product card', 'checkout button')",
      "suggestion": "How to fix"
    }
  ],
  "strengths": ["positive observation 1", "positive observation 2"],
  "suggestions": ["improvement 1", "improvement 2"]
}`;

      const analysis = await analyzeWithClaude(buffer, analysisPrompt);

      try {
        const parsed = JSON.parse(analysis);
        results.viewports[viewport] = parsed;

        // Calculate average score for this viewport
        const scores = Object.values(parsed.scores);
        const avgScore =
          scores.reduce((a, b) => a + b, 0) / scores.length || 0;
        parsed.averageScore = Math.round(avgScore * 10) / 10;

        // Display results
        console.log(`  ${viewport.toUpperCase()}: ${parsed.averageScore}/10`);
        if (parsed.issues && parsed.issues.length > 0) {
          console.log(`  Issues: ${parsed.issues.length}`);
        }
      } catch (e) {
        console.warn(`Failed to parse analysis for ${viewport}:`, e.message);
        results.viewports[viewport] = { raw: analysis };
      }
    }

    // Calculate overall score
    const allAverages = Object.values(results.viewports)
      .filter((v) => v.averageScore !== undefined)
      .map((v) => v.averageScore);

    if (allAverages.length > 0) {
      results.overallScore = Math.round((allAverages.reduce((a, b) => a + b, 0) / allAverages.length) * 10) / 10;
    }

    // Aggregate issues
    Object.values(results.viewports).forEach((viewport) => {
      if (viewport.issues && Array.isArray(viewport.issues)) {
        results.issues.push(...viewport.issues);
      }
    });

    // Display summary
    displayVisualReviewResults(results);

    return {
      success: true,
      ...results,
    };
  } catch (error) {
    console.error("❌ Visual review failed:", error.message);
    return {
      success: false,
      error: error.message,
      projectKey,
      prNumber,
    };
  }
}

function displayVisualReviewResults(results) {
  console.log("\n\n📊 VISUAL REVIEW SUMMARY\n");
  console.log(`Project: ${results.projectKey}`);
  console.log(`PR: #${results.prNumber}`);
  console.log(`Overall Score: ${results.overallScore}/10\n`);

  console.log("Viewport Scores:");
  Object.entries(results.viewports).forEach(([viewport, data]) => {
    if (data.averageScore !== undefined) {
      const bar =
        "█".repeat(Math.round(data.averageScore)) +
        "░".repeat(10 - Math.round(data.averageScore));
      console.log(`  ${viewport.padEnd(10)} ${bar} ${data.averageScore}/10`);
    }
  });

  if (results.issues && results.issues.length > 0) {
    console.log(`\n⚠️  Found ${results.issues.length} issues`);
    const critical = results.issues.filter(
      (i) => i.severity === "critical"
    ).length;
    const warning = results.issues.filter(
      (i) => i.severity === "warning"
    ).length;
    const info = results.issues.filter(
      (i) => i.severity === "info"
    ).length;

    if (critical > 0) console.log(`  🔴 Critical: ${critical}`);
    if (warning > 0) console.log(`  🟡 Warning: ${warning}`);
    if (info > 0) console.log(`  🔵 Info: ${info}`);
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let previewUrl = process.env.VERCEL_PREVIEW_URL || "";
  let projectKey = "{{PRODUCT_REPO_1}}";
  let prNumber = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url") previewUrl = args[++i];
    if (args[i] === "--project") projectKey = args[++i];
    if (args[i] === "--pr") prNumber = parseInt(args[++i]);
  }

  if (!previewUrl) {
    console.error("Error: --url argument required (Vercel preview URL)");
    process.exit(1);
  }

  const result = await performVisualReview(previewUrl, projectKey, prNumber);
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { performVisualReview };
