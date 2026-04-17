const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEXT_EXTENSIONS = new Set([
  ".yml",
  ".yaml",
  ".js",
  ".ts",
  ".md",
  ".json",
  ".sh",
  ".html",
  ".txt",
]);

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function normalizeText(text) {
  return String(text).replace(/\r\n/g, "\n");
}

function hashContent(text) {
  return crypto.createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 16);
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function renderTemplate(src, replacements = {}) {
  let content = fs.readFileSync(src, "utf8");
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.split(placeholder).join(value);
  }
  return content;
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return null;
  if (!isTextFile(filePath)) return null;
  return hashContent(fs.readFileSync(filePath, "utf8"));
}

function hashTemplateFile(src, replacements = {}) {
  if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) return null;
  if (!isTextFile(src)) return null;
  return hashContent(renderTemplate(src, replacements));
}

function relativeFromPackage(packageRoot, absolutePath) {
  return normalizePath(path.relative(packageRoot, absolutePath));
}

function collectTextFilesRecursive(baseDir, prefix = "") {
  const items = [];
  if (!fs.existsSync(baseDir)) return items;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const abs = path.join(baseDir, entry.name);
    const rel = normalizePath(path.join(prefix, entry.name));
    if (entry.isDirectory()) {
      items.push(...collectTextFilesRecursive(abs, rel));
      continue;
    }
    if (isTextFile(abs)) items.push({ abs, rel });
  }
  return items;
}

function addFileRecord(records, packageRoot, templateAbs, targetRel, replacements, meta = {}) {
  if (!fs.existsSync(templateAbs)) return;
  if (fs.statSync(templateAbs).isDirectory()) {
    for (const item of collectTextFilesRecursive(templateAbs, targetRel)) {
      records.push({
        targetPath: normalizePath(item.rel),
        templatePath: relativeFromPackage(packageRoot, item.abs),
        installedHash: hashTemplateFile(item.abs, replacements),
        optional: !!meta.optional,
        category: meta.category || "template",
      });
    }
    return;
  }
  if (!isTextFile(templateAbs)) return;
  records.push({
    targetPath: normalizePath(targetRel),
    templatePath: relativeFromPackage(packageRoot, templateAbs),
    installedHash: hashTemplateFile(templateAbs, replacements),
    optional: !!meta.optional,
    category: meta.category || "template",
  });
}

function buildProductRepoRecords(packageRoot, tiersData, tier, replacements = {}) {
  const records = [];
  const productRoot = path.join(packageRoot, "templates", "product-repo");
  const builder = tiersData.product_repo_templates.builder.workflows || [];
  const cto = tier === "cto" ? tiersData.product_repo_templates.cto.additional_workflows || [] : [];
  const optional = tiersData.product_repo_templates.optional.workflows || [];
  const other = tiersData.product_repo_templates.other || [];

  for (const wf of builder) {
    addFileRecord(
      records,
      packageRoot,
      path.join(productRoot, ".github", "workflows", wf),
      path.join(".github", "workflows", wf),
      replacements,
      { category: "workflow" }
    );
  }

  for (const wf of cto) {
    addFileRecord(
      records,
      packageRoot,
      path.join(productRoot, ".github", "workflows", wf),
      path.join(".github", "workflows", wf),
      replacements,
      { category: "workflow" }
    );
  }

  for (const wf of optional) {
    addFileRecord(
      records,
      packageRoot,
      path.join(productRoot, ".github", "workflows", wf),
      path.join(".github", "workflows", wf),
      replacements,
      { category: "workflow", optional: true }
    );
  }

  for (const item of other) {
    addFileRecord(records, packageRoot, path.join(productRoot, item), normalizePath(item), replacements, { category: "config" });
  }

  return records;
}

