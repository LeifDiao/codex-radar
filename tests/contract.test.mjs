import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureProject } from "./helpers.mjs";
import {
  validateAnalysis,
  validateFinalReport
} from "../plugins/codex-radar/skills/analyze/scripts/report-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, "..", "plugins", "codex-radar", "skills", "analyze", "scripts");
const PARSER = path.join(SCRIPTS, "parse-codex-project.mjs");
const PREPARE = path.join(SCRIPTS, "prepare-model-input.mjs");
const FINALIZE = path.join(SCRIPTS, "finalize-report.mjs");
const RENDER = path.join(SCRIPTS, "render-report.mjs");
const RUBRIC = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "..",
  "plugins",
  "codex-radar",
  "data",
  "rubric.json"
), "utf8"));

function runJson(script, args, env) {
  return JSON.parse(execFileSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  }));
}

function bilingual(text) {
  return { en: text, zh: `中：${text}` };
}

function validAnalysis(modelInput) {
  const firstRef = modelInput.evidenceRefIds[0];
  const dimensions = modelInput.dimensions.map((dimension) => dimension.id);
  const recipeById = new Map(
    modelInput.triggeredSuggestionRecipes.map((recipe) => [recipe.id, recipe])
  );
  const steps = (prefix, count) => Array.from({ length: count }, (_, index) => (
    bilingual(`${prefix} ${index + 1}`)
  ));
  const draftLines = [
    "# AGENTS.md",
    "## Scope",
    "- Applies to this repository.",
    "## Commands",
    "- Run npm test before completion.",
    "## Workflow",
    ...Array.from({ length: 25 }, (_, index) => `- Project rule ${index + 1}.`),
    "## Verification",
    "- Report the command result."
  ];
  return {
    schemaVersion: "analysis-1",
    adjustments: modelInput.dimensions
      .filter((dimension) => dimension.applicable)
      .map((dimension) => ({
        id: dimension.id,
        adjustment: 0,
        reasoning: bilingual(`Observed behavior for ${dimension.id}.`),
        evidenceRefs: []
      })),
    insight: bilingual("Clear asks need the same discipline at verification time."),
    diagnosis: {
      collaborationProfile: bilingual("The user gives concrete implementation directions and expects visible outcomes."),
      coreDiagnosis: bilingual("The strongest pattern is precise targeting; the main cost is inconsistent durable setup."),
      crossDimensionReading: bilingual("Strong direction combines with weaker project scaffolding.")
    },
    highlights: {
      strength: { dimensionId: "lock_on", headline: bilingual("Requests usually name the intended change.") },
      bottleneck: { dimensionId: "proof_check", headline: bilingual("Verification is less consistent than targeting.") }
    },
    observations: Array.from({ length: 8 }, (_, index) => ({
      text: bilingual(`Evidence-backed observation ${index + 1}.`),
      dimensionId: dimensions[index % dimensions.length],
      evidenceRefs: [firstRef]
    })),
    suggestions: [
      {
        recipeId: recipeById.get("architecture-create-agents-md")?.id || null,
        type: "setup_action",
        dimensionId: "architecture",
        priority: "high",
        title: bilingual("Persist project rules"),
        summary: bilingual("Create AGENTS.md from the observed repository workflow."),
        body: bilingual("Repeated setup should become durable project guidance."),
        evidence: bilingual("The project has no AGENTS.md."),
        evidenceRefs: [firstRef],
        snippet: "# AGENTS.md\n\n## Commands\n- npm test",
        verifyBy: bilingual("projectAssets.hasAgentsMd == true"),
        expectedImpact: bilingual("Higher Architecture consistency")
      },
      {
        recipeId: recipeById.get("scene-setting-three-line-opening")?.id || null,
        type: "workflow_habit",
        dimensionId: "scene_setting",
        priority: "high",
        title: bilingual("Open with context"),
        summary: bilingual("Start with change, target, and location."),
        body: bilingual("A consistent opening reduces project rediscovery."),
        evidence: bilingual("Opening messages carry limited project data."),
        evidenceRefs: [firstRef],
        steps: steps("Opening step", 3),
        verifyBy: bilingual("opening.codeOrData increases"),
        expectedImpact: bilingual("Higher Scene Setting")
      },
      {
        recipeId: null,
        type: "verification_loop",
        dimensionId: "proof_check",
        priority: "high",
        title: bilingual("Close with proof"),
        summary: bilingual("End implementation work with a real verification command."),
        body: bilingual("A passing command makes completion observable."),
        evidence: bilingual("The sessions include executable proof commands."),
        evidenceRefs: [firstRef],
        promptRewrite: bilingual("Run npm test and report the result before finishing."),
        verifyBy: bilingual("proofCommands.passed increases"),
        expectedImpact: bilingual("More reliable completion")
      },
      {
        recipeId: recipeById.get("tempo-break-retry-loop")?.id || null,
        type: "workflow_habit",
        dimensionId: "tempo",
        priority: "medium",
        title: bilingual("Use milestone handoffs"),
        summary: bilingual("Bank state before a long session loses context."),
        body: bilingual("A short handoff keeps follow-up work focused."),
        evidence: bilingual("The report tracks session completion and context pressure."),
        evidenceRefs: [firstRef],
        steps: steps("Workflow step", 3),
        verifyBy: bilingual("context compactions do not increase"),
        expectedImpact: bilingual("Steadier Tempo")
      },
      {
        recipeId: recipeById.get("completion-bank-state")?.id || null,
        type: "workflow_habit",
        dimensionId: "completion",
        priority: "medium",
        title: bilingual("Bank unfinished state"),
        summary: bilingual("Record progress before abandoning a turn."),
        body: bilingual("A short handoff keeps incomplete work recoverable."),
        evidence: bilingual("The fixture includes an aborted turn."),
        evidenceRefs: [firstRef],
        steps: steps("Handoff step", 3),
        verifyBy: bilingual("silentDrops and turnAborts decrease"),
        expectedImpact: bilingual("Higher Completion")
      },
      {
        recipeId: null,
        type: "tool_adoption",
        dimensionId: "toolcraft",
        priority: "low",
        title: bilingual("Reuse tool context"),
        summary: bilingual("Use the available structured tools consistently."),
        body: bilingual("Tool reuse reduces repeated discovery."),
        evidence: bilingual("Tool calls are already present in the workflow."),
        evidenceRefs: [firstRef],
        steps: steps("Tool step", 2),
        verifyBy: bilingual("tool failures decrease"),
        expectedImpact: bilingual("Cleaner Toolcraft")
      },
      {
        recipeId: null,
        type: "prompt_rewrite",
        dimensionId: "lock_on",
        priority: "low",
        title: bilingual("Name the target"),
        summary: bilingual("Keep naming the exact file and expected behavior."),
        body: bilingual("The existing precision should be made consistent."),
        evidence: bilingual("A session names src/app.js and the required behavior."),
        evidenceRefs: [firstRef],
        promptRewrite: bilingual("Update src/app.js: keep the interface stable and return null."),
        verifyBy: bilingual("filePath and constraint ratios stay high"),
        expectedImpact: bilingual("More consistent Lock-On")
      }
    ],
    agentsMdDraft: draftLines.join("\n")
  };
}

