#!/usr/bin/env node

/**
 * review.js — Local Multi-Agent Code Review Runner
 *
 * Purpose: Run code reviews without GitHub Actions on a local machine.
 * Export: async function reviewCommand(options)
 *
 * Usage:
 *   solo-cto-agent review [--path .] [--agent claude] [--diff HEAD~1] [--dry-run] [--api-key $KEY]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// ============================================================================
// 1. COLLECT DIFF
// ============================================================================

function collectDiff(options = {}) {
  const { diff = 'HEAD~1..HEAD', path: targetPath = '.' } = options;

  try {
    // Verify git repo
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch {
    throw new Error('Not a git repository. Initialize with `git init` first.');
  }

  let cmd = `git diff ${diff}`;
  if (targetPath !== '.') {
    cmd += ` -- ${targetPath}`;
  }

  let diffOutput;
  try {
    diffOutput = execSync(cmd, { encoding: 'utf-8' });
  } catch (error) {
    throw new Error(`Failed to get diff: ${error.message}`);
  }

  if (!diffOutput.trim()) {
    return { files: [], stats: { totalFiles: 0, addedLines: 0, removedLines: 0 }, raw: '' };
  }

  // Parse diff into files
  const files = [];
  const fileRegex = /^diff --git a\/(.*?) b\/(.*?)$/gm;
  const hunks = diffOutput.split(/^diff --git/m).slice(1);

  let totalAdded = 0;
  let totalRemoved = 0;

  hunks.forEach((hunk, idx) => {
    const fullHunk = (idx === 0 ? 'diff --git' : 'diff --git') + hunk;
    const nameMatch = fullHunk.match(/a\/(.*?) b\/(.*)$/m);
    if (!nameMatch) return;

    const fileName = nameMatch[1];
    const additions = (fullHunk.match(/^\+(?!\+\+)/gm) || []).length;
    const deletions = (fullHunk.match(/^\-(?!\-\-)/gm) || []).length;

    totalAdded += additions;
    totalRemoved += deletions;

    files.push({
      name: fileName,
      additions,
      deletions,
      patch: fullHunk.substring(0, 1500), // Truncate large patches
    });
  });

  // Warn if diff is too large
  if (diffOutput.length > 50000) {
    console.warn('⚠️  Diff is very large (>50KB). Truncating for review.');
  }

  return {
    files,
    stats: {
      totalFiles: files.length,
      addedLines: totalAdded,
      removedLines: totalRemoved,
    },
    raw: diffOutput.substring(0, 50000),
  };
}

// ============================================================================
// 2. CHECK FAILURE CATALOG
// ============================================================================

function checkFailureCatalog(diff) {
  const catalogPath = path.join(path.dirname(__filename), '..', 'failure-catalog.json');

  if (!fs.existsSync(catalogPath)) {
    return [];
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch {
    return [];
  }

  const matched = [];
  const patterns = catalog.patterns || [];

  patterns.forEach((pattern) => {
    try {
      const regex = new RegExp(pattern.regex, 'gm');
      if (regex.test(diff.raw)) {
        matched.push({
          id: pattern.id,
          name: pattern.name,
          severity: pattern.severity,
          description: pattern.description,
        });
      }
    } catch {
      // Ignore invalid regex
    }
  });

  return matched;
}

// ============================================================================
// 3. READ PROJECT CONTEXT
// ============================================================================

function getProjectContext() {
  const skillPath = path.join(process.cwd(), 'SKILL.md');
  let stack = 'unknown';

  if (fs.existsSync(skillPath)) {
    try {
      const skillContent = fs.readFileSync(skillPath, 'utf-8');
      const stackMatch = skillContent.match(/Stack:\s*([^\n]+)/);
      if (stackMatch) {
        stack = stackMatch[1].trim();
      }
    } catch {
      // Ignore read errors
    }
  }

  return { stack };
}

// ============================================================================
// 4. BUILD REVIEW PROMPT
// ============================================================================

function buildReviewPrompt(diff, matchedPatterns, projectContext) {
  const filesSummary = diff.files
    .map((f) => `  - ${f.name} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const catalogSection = matchedPatterns.length
    ? `\n\nAuto-flagged patterns from failure catalog:\n${matchedPatterns
        .map((p) => `  - ${p.id} (${p.severity}): ${p.description}`)
        .join('\n')}`
    : '';

  const patchSection = diff.files.map((f) => `\n--- ${f.name}\n${f.patch}`).join('\n');

  return `You are a senior code reviewer. Review this diff carefully.

Project Stack: ${projectContext.stack}

Diff Summary:
  Total files: ${diff.stats.totalFiles}
  Lines added: ${diff.stats.addedLines}
  Lines removed: ${diff.stats.removedLines}

Files changed:
${filesSummary}
${catalogSection}

Review the diff for:
1. **Security issues**: RLS policies, auth bugs, injection vulnerabilities, token handling
2. **Performance**: Memory leaks, N+1 queries, unnecessary re-renders, cache misses
3. **Correctness**: Type safety, edge cases, boundary conditions, error handling
4. **Style & consistency**: Code quality, naming, documentation, style violations
5. **Database schema**: RLS policies on new tables, migration safety

For each issue, provide:
  File path, line number (approximate), severity (Critical/Warning), and actionable message.

Then give a final verdict:
  - APPROVE: Code is ready to merge
  - CHANGES_REQUESTED: Issues found that must be fixed
  - COMMENT: Non-blocking suggestions

Format your response as:

VERDICT: [APPROVE | CHANGES_REQUESTED | COMMENT]

CRITICAL:
  - [file:line] Issue description

WARNINGS:
  - [file:line] Issue description

APPROVED:
  - Positive comment

SUMMARY:
  Brief explanation of verdict.

--- DIFF CONTENT ---
${patchSection}`;
}

// ============================================================================
// 5. CALL ANTHROPIC API
// ============================================================================

function callAnthropicAPI(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('ANTHROPIC_API_KEY environment variable is not set'));
      return;
    }

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);

          if (res.statusCode !== 200) {
            reject(new Error(`API error (${res.statusCode}): ${response.error?.message || 'Unknown error'}`));
            return;
          }

          const text = response.content[0]?.text || '';
          resolve(text);
        } catch (error) {
          reject(new Error(`Failed to parse API response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================================
// 6. PARSE REVIEW RESPONSE
// ============================================================================

function parseReviewResponse(response) {
  const review = {
    verdict: 'COMMENT',
    critical: [],
    warnings: [],
    approved: [],
    summary: '',
  };

  // Extract verdict
  const verdictMatch = response.match(/VERDICT:\s*(APPROVE|CHANGES_REQUESTED|COMMENT)/i);
  if (verdictMatch) {
    review.verdict = verdictMatch[1].toUpperCase();
  }

  // Extract critical
  const criticalMatch = response.match(/CRITICAL:\n([\s\S]*?)(?=\n\nWARNINGS:|$)/);
  if (criticalMatch) {
    const lines = criticalMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    review.critical = lines.map((l) => {
      const match = l.match(/- \[(.*?)\] (.*)/);
      if (match) {
        return { issue: match[1], message: match[2] };
      }
      return { issue: 'unknown', message: l.replace(/^-\s*/, '') };
    });
  }

  // Extract warnings
  const warningsMatch = response.match(/WARNINGS:\n([\s\S]*?)(?=\n\nAPPROVED:|$)/);
  if (warningsMatch) {
    const lines = warningsMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    review.warnings = lines.map((l) => l.replace(/^-\s*/, ''));
  }

  // Extract approved
  const approvedMatch = response.match(/APPROVED:\n([\s\S]*?)(?=\n\nSUMMARY:|$)/);
  if (approvedMatch) {
    const lines = approvedMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    review.approved = lines.map((l) => l.replace(/^-\s*/, ''));
  }

  // Extract summary
  const summaryMatch = response.match(/SUMMARY:\n([\s\S]*?)$/);
  if (summaryMatch) {
    review.summary = summaryMatch[1].trim();
  }

  return review;
}

