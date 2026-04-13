import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Capture screenshots at multiple viewports using Puppeteer
 * @param {string} url - Vercel preview URL
 * @param {number[]} viewports - Array of viewport widths [375, 768, 1440]
 * @returns {Promise<Object>} - { mobile: Buffer, tablet: Buffer, desktop: Buffer }
 */
export async function captureScreenshots(url, viewports = [375, 768, 1440]) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const screenshots = {};
  const viewportNames = ["mobile", "tablet", "desktop"];

  try {
    for (let i = 0; i < viewports.length; i++) {
      const page = await browser.newPage();
      const width = viewports[i];
      const height = width === 375 ? 667 : width === 768 ? 1024 : 900;

      await page.setViewport({ width, height });
      await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for images to load
      await page.waitForTimeout(2000);

      const screenshot = await page.screenshot({
        fullPage: true,
        type: "png",
      });

      screenshots[viewportNames[i]] = screenshot;
      await page.close();

      console.log(`✓ Captured ${viewportNames[i]} (${width}px)`);
    }

    return screenshots;
  } finally {
    await browser.close();
  }
}

/**
 * Analyze screenshot with Claude Vision API
 * @param {Buffer} imageBuffer - Screenshot buffer
 * @param {string} prompt - Analysis prompt
 * @returns {Promise<Object>} - Claude analysis response
 */
export async function analyzeWithClaude(imageBuffer, prompt) {
  const base64Image = imageBuffer.toString("base64");

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64Image,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

/**
 * Get PR diff and changed files from GitHub
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @returns {Promise<Object>} - { files: [{ filename, patch, additions, deletions }] }
 */
export async function parsePRDiff(owner, repo, prNumber) {
  try {
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      files: files.map((f) => ({
        filename: f.filename,
        patch: f.patch || "",
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
      })),
    };
  } catch (error) {
    console.error("Error fetching PR diff:", error.message);
    throw error;
  }
}

/**
 * Post review comment on PR
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {Object} review - Review object with body and comments
 * @returns {Promise<Object>} - Created comment response
 */
export async function postReviewComment(owner, repo, prNumber, review) {
  try {
    const { data: comment } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: review.body,
    });

    // Post inline suggestions if available
    if (review.suggestions && review.suggestions.length > 0) {
      for (const suggestion of review.suggestions) {
        await octokit.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          body: suggestion.body,
          commit_id: suggestion.commitId,
          path: suggestion.path,
          line: suggestion.line,
        });
      }
    }

    return comment;
  } catch (error) {
    console.error("Error posting review comment:", error.message);
    throw error;
  }
}

/**
 * Send Telegram alert with optional screenshot
 * @param {string} message - Alert message
 * @param {Buffer} [screenshot] - Optional screenshot buffer
 * @param {Object} [options] - { repoName, prNumber, severity }
 * @returns {Promise<void>}
 */
export async function sendTelegramAlert(
  message,
  screenshot = null,
  options = {}
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn(
      "Telegram credentials not configured. Skipping alert:",
      message
    );
    return;
  }

  try {
    const baseUrl = `https://api.telegram.org/bot${botToken}`;

    // Format message with metadata
    const fullMessage = [
      `⚠️ *UI/UX Quality Gate Alert*`,
      `Severity: ${options.severity || "WARNING"}`,
      `Repo: ${options.repoName || "unknown"}`,
      `PR #${options.prNumber || "?"}`,
      `\n${message}`,
    ].join("\n");

    // Send text message
    await fetch(`${baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: fullMessage,
        parse_mode: "Markdown",
      }),
    });

    // Send screenshot if available
    if (screenshot) {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", new Blob([screenshot], { type: "image/png" }));
      formData.append("caption", "Visual issue screenshot");

      await fetch(`${baseUrl}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
    }

    console.log("✓ Telegram alert sent");
  } catch (error) {
    console.error("Error sending Telegram alert:", error.message);
  }
}

/**
 * Load design guidelines for a specific project
 * @param {string} projectKey - Project key from design-guidelines.json
 * @returns {Promise<Object>} - Design guidelines
 */
