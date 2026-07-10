#!/usr/bin/env node
// Merge model-authored analysis with deterministic facts and scoring.
// Usage: node finalize-report.mjs <facts-json-path> <analysis-json-path>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clamp,
  cleanupOldFiles,
  loadRubric,
  makeFilePrivate,
  RADAR_HOME,
  writeFilePrivate
} from "./lib.mjs";
import { selectTriggeredRecipes } from "./recipe-triggers.mjs";
import {
  computeCategoryScores,
  computeOverallScore,
  gradeForScore,
  validateAnalysis,
  validateFactsContract,
  validateFinalReport
} from "./report-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, "..");
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (positional.length < 2) {
  console.error("Usage: node finalize-report.mjs <facts-json-path> <analysis-json-path>");
  process.exit(2);
}

const [factsPath, analysisPath] = positional;
privatizeRadarInput(factsPath);
privatizeRadarInput(analysisPath);
const facts = readJson(factsPath, "facts");
const analysis = readJson(analysisPath, "analysis");
const rubric = loadRubric(skillDir);
const factsValidation = validateFactsContract(facts, rubric);
if (factsValidation.errors.length) fail(factsValidation.errors.join("; "));
facts.computedBaselines = factsValidation.recomputedBaselines;
const triggeredRecipes = selectTriggeredRecipes(rubric, facts);
const analysisValidation = validateAnalysis(analysis, { facts, rubric, triggeredRecipes });

if (analysisValidation.errors.length) {
  printValidationFailure("Analysis JSON", analysisPath, analysisValidation.errors);
}

const adjustmentById = new Map(
  analysis.adjustments.map((entry) => [entry.id, entry])
);
const evidenceById = buildEvidenceIndex(facts);
const dimensions = rubric.dimensionOrder.map((id) => {
  const definition = rubric.dimensions[id];
  const computed = facts.computedBaselines[id];
  if (!computed.applicable) {
    return {
      id,
      category: definition.category,
      name: definition.name,
      description: definition.description,
      applicable: false,
      score: null,
      grade: null,
      formulaBaseline: null,
      startingScore: null,
      baseline: null,
      adjustment: 0,
      reasoning: bilingualReason(computed.naReason),
      evidenceRefs: [],
      evidence: []
    };
  }

  const authored = adjustmentById.get(id);
  const score = Math.round(clamp(computed.confidenceScaled + authored.adjustment));
  return {
    id,
    category: definition.category,
    name: definition.name,
    description: definition.description,
    applicable: true,
    score,
    grade: gradeForScore(score, rubric.grades),
    formulaBaseline: computed.baseline,
    startingScore: computed.confidenceScaled,
    baseline: computed.confidenceScaled,
    adjustment: authored.adjustment,
    reasoning: authored.reasoning,
    evidenceRefs: authored.evidenceRefs,
    evidence: authored.evidenceRefs.map((ref) => evidenceById.get(ref)).filter(Boolean)
  };
});

const categoryScores = computeCategoryScores(dimensions, rubric);
const overallScore = computeOverallScore(categoryScores, facts.projectProfile.categoryWeights);
const report = {
  schemaVersion: "3.0",
  project: facts.project.displayName,
  projectCwd: facts.project.cwd,
  generatedAt: new Date().toISOString(),
  language: facts.dominantLanguage,
  privacyMode: facts.privacyMode || "standard",
  insight: analysis.insight,
  profile: {
    type: facts.projectProfile.type,
    label: facts.projectProfile.label,
    rationale: facts.projectProfile.rationale,
    automationShare: facts.projectProfile.automationShare,
    sessionCount: facts.project.sessionCount,
    subagentSessionsExcluded: facts.subagentActivity.sessionCount,
    dateRange: [facts.project.firstActiveAt, facts.project.lastActiveAt],
    humanMessages: facts.stats.humanMessages,
    confidence: facts.confidenceLevel,
    categoryWeights: facts.projectProfile.categoryWeights
  },
  overallScore,
  overallGrade: gradeForScore(overallScore, rubric.grades),
  categoryScores,
  dimensions,
  toolcraftDetails: facts.toolcraftSummary,
  modernTools: facts.modernToolSummary,
  projectAssets: facts.projectAssets,
  subagentActivity: facts.subagentActivity,
  parserWarnings: facts.parserWarnings,
  evidenceAtoms: facts.evidenceAtoms,
  episodes: facts.workflowEpisodes,
  incidents: facts.criticalIncidents,
  diagnosis: analysis.diagnosis,
  highlights: analysis.highlights,
  observations: analysis.observations,
  suggestions: analysis.suggestions.map(normalizeSuggestion),
  agentsMdDraft: analysis.agentsMdDraft ?? null,
  triggeredRecipeIds: triggeredRecipes.map((recipe) => recipe.id),
  schemaWarnings: analysisValidation.warnings
};