test("model-input → analysis → deterministic report → HTML", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd, "--privacy", "standard"], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  assert.match(modelInput.analysisContract.agentsMdDraft, /^Optional/);
  const analysis = validAnalysis(modelInput);
  fs.writeFileSync(prepared.analysisPath, JSON.stringify(analysis, null, 2));
  if (process.platform !== "win32") fs.chmodSync(prepared.analysisPath, 0o644);

  const finalized = runJson(FINALIZE, [parsed.factsPath, prepared.analysisPath], env);
  const report = JSON.parse(fs.readFileSync(finalized.reportPath, "utf8"));
  assert.equal(report.schemaVersion, "3.0");
  assert.equal(report.dimensions.length, 9);
  assert.equal(report.dimensions[0].formulaBaseline, modelInput.dimensions[0].formulaBaseline);
  assert.equal(report.dimensions[0].startingScore, modelInput.dimensions[0].startingScore);
  assert.equal(report.dimensions[0].score, report.dimensions[0].startingScore);
  assert.equal(report.suggestions.length, 7);
  assert.ok(report.triggeredRecipeIds.includes("scene-setting-three-line-opening"));
  assert.ok(!report.triggeredRecipeIds.includes("architecture-create-agents-md"));
  assert.ok(!report.triggeredRecipeIds.includes("tempo-break-retry-loop"));
  assert.ok(!report.triggeredRecipeIds.includes("completion-bank-state"));

  const htmlPath = execFileSync("node", [RENDER, finalized.reportPath, "--no-open"], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  }).trim();
  assert.ok(fs.existsSync(htmlPath));
  assert.match(fs.readFileSync(htmlPath, "utf8"), /"schemaVersion":"3.0"/);

  if (process.platform !== "win32") {
    for (const filePath of [parsed.factsPath, prepared.modelInputPath, prepared.analysisPath, finalized.reportPath, htmlPath]) {
      assert.equal(fs.statSync(filePath).mode & 0o777, 0o600, filePath);
    }
  }
});

