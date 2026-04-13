const fs = require("fs");
const path = require("path");

/**
 * Automatic knowledge article generation from accumulated session data.
 * Detects recurring topics across episodes, context logs, and error patterns.
 * Generates knowledge articles when a topic appears 3+ times.
 *
 * @param {string} projectDir - Project root (contains memory/, CONTEXT_LOG.md, etc.)
 * @param {object} options - Configuration
 * @param {boolean} options.dryRun - (default: true) Show what would be generated
 * @param {number} options.minOccurrences - (default: 3) Min topic count to qualify
 * @param {boolean} options.force - (default: false) Regenerate existing articles
 * @param {boolean} options.verbose - (default: false) Show detailed scan output
 *
 * @returns {Promise<object>} { generated: string[], updated: string[], stats: {...} }
 */
async function generateKnowledge(projectDir, options = {}) {
  const {
    dryRun = true,
    minOccurrences = 3,
    force = false,
    verbose = false,
  } = options;

  console.log("\nsolo-cto-agent knowledge\n");
  console.log("Scanning project memory...");

  const stats = {
    episodesScanned: 0,
    contextLogSessions: 0,
    errorPatternsScanned: 0,
    topicsFound: 0,
    articlesGenerated: 0,
  };

  const result = {
    generated: [],
    updated: [],
    stats: stats,
  };

  // Ensure memory directory exists
  const memoryDir = path.join(projectDir, "memory");
  const episodesDir = path.join(memoryDir, "episodes");
  const knowledgeDir = path.join(memoryDir, "knowledge");
  const indexPath = path.join(memoryDir, "index.md");
  const contextLogPath = path.join(projectDir, "CONTEXT_LOG.md");
  const errorPatternsPath = path.join(projectDir, "error-patterns.md");
  const failureCatalogPath = path.join(projectDir, "failure-catalog.json");

  // Step 1: Scan all sources for topics
  const topicMap = new Map();

  // Scan episodes
  if (fs.existsSync(episodesDir)) {
    const episodes = fs
      .readdirSync(episodesDir)
      .filter((f) => f.endsWith(".md"));
    for (const episode of episodes) {
      const content = fs.readFileSync(path.join(episodesDir, episode), "utf-8");
      extractTopicsFromEpisode(content, episode, topicMap);
      stats.episodesScanned++;
    }
  }

  // Scan CONTEXT_LOG.md
  if (fs.existsSync(contextLogPath)) {
    const content = fs.readFileSync(contextLogPath, "utf-8");
    extractTopicsFromContextLog(content, topicMap);
    stats.contextLogSessions = (content.match(/## Session /g) || []).length;
  }

  // Scan error-patterns.md
  if (fs.existsSync(errorPatternsPath)) {
    const content = fs.readFileSync(errorPatternsPath, "utf-8");
    extractTopicsFromErrorPatterns(content, "markdown", topicMap);
    stats.errorPatternsScanned = (content.match(/^## /gm) || []).length;
  }

  // Scan failure-catalog.json (alternative format)
  if (
    fs.existsSync(failureCatalogPath) &&
    !fs.existsSync(errorPatternsPath)
  ) {
    try {
      const catalog = JSON.parse(
        fs.readFileSync(failureCatalogPath, "utf-8")
      );
      extractTopicsFromErrorPatterns(catalog, "json", topicMap);
      stats.errorPatternsScanned = Object.keys(catalog).length;
    } catch (e) {
      if (verbose) console.warn("  ⚠️  Failed to parse failure-catalog.json");
    }
  }

  // Step 2: Filter topics by minOccurrences
  const qualifyingTopics = Array.from(topicMap.entries())
    .filter(([_, data]) => data.count >= minOccurrences)
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      sources: data.sources,
      excerpts: data.excerpts,
    }))
    .sort((a, b) => b.count - a.count);

  stats.topicsFound = qualifyingTopics.length;

  // Step 3: Print dry-run output
  if (qualifyingTopics.length === 0) {
    console.log("  No qualifying topics found (minimum: " + minOccurrences + " occurrences)");
    return result;
  }

  console.log(
    `  Episodes: ${stats.episodesScanned} files scanned`
  );
  if (stats.contextLogSessions > 0)
    console.log(`  Context log: ${stats.contextLogSessions} sessions found`);
  if (stats.errorPatternsScanned > 0)
    console.log(`  Error patterns: ${stats.errorPatternsScanned} patterns found`);

  console.log(
    `\nQualifying topics (${minOccurrences}+ occurrences):`
  );

  for (let i = 0; i < qualifyingTopics.length; i++) {
    const { topic, count, sources } = qualifyingTopics[i];
    const sourceList = Object.entries(sources)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ");
    console.log(
      `  ${i + 1}. ${topic} (${count} hits) — from: ${sourceList}`
    );
    console.log(
      `     → Would generate: memory/knowledge/${topic}.md`
    );
  }

  if (dryRun) {
    console.log(
      `\n${qualifyingTopics.length} articles would be generated. Run with --apply to write.`
    );
    result.stats.articlesGenerated = qualifyingTopics.length;
    return result;
  }

  // Step 4: Generate articles and update index
  console.log("\nGenerating articles...");

  // Ensure knowledge directory exists
  if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
  }

  const existingArticles = new Set(
    fs.existsSync(knowledgeDir)
      ? fs.readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"))
      : []
  );

  for (const { topic, excerpts, count } of qualifyingTopics) {
    const articlePath = path.join(knowledgeDir, `${topic}.md`);
    const exists = existingArticles.has(`${topic}.md`);

    if (exists && !force) {
      if (verbose) console.log(`  ⊘ Skipped (exists): ${topic}`);
      continue;
    }

    const article = generateArticle(topic, excerpts, count);
    fs.writeFileSync(articlePath, article, "utf-8");
    result.generated.push(topic);
    console.log(`  ✅ Generated: memory/knowledge/${topic}.md`);
  }

  // Step 5: Update index.md
  if (result.generated.length > 0) {
    updateIndex(indexPath, result.generated);
    result.updated.push("index.md");
    console.log(
      `  ✅ Updated: memory/index.md (+${result.generated.length} articles)`
    );
  }

  result.stats.articlesGenerated = result.generated.length;
  console.log("");

  return result;
}

