#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Stage 4: Auto-Improvement Suggestions
 * - Generate specific code fix suggestions
 * - Post as PR review comments with inline suggestions
 * - For critical issues, trigger rework-agent
 */

async function generateFixSuggestions(
  owner,
  repo,
  prNumber,
  issues,
  codeContext
) {
  console.log(
    `\n💡 [Stage 4] Auto-Improvement Suggestions for ${owner}/${repo}#${prNumber}\n`
  );

  try {
    if (!issues || issues.length === 0) {
      console.log("✓ No issues to fix");
      return { success: true, suggestions: [] };
    }

    const suggestions = [];

    // Group issues by file
    const issuesByFile = groupIssuesByFile(issues);

    // Generate fixes for each file
    for (const [file, fileIssues] of Object.entries(issuesByFile)) {
      console.log(`\n📝 Generating fixes for ${file}...`);

      const fixPrompt = `You are a frontend expert. Generate specific fix suggestions for these UI/UX issues:

File: ${file}
Issues:
${fileIssues.map((i) => `- [${i.severity}] ${i.title}: ${i.description}\n  Location: ${i.location}`).join("\n")}

For EACH issue, provide:
1. Root cause explanation
2. Specific code fix (show exact Tailwind classes or React changes)
3. Why this fix improves UX

Format as JSON:
{
  "fixes": [
    {
      "issueTitle": "...",
      "severity": "critical|warning|info",
      "rootCause": "...",
      "fixCode": "...",
      "explanation": "...",
      "tailwindClasses": ["class1", "class2"],
      "isAutoFixable": true/false
    }
  ]
}

Context: ${codeContext?.[file] || "No context available"}
`;

      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2500,
        messages: [
          {
            role: "user",
            content: fixPrompt,
          },
        ],
      });

      const responseText =
        response.content[0].type === "text" ? response.content[0].text : "";

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          parsed.fixes.forEach((fix) => {
            suggestions.push({
              file,
              ...fix,
            });
          });
        }
      } catch (e) {
        console.warn(`Failed to parse fix suggestions for ${file}`);
      }
    }

    // Display suggestions
    displayFixSuggestions(suggestions);

    // Post inline review comments
    if (process.env.GITHUB_TOKEN) {
      await postFixSuggestionComments(owner, repo, prNumber, suggestions);
    }

    return {
      success: true,
      suggestions,
      totalSuggestions: suggestions.length,
      autoFixable: suggestions.filter((s) => s.isAutoFixable).length,
    };
  } catch (error) {
    console.error("❌ Fix suggestion generation failed:", error.message);
    return {
      success: false,
      error: error.message,
      suggestions: [],
    };
  }
}

function groupIssuesByFile(issues) {
  return issues.reduce(
    (acc, issue) => {
      const file = issue.file || "unknown";
      if (!acc[file]) acc[file] = [];
      acc[file].push(issue);
      return acc;
    },
    {}
  );
}

function displayFixSuggestions(suggestions) {
  console.log("\n\n📋 FIX SUGGESTIONS SUMMARY\n");

  const autoFixable = suggestions.filter((s) => s.isAutoFixable).length;
  const manual = suggestions.length - autoFixable;

  console.log(`Total: ${suggestions.length} suggestions`);
  console.log(`  Auto-fixable: ${autoFixable}`);
  console.log(`  Manual review needed: ${manual}\n`);

  suggestions.forEach((suggestion, idx) => {
    const icon = suggestion.isAutoFixable ? "✅" : "📝";
    const severity = suggestion.severity === "critical" ? "🔴" : "🟡";

    console.log(`\n${idx + 1}. ${icon} ${suggestion.issueTitle}`);
    console.log(`   ${severity} ${suggestion.severity}`);
    console.log(`   File: ${suggestion.file}`);
    console.log(`   Root Cause: ${suggestion.rootCause}`);

    if (suggestion.tailwindClasses && suggestion.tailwindClasses.length > 0) {
      console.log(`   Tailwind Classes: ${suggestion.tailwindClasses.join(", ")}`);
    }

    console.log(`   Explanation: ${suggestion.explanation}`);
  });
}