test("strict privacy facts finalize into a contract-valid report", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd, "--privacy", "strict"], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  fs.writeFileSync(prepared.analysisPath, JSON.stringify(validAnalysis(modelInput), null, 2));

  const finalized = runJson(FINALIZE, [parsed.factsPath, prepared.analysisPath], env);
  const report = JSON.parse(fs.readFileSync(finalized.reportPath, "utf8"));
  const validation = validateFinalReport(report, RUBRIC);
  assert.deepEqual(validation.errors, []);
  assert.equal(report.privacyMode, "strict");
  assert.ok(report.evidenceAtoms.every((atom) => atom.snippet.includes("omitted in strict mode")));
  assert.ok(report.episodes.every((episode) => (
    episode.threadName === null
    && episode.firstUserMessage === null
    && episode.lastAgentMessage === null
  )));
  assert.deepEqual(report.modernTools.web.topQueries, []);
});

test("finalizer rejects an adjustment outside the confidence cap", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  const analysis = validAnalysis(modelInput);
  analysis.adjustments[0].adjustment = modelInput.adjustmentCap + 1;
  analysis.adjustments[0].evidenceRefs = [modelInput.evidenceRefIds[0]];
  fs.writeFileSync(prepared.analysisPath, JSON.stringify(analysis, null, 2));

  assert.throws(
    () => execFileSync("node", [FINALIZE, parsed.factsPath, prepared.analysisPath], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    }),
    (error) => /must be within/.test(String(error.stderr))
  );
});

test("finalizer does not chmod analysis files outside CODEX_RADAR_HOME", () => {
  if (process.platform === "win32") return;
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  const externalAnalysisPath = path.join(fixture.root, "external-analysis.json");
  fs.writeFileSync(externalAnalysisPath, JSON.stringify(validAnalysis(modelInput), null, 2));
  fs.chmodSync(externalAnalysisPath, 0o644);

  runJson(FINALIZE, [parsed.factsPath, externalAnalysisPath], env);
  assert.equal(fs.statSync(externalAnalysisPath).mode & 0o777, 0o644);
});

test("3.0 validation rejects profile-weight and N/A tampering", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  fs.writeFileSync(prepared.analysisPath, JSON.stringify(validAnalysis(modelInput), null, 2));
  const finalized = runJson(FINALIZE, [parsed.factsPath, prepared.analysisPath], env);
  const report = JSON.parse(fs.readFileSync(finalized.reportPath, "utf8"));

  report.profile.categoryWeights.communication = 0.99;
  let validation = validateFinalReport(report, RUBRIC);
  assert.ok(validation.errors.some((error) => error.includes("profile.categoryWeights.communication")));

  report.profile.categoryWeights = { ...RUBRIC.profiles[report.profile.type].categoryWeights };
  const dimension = report.dimensions[0];
  dimension.applicable = false;
  dimension.score = null;
  dimension.grade = null;
  validation = validateFinalReport(report, RUBRIC);
  assert.ok(validation.errors.some((error) => error.includes("N/A formulaBaseline must be null")));
});

test("prepare-model-input rejects facts from a stale formula version", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const facts = JSON.parse(fs.readFileSync(parsed.factsPath, "utf8"));
  facts.formulaVersion = "2.2";
  const staleFactsPath = path.join(fixture.root, "stale-facts.json");
  fs.writeFileSync(staleFactsPath, JSON.stringify(facts));

  assert.throws(
    () => execFileSync("node", [PREPARE, staleFactsPath], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    }),
    (error) => /does not match executable formulaVersion/.test(String(error.stderr))
  );
});

test("prepare-model-input rejects tampered computed baselines", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const facts = JSON.parse(fs.readFileSync(parsed.factsPath, "utf8"));
  facts.computedBaselines.lock_on.confidenceScaled = 100;
  const tamperedFactsPath = path.join(fixture.root, "tampered-facts.json");
  fs.writeFileSync(tamperedFactsPath, JSON.stringify(facts));

  assert.throws(
    () => execFileSync("node", [PREPARE, tamperedFactsPath], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    }),
    (error) => /computedBaselines\.lock_on does not match deterministic scoring/.test(String(error.stderr))
  );
});