// ============================================================================
// 7. GENERATE REPORT
// ============================================================================

function generateReport(review, diff, matchedPatterns) {
  const timestamp = new Date().toISOString().split('T')[0];
  const reviewsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'skills', 'solo-cto-agent', 'reviews');

  // Ensure directory exists
  if (!fs.existsSync(reviewsDir)) {
    fs.mkdirSync(reviewsDir, { recursive: true });
  }

  // Find next report number
  let reportNum = 1;
  const existing = fs.readdirSync(reviewsDir).filter((f) => f.startsWith(`${timestamp}-review-`));
  if (existing.length > 0) {
    reportNum = Math.max(...existing.map((f) => parseInt(f.match(/\d+/)[0], 10))) + 1;
  }

  const reportPath = path.join(reviewsDir, `${timestamp}-review-${reportNum}.md`);

  const markdownReport = `# Code Review Report

**Date:** ${new Date().toLocaleString()}
**Verdict:** ${review.verdict}

## Diff Summary

- **Total files:** ${diff.stats.totalFiles}
- **Lines added:** ${diff.stats.addedLines}
- **Lines removed:** ${diff.stats.removedLines}

## Files Changed

${diff.files.map((f) => `- ${f.name} (+${f.additions}/-${f.deletions})`).join('\n')}

## Review Results

### Verdict: ${review.verdict}

${
  review.critical.length > 0
    ? `### Critical Issues (${review.critical.length})

${review.critical.map((c) => `- **${c.issue}**: ${c.message}`).join('\n')}