async function postFixSuggestionComments(
  owner,
  repo,
  prNumber,
  suggestions
) {
  try {
    // Get PR details to find commit ID
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const commitId = pr.head.sha;

    // Group suggestions by severity and create summary comment
    const critical = suggestions.filter((s) => s.severity === "critical");
    const warnings = suggestions.filter((s) => s.severity === "warning");

    if (critical.length > 0 || warnings.length > 0) {
      const summaryBody = generateFixSummaryComment(
        critical,
        warnings,
        suggestions
      );

      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: summaryBody,
      });

      console.log("\n✓ Posted fix suggestion summary comment");
    }

    // Post individual inline comments for critical issues
    for (const suggestion of critical) {
      try {
        // Try to extract line number from issue location
        const lineMatch = suggestion.location?.match(/line (\d+)/);
        const line = lineMatch ? parseInt(lineMatch[1]) : null;

        if (line) {
          // Get file content to understand context
          const { data: file } = await octokit.repos.getContent({
            owner,
            repo,
            path: suggestion.file,
            ref: commitId,
          });

          const fileContent = Buffer.from(
            file.content,
            "base64"
          ).toString();
          const lines = fileContent.split("\n");

          // Post review comment
          if (line <= lines.length) {
            await octokit.pulls.createReviewComment({
              owner,
              repo,
              pull_number: prNumber,
              commit_id: commitId,
              path: suggestion.file,
              line,
              body: `🔴 **CRITICAL: ${suggestion.issueTitle}**\n\n${suggestion.fixCode || suggestion.explanation}`,
            });
          }
        }
      } catch (e) {
        console.warn(
          `Could not post inline comment for ${suggestion.issueTitle}: ${e.message}`
        );
      }
    }

    return true;
  } catch (error) {
    console.warn("Failed to post fix suggestion comments:", error.message);
    return false;
  }
}

function generateFixSummaryComment(critical, warnings, allSuggestions) {
  const sections = [];

  sections.push("## 💡 Suggested UI/UX Improvements\n");

  if (critical.length > 0) {
    sections.push(`### 🔴 Critical Fixes (${critical.length})\n`);
    critical.forEach((fix) => {
      sections.push(
        `**${fix.issueTitle}**\n\`\`\`\n${fix.fixCode}\n\`\`\`\n${fix.explanation}\n`
      );
    });
  }

  if (warnings.length > 0) {
    sections.push(`\n### 🟡 Recommended Improvements (${warnings.length})\n`);
    warnings.forEach((fix) => {
      sections.push(`- **${fix.issueTitle}**: ${fix.explanation}`);
    });
  }

  const autoFixable = allSuggestions.filter((s) => s.isAutoFixable).length;
  if (autoFixable > 0) {
    sections.push(
      `\n> 💡 **Tip:** ${autoFixable} of these fixes can be auto-applied. Ask maintainer to run \`npm run fix-uiux\`.`
    );
  }

  return sections.join("\n");
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let owner = "seunghunbae-3svs";
  let repo = "tribo-store";
  let prNumber = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--owner") owner = args[++i];
    if (args[i] === "--repo") repo = args[++i];
    if (args[i] === "--pr") prNumber = parseInt(args[++i]);
  }

  // Mock issues for testing
  const mockIssues = [
    {
      file: "src/components/ProductCard.tsx",
      severity: "critical",
      title: "Missing aria-label on product image",
      description: "Product images need alt text for accessibility",
      location: "line 15",
      suggestion: "Add alt text",
    },
  ];

  const result = await generateFixSuggestions(
    owner,
    repo,
    prNumber,
    mockIssues,
    {}
  );
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { generateFixSuggestions };
