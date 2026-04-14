#!/usr/bin/env node

/**
 * review.js - Local Multi-Agent Code Review Runner
 *
 * Purpose: Run code reviews without GitHub Actions on a local machine.
 * Export: async function reviewCommand(options)
 *
 * Usage:
 *   solo-cto-agent review [--path .] [--agent claude] [--diff HEAD~1] [--dry-run] [--api-key $KEY] [--lang en|ko]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const SUPPORTED_LANGS = new Set(['en', 'ko']);
const DEFAULT_LANG = 'en';
const STRINGS = {
  en: {
    bannerTitle: 'solo-cto-agent Local Code Review',
    agentFallback: 'Agent "{agent}" not yet implemented. Using "claude".',
    stepCollect: '[1/4] Collecting diff .............. ',
    stepCatalog: '[2/4] Checking failure catalog ..... ',
    stepReview: '[3/4] Running Claude review ........ ',
    stepReport: '[4/4] Generating report ............ ',
    empty: '(empty)',
    nothingToReview: 'Nothing to review.',
    files: '{count} files',
    patternsMatched: '{count} patterns matched',
    dryRunHeader: '[DRY RUN] Review prompt:',
    reviewComplete: 'review complete',
    saved: 'saved',
    reportLabel: 'Report',
    verdictLabel: 'Verdict',
    criticalLabel: 'Critical',
    warningsLabel: 'Warnings',
    approvedLabel: 'Approved',
    patternsLabel: 'Known patterns matched',
    diffTooLarge: 'Diff is very large (>50KB). Truncating for review.',
    notGitRepo: 'Not a git repository. Initialize with `git init` first.',
    diffFailed: 'Failed to get diff: {message}',
    apiKeyMissing: 'ANTHROPIC_API_KEY environment variable is not set.',
    apiKeyHint: 'Set it with: export ANTHROPIC_API_KEY="sk-ant-..."',
    reportTitle: 'Code Review Report',
    diffSummaryTitle: 'Diff Summary',
    filesChangedTitle: 'Files Changed',
    reviewResultsTitle: 'Review Results',
    summaryTitle: 'Summary',
    patternMatchesTitle: 'Pattern Matches',
    summaryFallback: 'No summary provided.',
    promptIntro: 'You are a senior code reviewer. Review this diff carefully.',
    promptCatalog: 'Auto-flagged patterns from failure catalog:',
    promptReviewChecklistTitle: 'Review the diff for:',
    promptOutputTitle: 'Then give a final verdict:',
    promptFormatTitle: 'Format your response as:',
    promptOutputNote: 'Use the exact English labels shown below.'
  },
  ko: {
    bannerTitle: 'solo-cto-agent 로컬 코드 리뷰',
    agentFallback: '에이전트 "{agent}"는 아직 지원되지 않습니다. "claude"로 실행합니다.',
    stepCollect: '[1/4] diff 수집 중 .............. ',
    stepCatalog: '[2/4] failure catalog 검사 ..... ',
    stepReview: '[3/4] Claude 리뷰 실행 ........ ',
    stepReport: '[4/4] 리포트 생성 ............ ',
    empty: '(빈 diff)',
    nothingToReview: '검토할 내용이 없습니다.',
    files: '{count} 파일',
    patternsMatched: '{count}개 패턴 매치됨',
    dryRunHeader: '[DRY RUN] 리뷰 프롬프트:',
    reviewComplete: '리뷰 완료',
    saved: '저장됨',
    reportLabel: '리포트',
    verdictLabel: '판정',
    criticalLabel: '치명',
    warningsLabel: '경고',
    approvedLabel: '승인',
    patternsLabel: '알려진 패턴 매치',
    diffTooLarge: 'Diff가 큽니다 (>50KB). 일부만 리뷰합니다.',
    notGitRepo: 'git 저장소가 아닙니다. 먼저 `git init` 하세요.',
    diffFailed: 'diff를 가져오지 못했습니다: {message}',
    apiKeyMissing: 'ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.',
    apiKeyHint: '다음처럼 설정하세요: export ANTHROPIC_API_KEY="sk-ant-..."',
    reportTitle: '코드 리뷰 리포트',
    diffSummaryTitle: '변경 요약',
    filesChangedTitle: '변경된 파일',
    reviewResultsTitle: '리뷰 결과',
    summaryTitle: '요약',
    patternMatchesTitle: '패턴 매치',
    summaryFallback: '요약이 없습니다.',
    promptIntro: '당신은 시니어 코드 리뷰어입니다. 이 diff를 꼼꼼히 검토하세요.',
    promptCatalog: 'failure catalog에서 자동 플래그된 패턴:',
    promptReviewChecklistTitle: '다음 항목을 중심으로 검토하세요:',
    promptOutputTitle: '마지막에 최종 판정을 내려주세요:',
    promptFormatTitle: '응답은 아래 포맷을 그대로 사용하세요:',
    promptOutputNote: '영문 라벨(VERDICT/CRITICAL/...)은 그대로 유지해야 합니다.'
  }
};

function resolveLang(input) {
  if (!input) return DEFAULT_LANG;
  const normalized = String(input).trim().toLowerCase();
  if (SUPPORTED_LANGS.has(normalized)) return normalized;
  return DEFAULT_LANG;
}

function t(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  let text = table[key] || STRINGS[DEFAULT_LANG][key] || '';
  if (vars) {
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    });
  }
  return text;
}

// ============================================================================
// 1. COLLECT DIFF
// ============================================================================

function collectDiff(options = {}) {
  const { diff = 'HEAD~1..HEAD', path: targetPath = '.', lang = DEFAULT_LANG } = options;

  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch {
    throw new Error(t(lang, 'notGitRepo'));
  }

  let cmd = `git diff ${diff}`;
  if (targetPath !== '.') {
    cmd += ` -- ${targetPath}`;
  }

  let diffOutput;
  try {
    diffOutput = execSync(cmd, { encoding: 'utf-8' });
  } catch (error) {
    throw new Error(t(lang, 'diffFailed', { message: error.message }));
  }

  if (!diffOutput.trim()) {
    return { files: [], stats: { totalFiles: 0, addedLines: 0, removedLines: 0 }, raw: '' };
  }

  const files = [];
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
      patch: fullHunk.substring(0, 1500)
    });
  });

  if (diffOutput.length > 50000) {
    console.warn(`! ${t(lang, 'diffTooLarge')}`);
  }

  return {
    files,
    stats: {
      totalFiles: files.length,
      addedLines: totalAdded,
      removedLines: totalRemoved
    },
    raw: diffOutput.substring(0, 50000)
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
          description: pattern.description
        });
      }
    } catch {
      // ignore invalid regex
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
      // ignore read errors
    }
  }

  return { stack };
}

// ============================================================================
// 4. BUILD REVIEW PROMPT
// ============================================================================

function buildReviewPrompt(diff, matchedPatterns, projectContext, lang) {
  const locale = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  const filesSummary = diff.files
    .map((f) => `  - ${f.name} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const catalogSection = matchedPatterns.length
    ? `\n\n${locale.promptCatalog}\n${matchedPatterns
        .map((p) => `  - ${p.id} (${p.severity}): ${p.description}`)
        .join('\n')}`
    : '';

  const patchSection = diff.files.map((f) => `\n--- ${f.name}\n${f.patch}`).join('\n');

  if (lang === 'ko') {
    return `${locale.promptIntro}\n\nProject Stack: ${projectContext.stack}\n\nDiff Summary:\n  Total files: ${diff.stats.totalFiles}\n  Lines added: ${diff.stats.addedLines}\n  Lines removed: ${diff.stats.removedLines}\n\nFiles changed:\n${filesSummary}${catalogSection}\n\n${locale.promptReviewChecklistTitle}\n1. **보안**: RLS 정책, 인증 버그, 인젝션, 토큰 처리\n2. **성능**: 메모리 누수, N+1 쿼리, 불필요한 re-render, 캐시 미스\n3. **정확성**: 타입 안정성, 엣지 케이스, 경계 조건, 에러 처리\n4. **스타일 & 일관성**: 코드 품질, 네이밍, 문서, 스타일 위반\n5. **DB 스키마**: 새 테이블 RLS, 마이그레이션 안정성\n\n각 이슈에 대해:\n  파일 경로, 줄 번호(대략), 심각도(Critical/Warning), 액션 가능한 메시지.\n\n${locale.promptOutputTitle}\n  - APPROVE: 머지 가능\n  - CHANGES_REQUESTED: 반드시 수정 필요\n  - COMMENT: 비차단 제안\n\n${locale.promptFormatTitle}\n${locale.promptOutputNote}\n\nVERDICT: [APPROVE | CHANGES_REQUESTED | COMMENT]\n\nCRITICAL:\n  - [file:line] Issue description\n\nWARNINGS:\n  - [file:line] Issue description\n\nAPPROVED:\n  - Positive comment\n\nSUMMARY:\n  Brief explanation of verdict.\n\n--- DIFF CONTENT ---\n${patchSection}`;
  }

  return `${locale.promptIntro}\n\nProject Stack: ${projectContext.stack}\n\nDiff Summary:\n  Total files: ${diff.stats.totalFiles}\n  Lines added: ${diff.stats.addedLines}\n  Lines removed: ${diff.stats.removedLines}\n\nFiles changed:\n${filesSummary}${catalogSection}\n\n${locale.promptReviewChecklistTitle}\n1. **Security issues**: RLS policies, auth bugs, injection vulnerabilities, token handling\n2. **Performance**: Memory leaks, N+1 queries, unnecessary re-renders, cache misses\n3. **Correctness**: Type safety, edge cases, boundary conditions, error handling\n4. **Style & consistency**: Code quality, naming, documentation, style violations\n5. **Database schema**: RLS policies on new tables, migration safety\n\nFor each issue, provide:\n  File path, line number (approximate), severity (Critical/Warning), and actionable message.\n\n${locale.promptOutputTitle}\n  - APPROVE: Code is ready to merge\n  - CHANGES_REQUESTED: Issues found that must be fixed\n  - COMMENT: Non-blocking suggestions\n\n${locale.promptFormatTitle}\n${locale.promptOutputNote}\n\nVERDICT: [APPROVE | CHANGES_REQUESTED | COMMENT]\n\nCRITICAL:\n  - [file:line] Issue description\n\nWARNINGS:\n  - [file:line] Issue description\n\nAPPROVED:\n  - Positive comment\n\nSUMMARY:\n  Brief explanation of verdict.\n\n--- DIFF CONTENT ---\n${patchSection}`;
}

// ============================================================================
// 5. CALL ANTHROPIC API
// ============================================================================

function callAnthropicAPI(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('ANTHROPIC_API_KEY_MISSING'));
      return;
    }

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
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
    summary: ''
  };

  const verdictMatch = response.match(/VERDICT:\s*(APPROVE|CHANGES_REQUESTED|COMMENT)/i);
  if (verdictMatch) {
    review.verdict = verdictMatch[1].toUpperCase();
  }

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

  const warningsMatch = response.match(/WARNINGS:\n([\s\S]*?)(?=\n\nAPPROVED:|$)/);
  if (warningsMatch) {
    const lines = warningsMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    review.warnings = lines.map((l) => l.replace(/^-\s*/, ''));
  }

  const approvedMatch = response.match(/APPROVED:\n([\s\S]*?)(?=\n\nSUMMARY:|$)/);
  if (approvedMatch) {
    const lines = approvedMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    review.approved = lines.map((l) => l.replace(/^-\s*/, ''));
  }

  const summaryMatch = response.match(/SUMMARY:\n([\s\S]*?)$/);
  if (summaryMatch) {
    review.summary = summaryMatch[1].trim();
  }

  return review;
}