`
    : ''
}${
  review.warnings.length > 0
    ? `### Warnings (${review.warnings.length})

${review.warnings.map((w) => `- ${w}`).join('\n')}

`
    : ''
}${
  review.approved.length > 0
    ? `### Approved

${review.approved.map((a) => `- ${a}`).join('\n')}

`
    : ''
}${
  matchedPatterns.length > 0
    ? `## Pattern Matches

${matchedPatterns.map((p) => `- **${p.id}** (${p.severity}): ${p.description}`).join('\n')}

`
    : ''
}## Summary

${review.summary || 'No summary provided.'}
`;

  fs.writeFileSync(reportPath, markdownReport);
  return { path: reportPath, content: markdownReport };
}

// ============================================================================
// 8. PRINT RESULTS
// ============================================================================

function printResults(review, diff, matchedPatterns, reportPath) {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║        REVIEW RESULT                             ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log(`Verdict: ${review.verdict}\n`);

  if (review.critical.length > 0) {
    console.log(`Critical (${review.critical.length}):`);
    review.critical.forEach((c) => {
      console.log(`  - ${c.issue}: ${c.message}`);
    });
    console.log();
  }

  if (review.warnings.length > 0) {
    console.log(`Warnings (${review.warnings.length}):`);
    review.warnings.forEach((w) => {
      console.log(`  - ${w}`);
    });
    console.log();
  }

  if (review.approved.length > 0) {
    console.log(`Approved (${review.approved.length}):`);
    review.approved.forEach((a) => {
      console.log(`  - ${a}`);
    });
    console.log();
  }

  if (matchedPatterns.length > 0) {
    console.log(`Known patterns matched (${matchedPatterns.length}):`);
    matchedPatterns.forEach((p) => {
      console.log(`  - "${p.id}" (${p.severity})`);
    });
    console.log();
  }

  console.log(`Report: ${reportPath}\n`);
}

// ============================================================================
// 9. MAIN REVIEW COMMAND
// ============================================================================

async function reviewCommand(options = {}) {
  const {
    path: targetPath = '.',
    agent = 'claude',
    diff = 'HEAD~1..HEAD',
    dryRun = false,
    apiKey = process.env.ANTHROPIC_API_KEY,
  } = options;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  solo-cto-agent — Local Code Review              ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Validate agent
  if (agent !== 'claude') {
    console.log(`ℹ️  Agent "${agent}" not yet implemented. Using "claude".\n`);
  }

  try {
    // Step 1: Collect diff
    console.log('[1/4] Collecting diff .............. ', { flush: true });
    const diffData = collectDiff({ diff, path: targetPath });

    if (diffData.files.length === 0) {
      console.log('✅ (empty)\n');
      console.log('Nothing to review.\n');
      return { verdict: 'APPROVE', files: 0 };
    }

    console.log(`✅ ${diffData.stats.totalFiles} files\n`);

    // Step 2: Check failure catalog
    console.log('[2/4] Checking failure catalog ..... ', { flush: true });
    const matchedPatterns = checkFailureCatalog(diffData);
    console.log(`✅ ${matchedPatterns.length} patterns matched\n`);

    // Step 3: Get project context
    const projectContext = getProjectContext();

    // Step 4: Build prompt
    const prompt = buildReviewPrompt(diffData, matchedPatterns, projectContext);

    if (dryRun) {
      console.log('[DRY RUN] Review prompt:\n');
      console.log(prompt);
      return { dryRun: true };
    }

    console.log('[3/4] Running Claude review ........ ', { flush: true });

    let reviewResponse;
    try {
      reviewResponse = await callAnthropicAPI(prompt, apiKey);
    } catch (error) {
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        console.log('❌\n');
        console.error('\nError: ANTHROPIC_API_KEY environment variable is not set.');
        console.error('Set it with: export ANTHROPIC_API_KEY="sk-ant-..."');
        process.exit(1);
      }
      throw error;
    }

    console.log('✅ review complete\n');

    // Step 5: Parse response
    const review = parseReviewResponse(reviewResponse);

    // Step 6: Generate report
    console.log('[4/4] Generating report ............ ', { flush: true });
    const report = generateReport(review, diffData, matchedPatterns);
    console.log('✅ saved\n');

    // Print results
    printResults(review, diffData, matchedPatterns, report.path);

    return {
      verdict: review.verdict,
      critical: review.critical.length,
      warnings: review.warnings.length,
      files: diffData.stats.totalFiles,
      reportPath: report.path,
    };
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = { reviewCommand };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--path') {
      options.path = args[i + 1];
      i += 1;
    } else if (args[i] === '--agent') {
      options.agent = args[i + 1];
      i += 1;
    } else if (args[i] === '--diff') {
      options.diff = args[i + 1];
      i += 1;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--api-key') {
      options.apiKey = args[i + 1];
      i += 1;
    }
  }

  reviewCommand(options).catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