const reportValidation = validateFinalReport(report, rubric);
if (reportValidation.errors.length) {
  printValidationFailure("Final report", "<assembled in memory>", reportValidation.errors);
}
report.schemaWarnings = [...new Set(reportValidation.warnings)];

const tempDir = path.join(RADAR_HOME, "temp");
cleanupOldFiles(tempDir, {
  prefixes: ["codex-facts-", "codex-model-input-", "codex-analysis-", "codex-report-"]
});
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(tempDir, `codex-report-${stamp}.json`);
writeFilePrivate(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log(JSON.stringify({
  reportPath,
  project: report.project,
  overallScore: report.overallScore,
  overallGrade: report.overallGrade,
  categoryScores: report.categoryScores,
  warnings: report.schemaWarnings
}, null, 2));

function normalizeSuggestion(suggestion) {
  return {
    recipeId: suggestion.recipeId || null,
    type: suggestion.type,
    dimensionId: suggestion.dimensionId,
    priority: suggestion.priority,
    title: suggestion.title,
    summary: suggestion.summary,
    body: suggestion.body,
    evidence: suggestion.evidence,
    evidenceRefs: suggestion.evidenceRefs,
    promptRewrite: suggestion.promptRewrite ?? null,
    steps: suggestion.steps ?? null,
    snippet: suggestion.snippet ?? null,
    verifyBy: suggestion.verifyBy,
    expectedImpact: suggestion.expectedImpact
  };
}

function privatizeRadarInput(filePath) {
  const resolved = path.resolve(filePath);
  const radarRoot = path.resolve(RADAR_HOME);
  const relative = path.relative(radarRoot, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    makeFilePrivate(resolved);
  }
}

function buildEvidenceIndex(factsValue) {
  const index = new Map();
  for (const atom of factsValue.evidenceAtoms || []) {
    index.set(atom.id, `${atom.id}: ${atom.snippet}`);
  }
  for (const incident of factsValue.criticalIncidents || []) {
    index.set(incident.id, `${incident.id}: ${incident.summary}`);
  }
  for (const episode of factsValue.workflowEpisodes || []) {
    const label = episode.threadName || episode.startedAt || episode.sessionId;
    index.set(
      episode.sessionId,
      `${episode.sessionId}: ${label}; ${episode.edits} edits, ${episode.toolCalls} tools, ${episode.aborts} aborts`
    );
  }
  return index;
}

function bilingualReason(reason) {
  if (
    reason
    && typeof reason === "object"
    && typeof reason.en === "string"
    && typeof reason.zh === "string"
  ) {
    return reason;
  }
  return {
    en: reason || "Not applicable for this project profile.",
    zh: "此维度不适用于当前项目画像。"
  };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[codex-radar] Could not read ${label} JSON at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function printValidationFailure(label, filePath, errors) {
  console.error(`${label} failed validation:`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(`Fix ${filePath} and run finalize-report.mjs again.`);
  process.exit(1);
}

function fail(message) {
  console.error(`[codex-radar] ${message}`);
  process.exit(1);
}
