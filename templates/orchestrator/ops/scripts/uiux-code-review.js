#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs/promises";
import * as path from "path";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Stage 1: Code-Level UI/UX Review
 * Analyzes PR diff for:
 * - Component structure quality
 * - Styling consistency
 * - Responsive design patterns
 * - Accessibility basics
 * - Design system adherence
 * - AI Slop detection
 */

async function performCodeReview(owner, repo, prNumber) {
  console.log(
    `\n📋 [Stage 1] Code-Level UI/UX Review for ${owner}/${repo}#${prNumber}\n`
  );

  try {
    // Fetch PR diff
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Filter for UI-relevant files
    const uiFiles = files.filter((f) =>
      /\.(tsx?|jsx?|css|tailwind)$/.test(f.filename)
    );

    if (uiFiles.length === 0) {
      console.log("✓ No UI-relevant files in this PR");
      return {
        success: true,
        issues: [],
        summary: "No UI code changes detected",
      };
    }

    console.log(`Found ${uiFiles.length} UI-related files\n`);

    // Prepare diff content for analysis
    const diffContent = uiFiles
      .map((f) => {
        const patch = f.patch || "";
        return `\n## File: ${f.filename}\nStatus: ${f.status}\n\`\`\`diff\n${patch.substring(0, 2000)}\n\`\`\``;
      })
      .join("\n");

    // Send to Claude for review
    const reviewPrompt = `You are a UI/UX expert reviewer for a frontend project. Analyze the following code changes and identify issues in:

1. **Component Structure**: Are components properly decomposed? Any god components?
2. **Styling Consistency**: Is Tailwind being used consistently? Any inline styles mixed in?
3. **Responsive Design**: Are mobile-first patterns followed? Correct breakpoint usage?
4. **Accessibility**: Missing aria labels? Semantic HTML? Color contrast considerations?
5. **Design System**: Consistent spacing scale? Color tokens? Font sizes?
6. **AI Slop Detection**: Generic placeholder text? Meaningless icons? Gratuitous gradients? Stock photo patterns?

Categorize findings by severity: critical (breaks UX), warning (should fix), info (nice to have).

Return JSON:
{
  "issues": [
    {
      "file": "path/to/file",
      "severity": "critical|warning|info",
      "category": "structure|styling|responsive|accessibility|design-system|ai-slop",
      "title": "Issue title",
      "description": "Detailed description",
      "suggestion": "How to fix it",
      "location": "line number or component name"
    }
  ],
  "summary": "Overall assessment",
  "criticalCount": 0,
  "warningCount": 0,
  "infoCount": 0
}

Code changes to review:
${diffContent}`;

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: reviewPrompt,
        },
      ],
    });

    const reviewText = response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
    let review = {
      issues: [],
      summary: reviewText,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    };

    if (jsonMatch) {
      try {
        review = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.warn("Failed to parse review JSON, using raw text");
      }
    }

    // Display results
    displayCodeReviewResults(review);

    return {
      success: true,
      ...review,
    };
  } catch (error) {
    console.error("❌ Code review failed:", error.message);
    return {
      success: false,
      error: error.message,
      issues: [],
    };
  }
}

function displayCodeReviewResults(review) {
  console.log("📊 Review Results:\n");
  console.log(`Summary: ${review.summary || "N/A"}\n`);

  if (review.issues && review.issues.length > 0) {
    console.log(`Found ${review.issues.length} issues:\n`);

    const bySeverity = {
      critical: review.issues.filter((i) => i.severity === "critical"),
      warning: review.issues.filter((i) => i.severity === "warning"),
      info: review.issues.filter((i) => i.severity === "info"),
    };

    Object.entries(bySeverity).forEach(([severity, issues]) => {
      if (issues.length > 0) {
        const badge =
          severity === "critical"
            ? "🔴"
            : severity === "warning"
              ? "🟡"
              : "🔵";
        console.log(`${badge} ${severity.toUpperCase()} (${issues.length})`);
        issues.forEach((issue) => {
          console.log(
            `  • [${issue.category}] ${issue.title} (${issue.file}:${issue.location})`
          );
          console.log(`    Description: ${issue.description}`);
          if (issue.suggestion) {
            console.log(`    Fix: ${issue.suggestion}`);
          }
        });
        console.log();
      }
    });
  } else {
    console.log("✓ No critical issues found!\n");
  }

  console.log(
    `Summary: ${review.criticalCount || 0} critical, ${review.warningCount || 0} warnings, ${review.infoCount || 0} info\n`
  );
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let owner = "{{GITHUB_OWNER}}";
  let repo = "{{PRODUCT_REPO_1}}";
  let prNumber = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--owner") owner = args[++i];
    if (args[i] === "--repo") repo = args[++i];
    if (args[i] === "--pr") prNumber = parseInt(args[++i]);
  }

  const result = await performCodeReview(owner, repo, prNumber);
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { performCodeReview };
