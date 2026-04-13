/**
 * validate-orchestrator.js
 *
 * Validates operational artifacts:
 *   1. JSON files against their schemas (agent-scores, round-logs)
 *   2. Required sections in report-template.md
 *   3. Required fields in telegram-template.md
 *   4. Placeholder detection in workflow files
 *
 * Exit code 0 = all pass
 * Exit code 1 = at least one FAIL
 * WARN-level issues print warnings but don't fail the build (staged rollout)
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const ROOT = path.resolve(__dirname, "../..");
const SCHEMAS_DIR = path.join(__dirname, "schemas");

// Support nested layout: references may be at ROOT/references/ or ROOT/dual-agent-review-orchestrator/references/
const REFS_DIR = fs.existsSync(path.join(ROOT, "references"))
  ? path.join(ROOT, "references")
  : fs.existsSync(path.join(ROOT, "dual-agent-review-orchestrator", "references"))
    ? path.join(ROOT, "dual-agent-review-orchestrator", "references")
    : path.join(ROOT, "references");

const ajv = new Ajv({ allErrors: true, validateSchema: false });

let failures = 0;
let warnings = 0;

function pass(label) {
  console.log(`  ✅ ${label}`);
}
function warn(label, detail) {
  console.log(`  ⚠️  WARN: ${label} — ${detail}`);
  warnings++;
}
function fail(label, detail) {
  console.log(`  ❌ FAIL: ${label} — ${detail}`);
  failures++;
}

// --- 1. JSON Schema Validation ---

function validateJsonSchema(dataPath, schemaPath, label, required) {
  console.log(`\n[${label}]`);

  if (!fs.existsSync(dataPath)) {
    if (required) {
      fail(label, `file not found: ${dataPath}`);
    } else {
      warn(label, `file not found (not yet created) — skipping`);
    }
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch (e) {
    fail(label, `invalid JSON: ${e.message}`);
    return;
  }

  if (!fs.existsSync(schemaPath)) {
    warn(label, `schema not found: ${schemaPath}`);
    return;
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    pass(`${label} schema valid`);
  } else {
    const errors = validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; ");
    fail(label, errors);
  }
}

// --- 2. Markdown Required Sections ---

function validateMarkdownSections(filePath, requiredSections, label) {
  console.log(`\n[${label}]`);

  if (!fs.existsSync(filePath)) {
    fail(label, `file not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
  const missing = requiredSections.filter((s) => !content.includes(s.toLowerCase()));

  if (missing.length === 0) {
    pass(`${label} — all ${requiredSections.length} required sections present`);
  } else {
    fail(label, `missing sections: ${missing.join(", ")}`);
  }
}

// --- 3. Placeholder Detection ---

function checkNotPlaceholder(filePath, placeholderPatterns, label, strict) {
  console.log(`\n[${label}]`);

  if (!fs.existsSync(filePath)) {
    warn(label, `file not found`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const found = placeholderPatterns.filter((p) => content.includes(p));

  if (found.length === 0) {
    pass(`${label} — no placeholders detected`);
  } else if (strict) {
    fail(label, `still contains placeholders: ${found.join(", ")}`);
  } else {
    warn(label, `still contains placeholders: ${found.join(", ")}`);
  }
}

// --- 4. YAML Syntax Check (basic) ---

function checkYamlBasic(dir, label) {
  console.log(`\n[${label}]`);

  if (!fs.existsSync(dir)) {
    warn(label, `directory not found: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    // Basic check: must have 'name:' and 'on:' and 'jobs:'
    const hasName = /^name:/m.test(content);
    const hasOn = /^on:/m.test(content);
    const hasJobs = /^jobs:/m.test(content);

    if (hasName && hasOn && hasJobs) {
      pass(`${file} — basic structure OK`);
    } else {
      const missing = [];
      if (!hasName) missing.push("name:");
      if (!hasOn) missing.push("on:");
      if (!hasJobs) missing.push("jobs:");
      fail(file, `missing required top-level keys: ${missing.join(", ")}`);
    }
  }
}

// --- 5. Trigger keywords overlap check ---

function validateTriggerKeywords(filePath, label) {
  console.log(`\n[${label}]`);

  if (!fs.existsSync(filePath)) {
    fail(label, `file not found: ${filePath}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    fail(label, `invalid JSON: ${e.message}`);
    return;
  }

  const dev = Array.isArray(data.dev_keywords) ? data.dev_keywords : [];
  const design = Array.isArray(data.design_keywords) ? data.design_keywords : [];

  if (dev.length === 0 || design.length === 0) {
    fail(label, "dev_keywords and design_keywords must be non-empty arrays");
    return;
  }

  const devSet = new Set(dev.map((v) => String(v).toLowerCase().trim()));
  const overlaps = design
    .map((v) => String(v).toLowerCase().trim())
    .filter((v) => devSet.has(v));

  if (overlaps.length > 0) {
    fail(label, `overlap detected: ${overlaps.join(", ")}`);
  } else {
    pass(`${label} no overlap between dev and design keywords`);
  }
}

// ============================
// Run all validations
// ============================

console.log("=== Orchestrator Operational Validation ===\n");

// 1. agent-scores.json
validateJsonSchema(
  path.join(__dirname, "agent-scores.json"),
  path.join(SCHEMAS_DIR, "agent-scores.schema.json"),
  "agent-scores.json",
  true
);

// 2. routing-policy.json
validateJsonSchema(
  path.join(__dirname, "routing-policy.json"),
  path.join(SCHEMAS_DIR, "routing-policy.schema.json"),
  "routing-policy.json",
  true
);

// 2b. meta-validation-policy.json (optional — may not exist yet)
validateJsonSchema(
  path.join(__dirname, "meta-validation-policy.json"),
  path.join(SCHEMAS_DIR, "meta-validation-policy.schema.json"),
  "meta-validation-policy.json",
  false
);

// 3. round-logs (validate any that exist)
const roundLogsDir = path.join(__dirname, "round-logs");
if (fs.existsSync(roundLogsDir)) {
  const logFiles = fs.readdirSync(roundLogsDir).filter((f) => f.endsWith(".json"));
  for (const logFile of logFiles) {
    validateJsonSchema(
      path.join(roundLogsDir, logFile),
      path.join(SCHEMAS_DIR, "round-log.schema.json"),
      `round-log: ${logFile}`,
      false
    );
  }
  if (logFiles.length === 0) {
    console.log("\n[round-logs]");
    pass("no round-logs yet — nothing to validate");
  }
}

// 3. report-template.md required sections
validateMarkdownSections(
  path.join(REFS_DIR, "report-template.md"),
  [
    "current phase",
    "best current recommendation",
    "blockers",
    "codex assessment",
    "claude assessment",
    "agent scorecard",
    "task allocation",
    "preview link",
    "telegram-ready summary",
  ],
  "report-template.md"
);

// 4. telegram-template.md required fields
validateMarkdownSections(
  path.join(REFS_DIR, "telegram-template.md"),
  [
    "phase",
    "recommendation",
    "blocker",
    "preview",
    "codex",
    "claude",
    "approve",
    "revise",
    "hold",
  ],
  "telegram-template.md"
);

// 5. Workflow YAML basic structure
checkYamlBasic(path.join(ROOT, ".github", "workflows"), "GitHub Actions workflows");
checkYamlBasic(path.join(ROOT, "assets", "github-actions"), "Asset workflow templates");

// 6. Placeholder detection (WARN during hardening, FAIL after stabilization)
checkNotPlaceholder(
  path.join(ROOT, "assets", "github-actions", "preview-summary.yml"),
  ["Capture preview url here", "echo \"Capture"],
  "preview-summary.yml placeholder check",
  false // WARN mode during hardening phase
);

checkNotPlaceholder(
  path.join(ROOT, "assets", "github-actions", "feedback-to-github.yml"),
  ["Implement your Telegram webhook", "echo \"Implement"],
  "feedback-to-github.yml placeholder check",
  false // WARN mode during hardening phase
);

// 7. Trigger keyword overlap check
validateTriggerKeywords(
  path.join(__dirname, "trigger-keywords.json"),
  "trigger-keywords.json"
);

// --- Summary ---
console.log("\n=== Summary ===");
console.log(`  Failures: ${failures}`);
console.log(`  Warnings: ${warnings}`);

if (failures > 0) {
  console.log("\n❌ Validation FAILED");
  process.exit(1);
} else if (warnings > 0) {
  console.log("\n⚠️  Validation passed with warnings");
  process.exit(0);
} else {
  console.log("\n✅ All validations passed");
  process.exit(0);
}
