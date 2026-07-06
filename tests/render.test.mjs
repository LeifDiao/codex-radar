import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { makeTempHome } from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(__dirname, "..", "plugins", "codex-radar", "skills", "analyze", "scripts", "render-report.mjs");
const TEMPLATE = path.join(__dirname, "..", "plugins", "codex-radar", "viewer", "template.html");

function sampleReport(overrides = {}) {
  const dimension = (id, category, score) => ({
    id, category,
    name: { en: id, zh: id },
    description: { en: "d", zh: "d" },
    applicable: true,
    score,
    grade: score >= 70 ? "A" : "B",
    baseline: score - 3,
    adjustment: 3,
    reasoning: { en: "r", zh: "r" },
    evidence: ["a1: something concrete"]
  });
  return {
    schemaVersion: "2.1",
    project: "Fixture Project",
    projectCwd: "/tmp/fixture-project",
    generatedAt: "2026-07-06T12:00:00.000Z",
    language: "zh",
    insight: { en: "Sharp asks, unproven ships.", zh: "指令锋利，交付裸奔。" },
    profile: {
      type: "feature_build", label: { en: "Feature build", zh: "功能开发" },
      rationale: { en: "edits", zh: "有编辑" }, automationShare: 0.2,
      sessionCount: 4, subagentSessionsExcluded: 1,
      dateRange: ["2026-06-01T00:00:00Z", "2026-06-29T00:00:00Z"],
      humanMessages: 25, confidence: "medium"
    },
    overallScore: 68, overallGrade: "B",
    categoryScores: { communication: 74, engineering: 60, outcome: 70 },
    dimensions: [
      dimension("lock_on", "communication", 78),
      dimension("scene_setting", "communication", 71),
      dimension("steering", "communication", 73),
      dimension("toolcraft", "engineering", 66),
      { ...dimension("architecture", "engineering", null), applicable: false, score: null, grade: null },
      dimension("tempo", "engineering", 55),
      dimension("efficiency", "outcome", 72),
      dimension("proof_check", "outcome", 61),
      dimension("completion", "outcome", 77)
    ],
    toolcraftDetails: { totalToolCalls: 42, byCategory: [{ name: "shell", count: 30 }], topTools: [{ name: "exec_command", count: 30 }], subagentCalls: 1, planUpdates: 2, mcpCalls: 2, webSearchCalls: 1, imageCalls: 0, viewImageCalls: 1, browserCalls: 0, commandSuccessRate: 0.9 },
    modernTools: {
      mcpByServer: { node_repl: { calls: 2, errors: 1, tools: [{ name: "js", count: 2 }] } },
      subagentLifecycle: { spawned: 1, waited: 1, closed: 0, orphanedEstimate: 1 },
      plans: { updates: 2, sessionsWithPlan: 1, planCompletionAvg: 0.5 },
      goals: { goalToolCalls: 0, threadGoalEvents: 0 },
      toolSearch: { calls: 0 },
      skillReads: [{ name: "imagegen", count: 2 }],
      web: { searches: 1, topQueries: ["null vs undefined"] },
      images: { generated: 0, viewed: 1 },
      nodeRepl: { jsCalls: 2 },
      contextHygiene: { compactions: 1, oversizedLines: 0, maxContextUsedPct: 0.42 }
    },
    projectAssets: { cwdResolved: true, hasAgentsMd: false, hasGit: true, hasManifest: true, hasReadme: true, hasTestsDir: false, hasCodexDir: false, hasAgentsDir: false, rootEntryCount: 12 },
    subagentActivity: { sessionCount: 1, byRole: { explorer: 1 }, toolCalls: 3, edits: 0, nicknames: ["Hubble"] },
    parserWarnings: ["1 shell command had no recognizable exit-code format."],
    evidenceAtoms: [
      { id: "a1", role: "user", sessionId: "s1", timestamp: "2026-06-29T10:00:00Z", snippet: "帮我修复 src/app.js", features: ["explicitGoal"], after: { toolCalls: 5, edits: 2, proofRuns: 1, failedCommands: 1, aborts: 0 } }
    ],
    episodes: [
      { sessionId: "s1", kind: "interactive", threadName: "fix parse", startedAt: "2026-06-29T10:00:00Z", endedAt: "2026-06-29T10:20:00Z", durationMinutes: 20, humanMessages: 3, toolCalls: 12, edits: 2, proofPassed: 1, proofFailed: 1, proofUnknown: 0, failedCommands: 1, completedTurns: 3, aborts: 0, planUpdates: 1, planCompletion: { completed: 1, total: 2 }, corrections: 1, firstUserMessage: "帮我修复 src/app.js", lastAgentMessage: "Fixed and verified." }
    ],
    incidents: [
      { type: "command_retry_churn", summary: "rg failed 2×", sessionIds: ["s1"], evidenceRefs: ["a1"] }
    ],
    diagnosis: {
      collaborationProfile: { en: "p", zh: "画像" },
      coreDiagnosis: { en: "**Strength**: precise asks.", zh: "**强项**：指令精准。" },
      crossDimensionReading: { en: "x", zh: "组合解读" }
    },
    observations: [
      { text: { en: "obs", zh: "观察" }, dimensionId: "proof_check", evidenceRefs: ["a1"] }
    ],
    suggestions: [
      { type: "verification_loop", dimensionId: "proof_check", priority: "high", title: { en: "Close with proof", zh: "带证据收工" }, body: { en: "b", zh: "正文" }, evidence: { en: "e", zh: "证据" }, evidenceRefs: ["a1"], promptRewrite: { en: "run npm test and paste", zh: "跑 npm test 并贴结果" }, steps: null, snippet: null, verifyBy: { en: "proofCommands.passed > 0", zh: "proofCommands.passed > 0" }, expectedImpact: { en: "+10 Proof", zh: "验证 +10" } },
      { type: "setup_action", dimensionId: "architecture", priority: "medium", title: { en: "AGENTS.md", zh: "建 AGENTS.md" }, body: { en: "b", zh: "b" }, evidence: { en: "e", zh: "e" }, evidenceRefs: ["a1"], promptRewrite: null, steps: null, snippet: "# AGENTS.md\n\n- run: npm test", verifyBy: { en: "hasAgentsMd == true", zh: "hasAgentsMd == true" }, expectedImpact: { en: "+20 Arch", zh: "脚手架 +20" } },
      { type: "workflow_habit", dimensionId: "tempo", priority: "medium", title: { en: "Stop retry loops", zh: "止住重试环" }, body: { en: "b", zh: "b" }, evidence: { en: "e", zh: "e" }, evidenceRefs: ["a1"], promptRewrite: null, steps: [{ en: "step 1", zh: "第一步" }, { en: "step 2", zh: "第二步" }], snippet: null, verifyBy: { en: "no churn incidents", zh: "无重试卡壳" }, expectedImpact: { en: "+8 Tempo", zh: "节奏 +8" } },
      { type: "tool_adoption", dimensionId: "toolcraft", priority: "low", title: { en: "Close agents", zh: "回收子代理" }, body: { en: "b", zh: "b" }, evidence: { en: "e", zh: "e" }, evidenceRefs: ["a1"], promptRewrite: null, steps: [{ en: "s", zh: "s" }], snippet: null, verifyBy: { en: "orphanedEstimate == 0", zh: "orphanedEstimate == 0" }, expectedImpact: { en: "+5 Tools", zh: "工具 +5" } },
      { type: "prompt_rewrite", dimensionId: "lock_on", priority: "low", title: { en: "Name the file", zh: "点名文件" }, body: { en: "b", zh: "b" }, evidence: { en: "e", zh: "e" }, evidenceRefs: ["a1"], promptRewrite: { en: "edit src/x.js: ...", zh: "改 src/x.js：..." }, steps: null, snippet: null, verifyBy: { en: "filePath ratio up", zh: "filePath 比例上升" }, expectedImpact: { en: "+5 Lock-On", zh: "瞄准 +5" } }
    ],
    agentsMdDraft: "# AGENTS.md\n\n## Commands\n- npm test",
    ...overrides
  };
}