function buildOrchestratorRecords(packageRoot, tiersData, tier, replacements = {}) {
  const records = [];
  const orchRoot = path.join(packageRoot, "templates", "orchestrator");
  const builderDefaults = path.join(packageRoot, "templates", "builder-defaults");
  const base = tiersData.tiers.base;
  const pro = tiersData.tiers.pro;
  const isPro = tier === "cto";

  for (const wf of base.orchestrator_workflows || []) {
    addFileRecord(
      records,
      packageRoot,
      path.join(orchRoot, ".github", "workflows", wf),
      path.join(".github", "workflows", wf),
      replacements,
      { category: "workflow" }
    );
  }

  if (isPro) {
    for (const wf of pro.additional_orchestrator_workflows || []) {
      addFileRecord(
        records,
        packageRoot,
        path.join(orchRoot, ".github", "workflows", wf),
        path.join(".github", "workflows", wf),
        replacements,
        { category: "workflow" }
      );
    }
  }

  for (const file of fs.existsSync(path.join(orchRoot, "ops", "agents"))
    ? fs.readdirSync(path.join(orchRoot, "ops", "agents"))
    : []) {
    addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "agents", file), path.join("ops", "agents", file), replacements, { category: "ops" });
  }

  for (const file of base.ops_scripts || []) {
    addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "scripts", file), path.join("ops", "scripts", file), replacements, { category: "ops" });
  }
  if (isPro) {
    for (const file of pro.ops_scripts || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "scripts", file), path.join("ops", "scripts", file), replacements, { category: "ops" });
    }
  }

  for (const file of base.ops_libs || []) {
    addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "lib", file), path.join("ops", "lib", file), replacements, { category: "ops" });
  }
  if (isPro) {
    for (const file of pro.ops_libs || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "lib", file), path.join("ops", "lib", file), replacements, { category: "ops" });
    }
  }

  for (const item of base.ops_orchestrator || []) {
    if (item.endsWith("/")) {
      const dirName = item.replace(/\/$/, "");
      addFileRecord(
        records,
        packageRoot,
        path.join(orchRoot, "ops", "orchestrator", dirName),
        path.join("ops", "orchestrator", dirName),
        replacements,
        { category: "ops" }
      );
      continue;
    }
    addFileRecord(
      records,
      packageRoot,
      path.join(orchRoot, "ops", "orchestrator", item),
      path.join("ops", "orchestrator", item),
      replacements,
      { category: "ops" }
    );
  }

  if (isPro) {
    for (const file of pro.ops_orchestrator_extras || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "orchestrator", file), path.join("ops", "orchestrator", file), replacements, { category: "ops" });
    }
    for (const file of pro.ops_config || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "config", file), path.join("ops", "config", file), replacements, { category: "ops" });
    }
    for (const file of pro.ops_integrations || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "integrations", file), path.join("ops", "integrations", file), replacements, { category: "ops" });
    }
    for (const file of pro.ops_codex_extras || []) {
      addFileRecord(records, packageRoot, path.join(orchRoot, "ops", file), path.join("ops", file), replacements, { category: "ops" });
    }
  } else {
    addFileRecord(records, packageRoot, path.join(builderDefaults, "routing-policy.json"), path.join("ops", "orchestrator", "routing-policy.json"), replacements, { category: "ops" });
    addFileRecord(records, packageRoot, path.join(builderDefaults, "agent-scores.json"), path.join("ops", "orchestrator", "agent-scores.json"), replacements, { category: "ops" });
  }

  for (const file of base.root_config || []) {
    addFileRecord(records, packageRoot, path.join(orchRoot, file), file, replacements, { category: "config" });
  }

  for (const item of base.other || []) {
    const dirName = item.replace("/*", "").replace(/\/$/, "");
    addFileRecord(records, packageRoot, path.join(orchRoot, dirName), dirName, replacements, { category: "config" });
  }

  addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "package.json"), path.join("ops", "package.json"), replacements, { category: "ops" });
  addFileRecord(records, packageRoot, path.join(orchRoot, "ops", "package-lock.json"), path.join("ops", "package-lock.json"), replacements, { category: "ops" });

  return records;
}

function defaultAuditSettings() {
  return {
    enabled: true,
    mode: "report-only",
    schedule: "daily",
  };
}