test("prepare-model-input rejects raw evidence relabeled as strict", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd, "--privacy", "standard"], env);
  const facts = JSON.parse(fs.readFileSync(parsed.factsPath, "utf8"));
  facts.privacyMode = "strict";
  const tamperedFactsPath = path.join(fixture.root, "strict-with-raw-evidence.json");
  fs.writeFileSync(tamperedFactsPath, JSON.stringify(facts));

  assert.throws(
    () => execFileSync("node", [PREPARE, tamperedFactsPath], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    }),
    (error) => /must be omitted in strict mode/.test(String(error.stderr))
  );
});

test("contract validators return errors for malformed containers", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const facts = JSON.parse(fs.readFileSync(parsed.factsPath, "utf8"));

  assert.doesNotThrow(() => {
    const validation = validateAnalysis({
      schemaVersion: "analysis-1",
      adjustments: {},
      observations: {},
      suggestions: {}
    }, { facts, rubric: RUBRIC, triggeredRecipes: [] });
    assert.ok(validation.errors.includes("adjustments must be an array"));
  });

  assert.doesNotThrow(() => {
    const validation = validateFinalReport({
      schemaVersion: "3.0",
      schemaWarnings: 7,
      evidenceAtoms: {},
      incidents: {},
      episodes: {},
      dimensions: {},
      observations: {},
      suggestions: {},
      triggeredRecipeIds: 7
    }, RUBRIC);
    assert.ok(validation.errors.includes("schemaWarnings must be an array"));
    assert.ok(validation.errors.includes("dimensions length is invalid"));
  });
});

test("3.0 validation rejects strict-mode leaks and malformed metadata arrays", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  fs.writeFileSync(prepared.analysisPath, JSON.stringify(validAnalysis(modelInput), null, 2));
  const finalized = runJson(FINALIZE, [parsed.factsPath, prepared.analysisPath], env);
  const report = JSON.parse(fs.readFileSync(finalized.reportPath, "utf8"));

  report.privacyMode = "strict";
  report.schemaWarnings = ["valid warning", { message: "not a string" }];
  report.parserWarnings = ["valid warning", 7];
  report.triggeredRecipeIds = [
    report.triggeredRecipeIds[0],
    report.triggeredRecipeIds[0]
  ];
  report.episodes[0].threadName = "private thread title";
  report.episodes[0].firstUserMessage = "private opening message";
  report.episodes[0].lastAgentMessage = "private closing message";
  report.modernTools.web.topQueries = ["private search query"];

  const validation = validateFinalReport(report, RUBRIC);
  assert.ok(validation.errors.includes("schemaWarnings entries must be strings"));
  assert.ok(validation.errors.includes("parserWarnings entries must be strings"));
  assert.ok(validation.errors.includes("triggeredRecipeIds must not contain duplicates"));
  assert.ok(validation.errors.some((error) => error.includes("snippet must be omitted in strict mode")));
  assert.ok(validation.errors.some((error) => error.includes("threadName must be null in strict mode")));
  assert.ok(validation.errors.includes("modernTools.web.topQueries must be empty in strict mode"));
});

test("recipe declarations must match the triggered dimension and type", () => {
  const fixture = buildFixtureProject();
  const env = { CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome };
  const parsed = runJson(PARSER, [fixture.projectCwd], env);
  const prepared = runJson(PREPARE, [parsed.factsPath], env);
  const facts = JSON.parse(fs.readFileSync(parsed.factsPath, "utf8"));
  const modelInput = JSON.parse(fs.readFileSync(prepared.modelInputPath, "utf8"));
  const analysis = validAnalysis(modelInput);
  const suggestion = analysis.suggestions.find(
    (entry) => entry.recipeId === "scene-setting-three-line-opening"
  );
  suggestion.dimensionId = "lock_on";
  suggestion.type = "prompt_rewrite";
  suggestion.promptRewrite = bilingual("Use a precise target.");

  const validation = validateAnalysis(analysis, {
    facts,
    rubric: RUBRIC,
    triggeredRecipes: modelInput.triggeredSuggestionRecipes
  });
  assert.ok(validation.errors.some((error) => error.includes("dimensionId must match recipe")));
  assert.ok(validation.errors.some((error) => error.includes("type must match recipe")));
});