function runRender(home, report) {
  const reportPath = path.join(home.root, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report));
  const stdout = execFileSync("node", [RENDERER, reportPath, "--no-open"], {
    encoding: "utf8",
    env: { ...process.env, CODEX_RADAR_HOME: home.radarHome }
  });
  return stdout.trim();
}

test("renders a valid 2.1 report to self-contained HTML", () => {
  const home = makeTempHome("codex-radar-render-");
  const outPath = runRender(home, sampleReport());
  assert.ok(fs.existsSync(outPath));
  const html = fs.readFileSync(outPath, "utf8");
  assert.ok(html.includes("Fixture Project"));
  assert.ok(html.includes("verification_loop"), "typed suggestions embedded");
  assert.ok(html.includes("agentsMdDraft") || html.includes("AGENTS.md"), "draft embedded");
  assert.ok(!html.includes("{{REPORT_DATA}}"), "placeholder replaced");
});

test("rejects a structurally broken report with readable errors", () => {
  const home = makeTempHome("codex-radar-render-");
  const broken = sampleReport({ dimensions: [], language: "fr" });
  const reportPath = path.join(home.root, "broken.json");
  fs.writeFileSync(reportPath, JSON.stringify(broken));
  let failed = false;
  try {
    execFileSync("node", [RENDERER, reportPath, "--no-open"], {
      encoding: "utf8",
      env: { ...process.env, CODEX_RADAR_HOME: home.radarHome },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failed = true;
    const stderr = String(error.stderr);
    assert.match(stderr, /language must be exactly/);
    assert.match(stderr, /dimensions must be an array of exactly 9/);
  }
  assert.ok(failed, "renderer must exit non-zero on invalid report");
});

test("second run injects history and delta", () => {
  const home = makeTempHome("codex-radar-render-");
  runRender(home, sampleReport());
  const out2 = runRender(home, sampleReport({ overallScore: 75, overallGrade: "A", generatedAt: "2026-07-07T12:00:00.000Z" }));
  const html = fs.readFileSync(out2, "utf8");
  const embedded = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const report = JSON.parse(embedded.replace(/<\\\/script/g, "</script"));
  assert.equal(report.history.length, 1, "previous run present");
  assert.equal(report.delta.overall, 7, "75 - 68");
  const historyLines = fs.readFileSync(path.join(home.radarHome, "history.jsonl"), "utf8").trim().split("\n");
  assert.equal(historyLines.length, 2);
});

test("template inline script compiles", () => {
  const html = fs.readFileSync(TEMPLATE, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const [, code] of scripts) {
    assert.doesNotThrow(() => new vm.Script(code));
  }
});