// ============================================================================
// 7. GENERATE REPORT
// ============================================================================

function generateReport(review, diff, matchedPatterns, lang) {
  const locale = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  const timestamp = new Date().toISOString().split('T')[0];
  const reviewsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'skills', 'solo-cto-agent', 'reviews');

  if (!fs.existsSync(reviewsDir)) {
    fs.mkdirSync(reviewsDir, { recursive: true });
  }

  let reportNum = 1;
  const existing = fs.readdirSync(reviewsDir).filter((f) => f.startsWith(`${timestamp}-review-`));
  if (existing.length > 0) {
    reportNum = Math.max(...existing.map((f) => parseInt(f.match(/\d+/)[0], 10))) + 1;
  }

  const reportPath = path.join(reviewsDir, `${timestamp}-review-${reportNum}.md`);

  const markdownReport = `# ${locale.reportTitle}\n\n**Date:** ${new Date().toLocaleString()}\n**${locale.verdictLabel}:** ${review.verdict}\n\n## ${locale.diffSummaryTitle}\n\n- **Total files:** ${diff.stats.totalFiles}\n- **Lines added:** ${diff.stats.addedLines}\n- **Lines removed:** ${diff.stats.removedLines}\n\n## ${locale.filesChangedTitle}\n\n${diff.files.map((f) => `- ${f.name} (+${f.additions}/-${f.deletions})`).join('\n')}\n\n## ${locale.reviewResultsTitle}\n\n### ${locale.verdictLabel}: ${review.verdict}\n\n${
    review.critical.length > 0
      ? `### ${locale.criticalLabel} (${review.critical.length})\n\n${review.critical.map((c) => `- **${c.issue}**: ${c.message}`).join('\n')}\n\n`
      : ''
  }${
    review.warnings.length > 0
      ? `### ${locale.warningsLabel} (${review.warnings.length})\n\n${review.warnings.map((w) => `- ${w}`).join('\n')}\n\n`
      : ''
  }${
    review.approved.length > 0
      ? `### ${locale.approvedLabel}\n\n${review.approved.map((a) => `- ${a}`).join('\n')}\n\n`
      : ''
  }${
    matchedPatterns.length > 0
      ? `## ${locale.patternMatchesTitle}\n\n${matchedPatterns.map((p) => `- **${p.id}** (${p.severity}): ${p.description}`).join('\n')}\n\n`
      : ''
  }## ${locale.summaryTitle}\n\n${review.summary || locale.summaryFallback}\n`;

  fs.writeFileSync(reportPath, markdownReport);
  return { path: reportPath, content: markdownReport };
}

