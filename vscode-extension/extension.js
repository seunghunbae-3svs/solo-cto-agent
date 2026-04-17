const vscode = require("vscode");
const { exec } = require("child_process");
const path = require("path");

/** Output channel for review results */
let outputChannel;

/**
 * Run solo-cto-agent CLI command and display results.
 * @param {string} cmd - CLI subcommand and args
 * @param {string} label - Display label for the output
 */
function runAgent(cmd, label) {
  const config = vscode.workspace.getConfiguration("soloCtoAgent");
  const tier = config.get("tier", "builder");
  const redact = config.get("redact", true);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!cwd) {
    vscode.window.showErrorMessage("Solo CTO: No workspace folder open.");
    return;
  }

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine(`⏳ Running: solo-cto-agent ${cmd}...\n`);

  const env = {
    ...process.env,
    SOLO_CTO_TIER: tier,
  };

  const fullCmd = `solo-cto-agent ${cmd}${redact ? " --redact" : ""}`;

  const child = exec(fullCmd, { cwd, env, maxBuffer: 1024 * 1024 * 10 });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (data) => {
    stdout += data;
    outputChannel.append(data.toString());
  });

  child.stderr?.on("data", (data) => {
    stderr += data;
  });

  child.on("close", (code) => {
    if (code !== 0 && stderr) {
      outputChannel.appendLine(`\n❌ Error (exit ${code}):\n${stderr}`);
      vscode.window.showErrorMessage(`Solo CTO: ${label} failed. See output panel.`);
      return;
    }

    // Try to parse JSON verdict
    try {
      const json = JSON.parse(stdout);
      const verdict = json.verdict || "UNKNOWN";
      const issueCount = json.issues?.length || 0;

      const icon = verdict === "APPROVE" ? "✅" : verdict === "REQUEST_CHANGES" ? "🔴" : "💬";
      vscode.window.showInformationMessage(
        `${icon} ${label}: ${verdict} (${issueCount} issue${issueCount === 1 ? "" : "s"})`
      );

      // Show diagnostics for issues
      if (json.issues?.length) {
        showDiagnostics(json.issues, cwd);
      }
    } catch {
      // Non-JSON output — just show completion
      vscode.window.showInformationMessage(`${label} complete. See output panel.`);
    }
  });
}

/** VS Code diagnostics collection for review issues */
let diagnosticCollection;

/**
 * Convert review issues to VS Code diagnostics.
 * @param {Array} issues - Review issues from CLI
 * @param {string} cwd - Workspace root
 */
function showDiagnostics(issues, cwd) {
  diagnosticCollection.clear();
  const diagMap = new Map();

  for (const issue of issues) {
    if (!issue.file) continue;

    const uri = vscode.Uri.file(path.join(cwd, issue.file));
    const line = Math.max(0, (issue.line || 1) - 1);
    const col = Math.max(0, (issue.column || 1) - 1);

    const severity =
      issue.severity === "BLOCKER" || issue.severity === "CRITICAL"
        ? vscode.DiagnosticSeverity.Error
        : issue.severity === "WARNING"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    const range = new vscode.Range(line, col, line, col + 100);
    const diag = new vscode.Diagnostic(range, issue.message, severity);
    diag.source = "solo-cto-agent";
    diag.code = issue.ruleId || issue.severity;

    const existing = diagMap.get(uri.toString()) || [];
    existing.push(diag);
    diagMap.set(uri.toString(), existing);
  }

  for (const [uriStr, diags] of diagMap) {
    diagnosticCollection.set(vscode.Uri.parse(uriStr), diags);
  }
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Solo CTO Agent");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("solo-cto-agent");

  const config = vscode.workspace.getConfiguration("soloCtoAgent");
  const targetBranch = config.get("targetBranch", "main");

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("soloCtoAgent.reviewFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Solo CTO: No active file.");
        return;
      }
      const relPath = vscode.workspace.asRelativePath(editor.document.uri);
      runAgent(`review --file "${relPath}" --json`, "File Review");
    }),

    vscode.commands.registerCommand("soloCtoAgent.reviewStaged", () => {
      runAgent("review --staged --json", "Staged Review");
    }),

    vscode.commands.registerCommand("soloCtoAgent.reviewBranch", () => {
      runAgent(`review --branch --target ${targetBranch} --json`, "Branch Review");
    }),

    vscode.commands.registerCommand("soloCtoAgent.dualReview", () => {
      runAgent(`dual-review --branch --target ${targetBranch} --json`, "Dual-Agent Review");
    }),

    vscode.commands.registerCommand("soloCtoAgent.deepReview", () => {
      runAgent(`deep-review --branch --target ${targetBranch} --json`, "Deep Review");
    }),

    vscode.commands.registerCommand("soloCtoAgent.templateAudit", () => {
      runAgent("template-audit --json", "Template Audit");
    }),

    vscode.commands.registerCommand("soloCtoAgent.setTier", async () => {
      const tier = await vscode.window.showQuickPick(
        [
          { label: "Maker", description: "Tier 1-3: Solo review, basic circuit breaker", detail: "maker" },
          { label: "Builder", description: "Tier 4: Dual-agent review, session memory", detail: "builder" },
          { label: "CTO", description: "Tier 5-6: Deep review, routines, managed agents", detail: "cto" },
        ],
        { placeHolder: "Select agent tier" }
      );
      if (tier) {
        await config.update("tier", tier.detail, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Solo CTO: Tier set to ${tier.label}`);
      }
    }),

    outputChannel,
    diagnosticCollection
  );

  // Auto-review on save (if enabled)
  if (config.get("autoReviewOnSave", false)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const relPath = vscode.workspace.asRelativePath(doc.uri);
        runAgent(`review --file "${relPath}" --json`, "Auto Review");
      })
    );
  }
}

function deactivate() {
  outputChannel?.dispose();
  diagnosticCollection?.dispose();
}

module.exports = { activate, deactivate };