function defaultManifest() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    templateAudit: defaultAuditSettings(),
    repos: [],
  };
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return defaultManifest();
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return {
      ...defaultManifest(),
      ...data,
      templateAudit: {
        ...defaultAuditSettings(),
        ...(data.templateAudit || {}),
      },
      repos: Array.isArray(data.repos) ? data.repos : [],
    };
  } catch {
    return defaultManifest();
  }
}

function writeManifest(manifestPath, manifest) {
  const next = {
    ...defaultManifest(),
    ...manifest,
    updatedAt: new Date().toISOString(),
    templateAudit: {
      ...defaultAuditSettings(),
      ...(manifest.templateAudit || {}),
    },
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function repoKey(entry) {
  const slug = entry.repoSlug || entry.repoName || "";
  const repoPath = normalizePath(entry.repoPath || "");
  return `${entry.type}:${slug}:${repoPath}`;
}

function upsertManagedRepo(manifestPath, repoEntry) {
  const manifest = loadManifest(manifestPath);
  const key = repoKey(repoEntry);
  const existingIndex = manifest.repos.findIndex((item) => repoKey(item) === key);
  if (existingIndex >= 0) {
    manifest.repos[existingIndex] = {
      ...manifest.repos[existingIndex],
      ...repoEntry,
      updatedAt: new Date().toISOString(),
    };
  } else {
    manifest.repos.push({
      ...repoEntry,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  writeManifest(manifestPath, manifest);
  return manifest;
}

function makeManagedRepoEntry({
  packageRoot,
  tiersData,
  type,
  tier,
  mode,
  owner,
  repoName,
  repoPath,
  orchestratorName,
  replacements = {},
}) {
  const records = type === "orchestrator"
    ? buildOrchestratorRecords(packageRoot, tiersData, tier, replacements)
    : buildProductRepoRecords(packageRoot, tiersData, tier, replacements);

  return {
    type,
    tier,
    mode,
    owner: owner || null,
    repoName: repoName || path.basename(repoPath || ""),
    repoSlug: owner && (repoName || path.basename(repoPath || "")) ? `${owner}/${repoName || path.basename(repoPath || "")}` : null,
    repoPath: repoPath ? path.resolve(repoPath) : null,
    orchestratorName: orchestratorName || null,
    replacements,
    templateAudit: defaultAuditSettings(),
    files: records,
    lastInstalledAt: new Date().toISOString(),
  };
}

function auditRepoEntry(entry, packageRoot) {
  const results = [];
  const repoPath = entry.repoPath;
  const replacements = entry.replacements || {};

  for (const file of entry.files || []) {
    const targetAbs = repoPath ? path.join(repoPath, file.targetPath) : null;
    const exists = !!targetAbs && fs.existsSync(targetAbs);
    if (!exists) {
      results.push({
        targetPath: file.targetPath,
        status: file.optional ? "OPTIONAL_MISSING" : "MISSING",
        optional: !!file.optional,
        category: file.category || "template",
        templatePath: file.templatePath,
      });
      continue;
    }

    const currentHash = hashFile(targetAbs);
    const expectedHash = file.templatePath
      ? hashTemplateFile(path.join(packageRoot, file.templatePath), replacements) || file.installedHash
      : file.installedHash;

    let status = "OK";
    if (currentHash && expectedHash && currentHash === expectedHash) {
      status = "OK";
    } else if (currentHash && file.installedHash && currentHash === file.installedHash) {
      status = "DRIFT";
    } else if (currentHash && expectedHash && currentHash !== expectedHash) {
      status = "CUSTOM";
    }

    results.push({
      targetPath: file.targetPath,
      status,
      optional: !!file.optional,
      category: file.category || "template",
      templatePath: file.templatePath,
    });
  }

  const summary = {
    ok: results.filter((item) => item.status === "OK").length,
    drift: results.filter((item) => item.status === "DRIFT").length,
    custom: results.filter((item) => item.status === "CUSTOM").length,
    missing: results.filter((item) => item.status === "MISSING").length,
    optionalMissing: results.filter((item) => item.status === "OPTIONAL_MISSING").length,
    total: results.length,
  };

  return {
    entry,
    summary,
    results,
  };
}

function auditManagedRepos(manifestPath, packageRoot) {
  const manifest = loadManifest(manifestPath);
  const repos = manifest.repos.map((entry) => auditRepoEntry(entry, packageRoot));
  const totals = repos.reduce(
    (acc, repo) => {
      acc.ok += repo.summary.ok;
      acc.drift += repo.summary.drift;
      acc.custom += repo.summary.custom;
      acc.missing += repo.summary.missing;
      acc.optionalMissing += repo.summary.optionalMissing;
      acc.total += repo.summary.total;
      return acc;
    },
    { ok: 0, drift: 0, custom: 0, missing: 0, optionalMissing: 0, total: 0 }
  );
  return {
    manifest,
    repos,
    totals,
  };
}

function applyFixes(auditResults, packageRoot, opts = {}) {
  const dryRun = opts.dryRun === true;
  const exclude = opts.exclude || [];
  const fixed = [];
  const skipped = [];
  const errors = [];

  function shouldExclude(targetPath) {
    for (const pattern of exclude) {
      if (targetPath.includes(pattern)) return true;
    }
    return false;
  }

  for (const auditRepo of auditResults.repos) {
    const repoPath = auditRepo.entry.repoPath;
    const replacements = auditRepo.entry.replacements || {};

    for (const result of auditRepo.results) {
      const { targetPath, status, templatePath, optional } = result;

      if (shouldExclude(targetPath)) {
        skipped.push({ repoPath, targetPath, reason: "excluded" });
        continue;
      }

      if (status === "OK") {
        continue;
      }

      if (status === "CUSTOM") {
        skipped.push({ repoPath, targetPath, reason: "customized (user changes detected)" });
        continue;
      }

      if (status === "OPTIONAL_MISSING") {
        skipped.push({ repoPath, targetPath, reason: "optional file" });
        continue;
      }

      if (status === "MISSING" && optional) {
        skipped.push({ repoPath, targetPath, reason: "optional file missing" });
        continue;
      }

      const targetAbs = repoPath ? path.join(repoPath, targetPath) : null;
      if (!targetAbs) {
        errors.push({ repoPath, targetPath, error: "no repo path available" });
        continue;
      }

      try {
        if (status === "MISSING") {
          const templateAbs = path.join(packageRoot, templatePath);
          if (!fs.existsSync(templateAbs)) {
            errors.push({ repoPath, targetPath, error: "template file not found" });
            continue;
          }

          if (dryRun) {
            fixed.push({ repoPath, targetPath, action: "create" });
          } else {
            const rendered = renderTemplate(templateAbs, replacements);
            fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
            fs.writeFileSync(targetAbs, rendered, "utf8");
            fixed.push({ repoPath, targetPath, action: "create" });
          }
        } else if (status === "DRIFT") {
          const templateAbs = path.join(packageRoot, templatePath);
          if (!fs.existsSync(templateAbs)) {
            errors.push({ repoPath, targetPath, error: "template file not found" });
            continue;
          }

          if (dryRun) {
            fixed.push({ repoPath, targetPath, action: "restore" });
          } else {
            const rendered = renderTemplate(templateAbs, replacements);
            fs.writeFileSync(targetAbs, rendered, "utf8");
            fixed.push({ repoPath, targetPath, action: "restore" });
          }
        }
      } catch (err) {
        errors.push({ repoPath, targetPath, error: err.message });
      }
    }
  }

  return {
    fixed: fixed.length,
    skipped: skipped.length,
    errors: errors.length,
    details: {
      fixed,
      skipped,
      errors,
    },
    dryRun,
  };
}

module.exports = {
  applyFixes,
  auditManagedRepos,
  buildOrchestratorRecords,
  buildProductRepoRecords,
  defaultAuditSettings,
  defaultManifest,
  hashContent,
  hashFile,
  hashTemplateFile,
  loadManifest,
  makeManagedRepoEntry,
  normalizePath,
  renderTemplate,
  upsertManagedRepo,
  writeManifest,
};