/**
 * Extract topics from a single episode file
 * Strategy: headings, bold terms, pattern/decision/error lines
 */
function extractTopicsFromEpisode(content, fileName, topicMap) {
  // Extract headings (## Topic)
  const headings = content.match(/^## (.+?)$/gm) || [];
  for (const heading of headings) {
    const topic = heading
      .replace(/^## /, "")
      .trim()
      .toLowerCase()
      .replace(/[^\w\-]/g, "-")
      .replace(/-+/g, "-");
    if (topic) addTopic(topicMap, topic, fileName, heading.substring(0, 60));
  }

  // Extract lines with pattern/decision/error/fix keywords
  const patternLines = content.match(/^[*\-\s]*(?:Pattern|Decision|Error|Fix|Issue):\s*(.+?)$/gim) || [];
  for (const line of patternLines) {
    const match = line.match(/:\s*(.+?)$/i);
    if (match) {
      const term = match[1]
        .trim()
        .toLowerCase()
        .replace(/[^\w\-]/g, "-")
        .replace(/-+/g, "-");
      if (term.length > 2) addTopic(topicMap, term, fileName, line.substring(0, 60));
    }
  }

  // Extract bold terms (**term**)
  const boldTerms = content.match(/\*\*([^*]+)\*\*/g) || [];
  for (const bold of boldTerms) {
    const term = bold
      .replace(/\*\*/g, "")
      .toLowerCase()
      .replace(/[^\w\-\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    if (term.length > 3 && term.length < 40) {
      addTopic(topicMap, term, fileName, bold.substring(0, 60));
    }
  }
}

/**
 * Extract topics from CONTEXT_LOG.md
 * Strategy: session blocks, decision sections, risk keywords
 */
function extractTopicsFromContextLog(content, topicMap) {
  // Extract session decision blocks
  const sessionBlocks = content.split(/## Session /);
  for (const block of sessionBlocks) {
    // Look for "### Decisions" or "## Decision" sections
    const decisions = block.match(/^(?:###|##) (?:Decisions?|결정).+?(?=^##|$)/gms) || [];
    for (const decision of decisions) {
      const lines = decision.split("\n").slice(1); // Skip heading
      for (const line of lines) {
        const match = line.match(/[-*]\s*(.+?)(?:\s*—|$)/);
        if (match) {
          const term = match[1]
            .trim()
            .toLowerCase()
            .replace(/[^\w\-]/g, "-")
            .replace(/-+/g, "-");
          if (term.length > 3) {
            addTopic(topicMap, term, "CONTEXT_LOG", line.substring(0, 60));
          }
        }
      }
    }

    // Look for risk keywords
    const risks = block.match(/risk|issue|blocker|critical/gi) || [];
    if (risks.length > 0) {
      addTopic(topicMap, "risk-management", "CONTEXT_LOG", "From risk analysis");
    }
  }
}

/**
 * Extract topics from error-patterns.md or failure-catalog.json
 */
function extractTopicsFromErrorPatterns(source, format, topicMap) {
  if (format === "markdown") {
    // Extract ## Pattern: Name sections
    const patterns = source.match(/^## (?:Pattern|Error):\s*(.+?)$/gim) || [];
    for (const pattern of patterns) {
      const match = pattern.match(/:\s*(.+?)$/i);
      if (match) {
        const term = match[1]
          .trim()
          .toLowerCase()
          .replace(/[^\w\-]/g, "-")
          .replace(/-+/g, "-");
        if (term) addTopic(topicMap, term, "error-patterns", pattern.substring(0, 60));
      }
    }

    // Extract trigger/fix keywords
    const triggers = source.match(/Trigger:|Symptom:|Fix:/gi) || [];
    if (triggers.length > 2) {
      addTopic(topicMap, "error-handling", "error-patterns", "Multiple error patterns");
    }
  } else if (format === "json") {
    // source is already parsed catalog object
    for (const [key, value] of Object.entries(source)) {
      const term = key
        .toLowerCase()
        .replace(/[^\w\-]/g, "-")
        .replace(/-+/g, "-");
      if (term) addTopic(topicMap, term, "failure-catalog", `Pattern: ${key}`);

      // Extract nested keywords from description
      if (value.description) {
        const desc = value.description.toLowerCase();
        const keywords = desc.match(/\b([a-z\-]{4,20})\b/g) || [];
        for (const kw of keywords) {
          if (!isCommonWord(kw)) {
            addTopic(topicMap, kw, "failure-catalog", `From: ${key}`);
          }
        }
      }
    }
  }
}

/**
 * Add or increment topic in the map
 */
function addTopic(topicMap, topic, source, excerpt) {
  // Normalize and validate
  topic = topic.trim().toLowerCase();
  if (topic.length < 2 || topic.length > 50) return;
  if (isCommonWord(topic)) return;

  if (!topicMap.has(topic)) {
    topicMap.set(topic, {
      count: 0,
      sources: {},
      excerpts: [],
    });
  }

  const data = topicMap.get(topic);
  data.count++;
  data.sources[source] = (data.sources[source] || 0) + 1;
  if (data.excerpts.length < 3) data.excerpts.push(excerpt);
}

/**
 * Check if term is a common word (not a signal)
 */
function isCommonWord(word) {
  const common = new Set([
    "the",
    "and",
    "that",
    "this",
    "with",
    "from",
    "have",
    "been",
    "were",
    "when",
    "will",
    "would",
    "could",
    "should",
    "about",
    "after",
    "before",
    "during",
    "under",
    "over",
    "also",
    "more",
    "most",
    "very",
    "just",
    "only",
    "then",
    "now",
    "here",
    "there",
    "where",
    "which",
    "what",
    "who",
    "how",
    "why",
    "all",
    "each",
    "every",
    "some",
    "any",
    "one",
    "two",
    "first",
    "next",
    "last",
  ]);
  return common.has(word) || word.match(/^\d+$/) || word.length < 3;
}

/**
 * Generate a knowledge article from topic data
 */
function generateArticle(topic, excerpts, count) {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const titleCase = topic
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const article = `# ${titleCase}

## Summary
This topic has appeared ${count} times across project history, indicating a recurrent need or pattern. Auto-generated from accumulated session data.

## When This Applies
This knowledge applies when working on scenarios related to **${topic}**. Review the examples below to determine relevance to your current task.

## Why It Matters
Consolidating repeated solutions and patterns prevents re-solving the same problem and reduces friction in future sessions.

## Examples
${
  excerpts.length > 0
    ? excerpts
        .map(
          (ex, i) =>
            `${i + 1}. ${ex.replace(/[#*]/g, "").trim()}`
        )
        .join("\n")
    : "Examples will be populated from session history."
}

## How to Handle
When this topic arises:
1. Check the examples above first
2. Reference relevant session logs in \`CONTEXT_LOG.md\` or \`memory/episodes/\`
3. Update this article with new findings if the solution differs

## Exceptions
Check \`error-patterns.md\` or \`CONTEXT_LOG.md\` for edge cases not covered here.

## Last Updated
${dateStr}
`;

  return article;
}

/**
 * Update index.md to include newly generated articles
 */
function updateIndex(indexPath, generatedTopics) {
  let content = "";
  if (fs.existsSync(indexPath)) {
    content = fs.readFileSync(indexPath, "utf-8");
  }

  // Ensure "Knowledge Articles" section exists
  if (!content.includes("## Knowledge Articles")) {
    const marker = "## Episodes\n";
    if (content.includes(marker)) {
      content = content.replace(marker, "## Knowledge Articles\n\n## Episodes\n");
    } else {
      content += "\n## Knowledge Articles\n";
    }
  }

  // Add new articles to the index
  const knowledgeSection = content.indexOf("## Knowledge Articles");
  const nextSection = content.indexOf("\n##", knowledgeSection + 1);
  const insertPoint =
    nextSection !== -1
      ? nextSection
      : content.length;

  const listItems = generatedTopics
    .map((topic) => `- [\`${topic}.md\`](./knowledge/${topic}.md)`)
    .join("\n");

  const beforeSection = content.substring(0, knowledgeSection);
  const sectionContent = content.substring(
    knowledgeSection,
    knowledgeSection + 30
  );
  const afterSection = content.substring(insertPoint);

  const updated =
    beforeSection +
    sectionContent +
    "\n" +
    listItems +
    "\n" +
    afterSection;

  fs.writeFileSync(indexPath, updated, "utf-8");
}

module.exports = { generateKnowledge };