// ============================================================================
// 8. PRINT RESULTS
// ============================================================================

function printResults(review, diff, matchedPatterns, reportPath, lang) {
  const locale = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  console.log('\n== REVIEW RESULT ==\n');

  console.log(`${locale.verdictLabel}: ${review.verdict}\n`);

  if (review.critical.length > 0) {
    console.log(`${locale.criticalLabel} (${review.critical.length}):`);
    review.critical.forEach((c) => {
      console.log(`  - ${c.issue}: ${c.message}`);
    });
    console.log();
  }

  if (review.warnings.length > 0) {
    console.log(`${locale.warningsLabel} (${review.warnings.length}):`);
    review.warnings.forEach((w) => {
      console.log(`  - ${w}`);
    });
    console.log();
  }

  if (review.approved.length > 0) {
    console.log(`${locale.approvedLabel} (${review.approved.length}):`);
    review.approved.forEach((a) => {
      console.log(`  - ${a}`);
    });
    console.log();
  }

  if (matchedPatterns.length > 0) {
    console.log(`${locale.patternsLabel} (${matchedPatterns.length}):`);
    matchedPatterns.forEach((p) => {
      console.log(`  - "${p.id}" (${p.severity})`);
    });
    console.log();
  }

  console.log(`${locale.reportLabel}: ${reportPath}\n`);
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
    lang = resolveLang(options.lang || process.env.SOLO_CTO_LANG)
  } = options;

  console.log(`\n== ${t(lang, 'bannerTitle')} ==\n`);

  if (agent !== 'claude') {
    console.log(`! ${t(lang, 'agentFallback', { agent })}\n`);
  }

  try {
    console.log(t(lang, 'stepCollect'), { flush: true });
    const diffData = collectDiff({ diff, path: targetPath, lang });

    if (diffData.files.length === 0) {
      console.log(`${t(lang, 'empty')}\n`);
      console.log(`${t(lang, 'nothingToReview')}\n`);
      return { verdict: 'APPROVE', files: 0 };
    }

    console.log(`${t(lang, 'files', { count: diffData.stats.totalFiles })}\n`);

    console.log(t(lang, 'stepCatalog'), { flush: true });
    const matchedPatterns = checkFailureCatalog(diffData);
    console.log(`${t(lang, 'patternsMatched', { count: matchedPatterns.length })}\n`);

    const projectContext = getProjectContext();
    const prompt = buildReviewPrompt(diffData, matchedPatterns, projectContext, lang);

    if (dryRun) {
      console.log(`${t(lang, 'dryRunHeader')}\n`);
      console.log(prompt);
      return { dryRun: true };
    }

    console.log(t(lang, 'stepReview'), { flush: true });

    let reviewResponse;
    try {
      reviewResponse = await callAnthropicAPI(prompt, apiKey);
    } catch (error) {
      if (error.message === 'ANTHROPIC_API_KEY_MISSING') {
        console.log('\n');
        console.error(`Error: ${t(lang, 'apiKeyMissing')}`);
        console.error(t(lang, 'apiKeyHint'));
        process.exit(1);
      }
      throw error;
    }

    console.log(`${t(lang, 'reviewComplete')}\n`);

    const review = parseReviewResponse(reviewResponse);

    console.log(t(lang, 'stepReport'), { flush: true });
    const report = generateReport(review, diffData, matchedPatterns, lang);
    console.log(`${t(lang, 'saved')}\n`);

    printResults(review, diffData, matchedPatterns, report.path, lang);

    return {
      verdict: review.verdict,
      critical: review.critical.length,
      warnings: review.warnings.length,
      files: diffData.stats.totalFiles,
      reportPath: report.path
    };
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = { reviewCommand };

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
    } else if (args[i] === '--lang') {
      options.lang = args[i + 1];
      i += 1;
    }
  }

  reviewCommand(options).catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