export async function loadDesignGuidelines(projectKey) {
  try {
    const guidelinesPath = path.join(
      path.dirname(import.meta.url.replace("file://", "")),
      "../config/design-guidelines.json"
    );
    const content = await fs.readFile(guidelinesPath, "utf-8");
    const guidelines = JSON.parse(content);
    return guidelines[projectKey] || null;
  } catch (error) {
    console.error("Error loading design guidelines:", error.message);
    return null;
  }
}

/**
 * Format severity badge for issue display
 * @param {string} severity - 'critical' | 'warning' | 'info'
 * @returns {string} - Formatted badge
 */
export function formatSeverityBadge(severity) {
  const badges = {
    critical: "🔴 CRITICAL",
    warning: "🟡 WARNING",
    info: "🔵 INFO",
  };
  return badges[severity] || severity;
}

/**
 * Calculate composite quality score
 * @param {Object} scores - { layout, typography, spacing, color, accessibility, overall }
 * @returns {number} - Weighted average (0-10)
 */
export function calculateQualityScore(scores) {
  const weights = {
    layout: 0.25,
    typography: 0.15,
    spacing: 0.2,
    color: 0.15,
    accessibility: 0.25,
  };

  let total = 0;
  let weightSum = 0;

  Object.entries(weights).forEach(([key, weight]) => {
    if (scores[key] !== undefined) {
      total += scores[key] * weight;
      weightSum += weight;
    }
  });

  return Math.round((total / weightSum) * 10) / 10;
}

/**
 * Generate PR comment body from review results
 * @param {Object} review - Review results object
 * @returns {string} - Markdown formatted comment
 */
export function generateReviewCommentBody(review) {
  const sections = [];

  sections.push("## UI/UX Quality Review Results\n");

  // Summary
  if (review.summary) {
    sections.push(`${review.summary}\n`);
  }

  // Issues by severity
  if (review.issues && review.issues.length > 0) {
    sections.push("### Issues Found\n");
    const grouped = groupBySeverity(review.issues);

    Object.entries(grouped).forEach(([severity, issues]) => {
      if (issues.length > 0) {
        sections.push(`\n**${formatSeverityBadge(severity)}**`);
        issues.forEach((issue, idx) => {
          sections.push(
            `${idx + 1}. ${issue.title}\n   > ${issue.description}`
          );
          if (issue.suggestion) {
            sections.push(`   **Suggestion:** ${issue.suggestion}`);
          }
        });
      }
    });
  }

  // Scores
  if (review.scores) {
    sections.push("\n### Visual Quality Scores\n");
    Object.entries(review.scores).forEach(([viewport, score]) => {
      const bar = generateScoreBar(score);
      sections.push(`${viewport}: ${bar} ${score}/10`);
    });
  }

  // Recommendation
  if (review.recommendation) {
    sections.push(`\n### Recommendation\n${review.recommendation}`);
  }

  return sections.join("\n");
}

/**
 * Group issues by severity
 * @param {Array} issues - Array of issue objects
 * @returns {Object} - Grouped by severity
 */
function groupBySeverity(issues) {
  return issues.reduce(
    (acc, issue) => {
      const severity = issue.severity || "info";
      if (!acc[severity]) acc[severity] = [];
      acc[severity].push(issue);
      return acc;
    },
    {}
  );
}

/**
 * Generate visual score bar for markdown
 * @param {number} score - Score 0-10
 * @returns {string} - Markdown bar
 */
function generateScoreBar(score) {
  const filled = Math.round(score);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Validate environment variables
 * @throws {Error} If required env vars are missing
 */
export function validateEnvironment() {
  const required = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

export default {
  captureScreenshots,
  analyzeWithClaude,
  parsePRDiff,
  postReviewComment,
  sendTelegramAlert,
  loadDesignGuidelines,
  formatSeverityBadge,
  calculateQualityScore,
  generateReviewCommentBody,
  validateEnvironment,
};
