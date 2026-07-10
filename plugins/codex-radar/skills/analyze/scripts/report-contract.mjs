import { clamp } from "./lib.mjs";
import { computeBaselines, FORMULA_VERSION } from "./scoring.mjs";

const SUGGESTION_TYPES = new Set([
  "prompt_rewrite",
  "workflow_habit",
  "setup_action",
  "tool_adoption",
  "verification_loop"
]);
const PRIORITIES = new Set(["high", "medium", "low"]);
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const LEGACY_REPORT_SCHEMAS = new Set(["2.1", "2.2"]);
const INCIDENT_TYPES = new Set([
  "command_retry_churn",
  "correction",
  "aborted_turns",
  "context_pressure"
]);

export function validateFactsContract(facts, rubric) {
  const errors = [];
  const evidenceAtoms = Array.isArray(facts?.evidenceAtoms) ? facts.evidenceAtoms : [];
  const workflowEpisodes = Array.isArray(facts?.workflowEpisodes) ? facts.workflowEpisodes : [];
  const criticalIncidents = Array.isArray(facts?.criticalIncidents) ? facts.criticalIncidents : [];
  const keyMessages = Array.isArray(facts?.keyMessages) ? facts.keyMessages : [];
  const sessionFlows = Array.isArray(facts?.sessionFlows) ? facts.sessionFlows : [];
  const parserWarnings = Array.isArray(facts?.parserWarnings) ? facts.parserWarnings : [];
  require(errors, facts?.schemaVersion === "facts-2.1", `Unsupported facts schemaVersion: ${facts?.schemaVersion || "missing"}`);
  require(
    errors,
    facts?.formulaVersion === FORMULA_VERSION,
    `Facts formulaVersion ${facts?.formulaVersion || "missing"} does not match executable formulaVersion ${FORMULA_VERSION}`
  );
  require(
    errors,
    rubric?.scoring?.formulaVersion === FORMULA_VERSION,
    `Rubric formulaVersion ${rubric?.scoring?.formulaVersion || "missing"} does not match executable formulaVersion ${FORMULA_VERSION}`
  );
  require(errors, isPlainObject(facts?.computedBaselines), "Facts JSON is missing computedBaselines");
  require(errors, isPlainObject(facts?.projectProfile), "Facts JSON is missing projectProfile");
  require(errors, facts?.privacyMode === "standard" || facts?.privacyMode === "strict", "Facts privacyMode is invalid");
  require(errors, Array.isArray(facts?.evidenceAtoms), "Facts evidenceAtoms must be an array");
  require(errors, Array.isArray(facts?.workflowEpisodes), "Facts workflowEpisodes must be an array");
  require(errors, Array.isArray(facts?.criticalIncidents), "Facts criticalIncidents must be an array");
  require(errors, Array.isArray(facts?.keyMessages), "Facts keyMessages must be an array");
  require(errors, Array.isArray(facts?.sessionFlows), "Facts sessionFlows must be an array");
  require(errors, Array.isArray(facts?.parserWarnings), "Facts parserWarnings must be an array");
  require(
    errors,
    parserWarnings.every((warning) => typeof warning === "string"),
    "Facts parserWarnings entries must be strings"
  );
  validateEvidenceContainers(errors, {
    evidenceAtoms,
    incidents: criticalIncidents,
    episodes: workflowEpisodes,
    atomLabel: "Facts evidenceAtoms",
    incidentLabel: "Facts criticalIncidents",
    episodeLabel: "Facts workflowEpisodes"
  });
  if (facts?.privacyMode === "strict") {
    validateStrictPrivacy(errors, {
      evidenceAtoms,
      incidents: criticalIncidents,
      episodes: workflowEpisodes,
      topQueries: facts?.modernToolSummary?.web?.topQueries,
      atomLabel: "Facts evidenceAtoms",
      incidentLabel: "Facts criticalIncidents",
      episodeLabel: "Facts workflowEpisodes",
      queryLabel: "Facts modernToolSummary.web.topQueries"
    });
    for (const [index, message] of keyMessages.entries()) {
      require(
        errors,
        isStrictOmissionSnippet(message?.text),
        `Facts keyMessages[${index}].text must be omitted in strict mode`
      );
    }
    for (const [index, flow] of sessionFlows.entries()) {
      require(
        errors,
        flow?.threadName === null,
        `Facts sessionFlows[${index}].threadName must be null in strict mode`
      );
    }
  }

  const profileDefinition = rubric?.profiles?.[facts?.projectProfile?.type];
  require(errors, Boolean(profileDefinition), `Unknown project profile: ${facts?.projectProfile?.type || "missing"}`);
  for (const category of Object.keys(rubric?.categories || {})) {
    require(
      errors,
      facts?.projectProfile?.categoryWeights?.[category] === profileDefinition?.categoryWeights?.[category],
      `projectProfile.categoryWeights.${category} does not match projectProfile.type`
    );
  }
  if (profileDefinition) {
    const expectedNa = new Set(profileDefinition.naDimensions || []);
    if (!facts?.projectAssets?.cwdResolved) expectedNa.add("architecture");
    const actualNa = new Set(Array.isArray(facts?.projectProfile?.naDimensions) ? facts.projectProfile.naDimensions : []);
    require(
      errors,
      [...expectedNa].every((id) => actualNa.has(id))
        && [...actualNa].every((id) => expectedNa.has(id)),
      "projectProfile.naDimensions does not match projectProfile.type and project assets"
    );
  }

  let recomputedBaselines = null;
  if (!errors.length) {
    try {
      recomputedBaselines = computeBaselines(facts);
      for (const id of rubric.dimensionOrder || []) {
        require(
          errors,
          JSON.stringify(facts.computedBaselines?.[id]) === JSON.stringify(recomputedBaselines[id]),
          `computedBaselines.${id} does not match deterministic scoring`
        );
      }
    } catch (error) {
      errors.push(`Could not recompute deterministic baselines: ${error.message}`);
    }
  }
  return { errors, recomputedBaselines };
}

export function validateAnalysis(analysis, { facts, rubric, triggeredRecipes = [] }) {
  const errors = [];
  const warnings = [];
  const dimensionIds = new Set(rubric.dimensionOrder || []);
  const applicableIds = new Set(
    [...dimensionIds].filter((id) => facts.computedBaselines?.[id]?.applicable)
  );
  const evidenceIds = evidenceIdSet(facts);
  const safeTriggeredRecipes = Array.isArray(triggeredRecipes) ? triggeredRecipes : [];
  const recipesById = new Map(safeTriggeredRecipes.map((recipe) => [recipe.id, recipe]));
  const adjustments = Array.isArray(analysis?.adjustments) ? analysis.adjustments : [];
  const observations = Array.isArray(analysis?.observations) ? analysis.observations : [];
  const suggestions = Array.isArray(analysis?.suggestions) ? analysis.suggestions : [];

  require(errors, analysis?.schemaVersion === "analysis-1", "schemaVersion must be 'analysis-1'");
  require(errors, Array.isArray(analysis?.adjustments), "adjustments must be an array");

  const adjustmentIds = new Set();
  for (const [index, entry] of adjustments.entries()) {
    const label = `adjustments[${index}]`;
    require(errors, dimensionIds.has(entry?.id), `${label}.id must be a valid dimension id`);
    if (adjustmentIds.has(entry?.id)) errors.push(`${label}.id is duplicated: ${entry?.id}`);
    adjustmentIds.add(entry?.id);
    require(errors, applicableIds.has(entry?.id), `${label} must target an applicable dimension`);
    require(errors, Number.isInteger(entry?.adjustment), `${label}.adjustment must be an integer`);
    const cap = rubric.scoring?.adjustmentRange?.[facts.confidenceLevel];
    require(
      errors,
      Number.isInteger(entry?.adjustment) && Math.abs(entry.adjustment) <= cap,
      `${label}.adjustment must be within ±${cap}`
    );
    requireBilingual(errors, entry?.reasoning, `${label}.reasoning`);
    requireEvidenceRefs(errors, entry?.evidenceRefs, `${label}.evidenceRefs`, evidenceIds, entry?.adjustment !== 0);
  }
  for (const id of applicableIds) {
    if (!adjustmentIds.has(id)) errors.push(`Missing adjustment entry for applicable dimension: ${id}`);
  }

  requireBilingual(errors, analysis?.insight, "insight");
  requireBilingual(errors, analysis?.diagnosis?.collaborationProfile, "diagnosis.collaborationProfile");
  requireBilingual(errors, analysis?.diagnosis?.coreDiagnosis, "diagnosis.coreDiagnosis");
  requireBilingual(errors, analysis?.diagnosis?.crossDimensionReading, "diagnosis.crossDimensionReading");

  for (const key of ["strength", "bottleneck"]) {
    const highlight = analysis?.highlights?.[key];
    require(errors, dimensionIds.has(highlight?.dimensionId), `highlights.${key}.dimensionId must be valid`);
    require(errors, applicableIds.has(highlight?.dimensionId), `highlights.${key}.dimensionId must be applicable`);
    requireBilingual(errors, highlight?.headline, `highlights.${key}.headline`);
  }

  require(
    errors,
    Array.isArray(analysis?.observations) && observations.length >= 8 && observations.length <= 12,
    "observations must contain 8-12 entries"
  );
  for (const [index, observation] of observations.entries()) {
    const label = `observations[${index}]`;
    requireBilingual(errors, observation?.text, `${label}.text`);
    require(errors, dimensionIds.has(observation?.dimensionId), `${label}.dimensionId must be valid`);
    requireEvidenceRefs(errors, observation?.evidenceRefs, `${label}.evidenceRefs`, evidenceIds, true);
  }

  require(
    errors,
    Array.isArray(analysis?.suggestions) && suggestions.length >= 5 && suggestions.length <= 7,
    "suggestions must contain 5-7 entries"
  );
  let previousPriority = -1;
  const usedRecipeIds = new Set();
  for (const [index, suggestion] of suggestions.entries()) {
    const label = `suggestions[${index}]`;
    require(errors, SUGGESTION_TYPES.has(suggestion?.type), `${label}.type is invalid`);
    require(errors, dimensionIds.has(suggestion?.dimensionId), `${label}.dimensionId must be valid`);
    require(errors, PRIORITIES.has(suggestion?.priority), `${label}.priority is invalid`);
    if (PRIORITIES.has(suggestion?.priority)) {
      const rank = PRIORITY_RANK[suggestion.priority];
      require(errors, rank >= previousPriority, "suggestions must be sorted high → medium → low");
      previousPriority = rank;
    }
    requireBilingual(errors, suggestion?.title, `${label}.title`);
    requireBilingual(errors, suggestion?.summary, `${label}.summary`);
    requireBilingual(errors, suggestion?.body, `${label}.body`);
    requireBilingual(errors, suggestion?.evidence, `${label}.evidence`);
    requireBilingual(errors, suggestion?.verifyBy, `${label}.verifyBy`);
    requireBilingual(errors, suggestion?.expectedImpact, `${label}.expectedImpact`);
    requireEvidenceRefs(errors, suggestion?.evidenceRefs, `${label}.evidenceRefs`, evidenceIds, true);
    if (suggestion?.recipeId != null) {
      const recipe = recipesById.get(suggestion.recipeId);
      require(errors, Boolean(recipe), `${label}.recipeId did not trigger: ${suggestion.recipeId}`);
      require(errors, !usedRecipeIds.has(suggestion.recipeId), `${label}.recipeId is duplicated: ${suggestion.recipeId}`);
      usedRecipeIds.add(suggestion.recipeId);
      if (recipe) {
        require(
          errors,
          suggestion.dimensionId === recipe.dimensionId,
          `${label}.dimensionId must match recipe ${suggestion.recipeId}`
        );
        require(
          errors,
          suggestion.type === recipe.suggestionType,
          `${label}.type must match recipe ${suggestion.recipeId}`
        );
      }
    }
    validateSuggestionPayload(errors, suggestion, label);
    for (const language of ["en", "zh"]) {
      const title = suggestion?.title?.[language];
      if (typeof title === "string" && title.length > 24) {
        warnings.push(`${label}.title.${language} is longer than 24 characters`);
      }
    }
  }
  const requiredRecipes = safeTriggeredRecipes.slice(0, 7);
  for (const recipe of requiredRecipes) {
    require(errors, usedRecipeIds.has(recipe.id), `Missing suggestion for triggered recipe: ${recipe.id}`);
  }
  if (safeTriggeredRecipes.length > requiredRecipes.length) {
    warnings.push(
      `${safeTriggeredRecipes.length} recipes triggered; the first ${requiredRecipes.length} are required by the 7-suggestion cap`
    );
  }

  const draftRequired = agentsDraftRequired(facts);
  if (draftRequired) {
    require(errors, typeof analysis?.agentsMdDraft === "string", "agentsMdDraft is required for this project");
    if (typeof analysis?.agentsMdDraft === "string") {
      const lines = nonEmptyLines(analysis.agentsMdDraft);
      require(errors, lines >= 30 && lines <= 60, "agentsMdDraft must contain 30-60 non-empty lines");
    }
  } else if (analysis?.agentsMdDraft != null) {
    require(errors, typeof analysis.agentsMdDraft === "string", "agentsMdDraft must be a string or null");
  }

  return { errors, warnings };
}

export function validateFinalReport(report, rubric) {
  if (LEGACY_REPORT_SCHEMAS.has(report?.schemaVersion)) {
    return validateLegacyReport(report);
  }
  if (report?.schemaVersion !== "3.0") {
    return {
      errors: [`Unsupported report schemaVersion: ${report?.schemaVersion || "missing"}`],
      warnings: []
    };
  }

  const errors = [];
  const schemaWarnings = Array.isArray(report.schemaWarnings) ? report.schemaWarnings : [];
  const warnings = schemaWarnings.filter((warning) => typeof warning === "string");
  const dimensionIds = rubric.dimensionOrder || [];
  const dimensionSet = new Set(dimensionIds);
  const evidenceAtoms = Array.isArray(report.evidenceAtoms) ? report.evidenceAtoms : [];
  const incidents = Array.isArray(report.incidents) ? report.incidents : [];
  const episodes = Array.isArray(report.episodes) ? report.episodes : [];
  const dimensions = Array.isArray(report.dimensions) ? report.dimensions : [];
  const observations = Array.isArray(report.observations) ? report.observations : [];
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
  const triggeredRecipeIdList = Array.isArray(report.triggeredRecipeIds) ? report.triggeredRecipeIds : [];
  const evidenceIds = new Set([
    ...evidenceAtoms.map((entry) => entry?.id),
    ...incidents.map((entry) => entry?.id),
    ...episodes.map((entry) => entry?.sessionId)
  ].filter(Boolean));

  require(errors, report.schemaWarnings == null || Array.isArray(report.schemaWarnings), "schemaWarnings must be an array");
  require(errors, report.parserWarnings == null || Array.isArray(report.parserWarnings), "parserWarnings must be an array");
  require(
    errors,
    schemaWarnings.every((warning) => typeof warning === "string"),
    "schemaWarnings entries must be strings"
  );
  const parserWarnings = Array.isArray(report.parserWarnings) ? report.parserWarnings : [];
  require(
    errors,
    parserWarnings.every((warning) => typeof warning === "string"),
    "parserWarnings entries must be strings"
  );
  require(errors, Array.isArray(report.evidenceAtoms), "evidenceAtoms must be an array");
  require(errors, Array.isArray(report.incidents), "incidents must be an array");
  require(errors, Array.isArray(report.episodes), "episodes must be an array");
  require(errors, Array.isArray(report.triggeredRecipeIds), "triggeredRecipeIds must be an array");
  require(
    errors,
    triggeredRecipeIdList.every((recipeId) => typeof recipeId === "string" && recipeId.length > 0),
    "triggeredRecipeIds entries must be non-empty strings"
  );
  require(
    errors,
    new Set(triggeredRecipeIdList).size === triggeredRecipeIdList.length,
    "triggeredRecipeIds must not contain duplicates"
  );
  require(errors, typeof report.project === "string" && report.project.length > 0, "project is required");
  require(errors, typeof report.projectCwd === "string" && report.projectCwd.length > 0, "projectCwd is required");
  require(errors, !Number.isNaN(new Date(report.generatedAt).getTime()), "generatedAt must be an ISO-compatible date");
  require(errors, report.language === "zh" || report.language === "en", "language must be 'zh' or 'en'");
  require(errors, report.privacyMode === "standard" || report.privacyMode === "strict", "privacyMode is invalid");
  validateEvidenceContainers(errors, {
    evidenceAtoms,
    incidents,
    episodes,
    atomLabel: "evidenceAtoms",
    incidentLabel: "incidents",
    episodeLabel: "episodes"
  });
  if (report.privacyMode === "strict") {
    validateStrictPrivacy(errors, {
      evidenceAtoms,
      incidents,
      episodes,
      topQueries: report.modernTools?.web?.topQueries,
      atomLabel: "evidenceAtoms",
      incidentLabel: "incidents",
      episodeLabel: "episodes",
      queryLabel: "modernTools.web.topQueries"
    });
  }
  require(errors, Array.isArray(report.dimensions) && dimensions.length === dimensionIds.length, "dimensions length is invalid");
  const profileDefinition = rubric.profiles?.[report.profile?.type];
  const expectedNa = new Set(profileDefinition?.naDimensions || []);
  if (!report.projectAssets?.cwdResolved) expectedNa.add("architecture");
  const rubricRecipesById = recipeDefinitionsById(rubric);
  require(errors, Boolean(profileDefinition), "profile.type is invalid");
  require(errors, ["low", "medium", "high"].includes(report.profile?.confidence), "profile.confidence is invalid");
  for (const category of Object.keys(rubric.categories || {})) {
    require(
      errors,
      report.profile?.categoryWeights?.[category] === profileDefinition?.categoryWeights?.[category],
      `profile.categoryWeights.${category} does not match profile.type`
    );
  }

  const seen = new Set();
  for (const [index, dimension] of dimensions.entries()) {
    const expectedId = dimensionIds[index];
    const definition = rubric.dimensions?.[expectedId];
    require(errors, dimension?.id === expectedId, `dimensions[${index}].id must be ${expectedId}`);
    require(errors, dimensionSet.has(dimension?.id), `dimensions[${index}].id is invalid`);
    if (seen.has(dimension?.id)) errors.push(`Duplicate dimension id: ${dimension?.id}`);
    seen.add(dimension?.id);
    require(errors, dimension?.category === definition?.category, `dimension ${dimension?.id}.category is inconsistent`);
    requireBilingual(errors, dimension?.name, `dimension ${dimension?.id}.name`);
    requireBilingual(errors, dimension?.description, `dimension ${dimension?.id}.description`);
    requireBilingual(errors, dimension?.reasoning, `dimension ${dimension?.id}.reasoning`);
    require(
      errors,
      dimension?.applicable === !expectedNa.has(dimension?.id),
      `dimension ${dimension?.id}.applicable does not match the project profile`
    );
    if (dimension?.applicable === false) {
      require(errors, dimension.score === null && dimension.grade === null, `dimension ${dimension?.id} N/A score/grade must be null`);
      require(errors, dimension.formulaBaseline === null, `dimension ${dimension?.id} N/A formulaBaseline must be null`);
      require(errors, dimension.startingScore === null, `dimension ${dimension?.id} N/A startingScore must be null`);
      require(errors, dimension.baseline === null, `dimension ${dimension?.id} N/A baseline must be null`);
      require(errors, dimension.adjustment === 0, `dimension ${dimension?.id} N/A adjustment must be 0`);
      require(
        errors,
        Array.isArray(dimension.evidenceRefs) && dimension.evidenceRefs.length === 0,
        `dimension ${dimension?.id} N/A evidenceRefs must be empty`
      );
      require(
        errors,
        Array.isArray(dimension.evidence) && dimension.evidence.length === 0,
        `dimension ${dimension?.id} N/A evidence must be empty`
      );
      continue;
    }
    require(errors, dimension?.applicable === true, `dimension ${dimension?.id}.applicable must be true or false`);
    for (const field of ["formulaBaseline", "startingScore", "score"]) {
      require(
        errors,
        Number.isInteger(dimension?.[field]) && dimension[field] >= 0 && dimension[field] <= 100,
        `dimension ${dimension?.id}.${field} must be an integer from 0 to 100`
      );
    }
    const adjustmentCap = rubric.scoring?.adjustmentRange?.[report.profile?.confidence];
    require(
      errors,
      Number.isInteger(dimension?.adjustment)
        && Number.isFinite(adjustmentCap)
        && Math.abs(dimension.adjustment) <= adjustmentCap,
      `dimension ${dimension?.id}.adjustment exceeds the confidence cap`
    );
    require(
      errors,
      dimension.startingScore === confidenceScaledScore(dimension.formulaBaseline, report.profile?.confidence),
      `dimension ${dimension?.id}.startingScore does not match confidence scaling`
    );
    require(errors, dimension.baseline === dimension.startingScore, `dimension ${dimension?.id}.baseline must match startingScore`);
    require(
      errors,
      dimension.score === Math.round(clamp(dimension.startingScore + dimension.adjustment)),
      `dimension ${dimension?.id}.score does not match startingScore + adjustment`
    );
    require(
      errors,
      dimension.grade === gradeForScore(dimension.score, rubric.grades),
      `dimension ${dimension?.id}.grade does not match score`
    );
    requireEvidenceRefs(errors, dimension.evidenceRefs, `dimension ${dimension?.id}.evidenceRefs`, evidenceIds, dimension.adjustment !== 0);
    require(
      errors,
      Array.isArray(dimension.evidence) && dimension.evidence.length === dimension.evidenceRefs.length,
      `dimension ${dimension?.id}.evidence must match evidenceRefs`
    );
  }

  const expectedCategories = computeCategoryScores(dimensions, rubric);
  for (const category of Object.keys(rubric.categories || {})) {
    require(
      errors,
      report.categoryScores?.[category] === expectedCategories[category],
      `categoryScores.${category} is inconsistent`
    );
  }
  const expectedOverall = computeOverallScore(expectedCategories, profileDefinition?.categoryWeights);
  require(errors, report.overallScore === expectedOverall, "overallScore is inconsistent");
  require(errors, report.overallGrade === gradeForScore(expectedOverall, rubric.grades), "overallGrade is inconsistent");

  requireBilingual(errors, report.insight, "insight");
  requireBilingual(errors, report.diagnosis?.collaborationProfile, "diagnosis.collaborationProfile");
  requireBilingual(errors, report.diagnosis?.coreDiagnosis, "diagnosis.coreDiagnosis");
  requireBilingual(errors, report.diagnosis?.crossDimensionReading, "diagnosis.crossDimensionReading");
  for (const key of ["strength", "bottleneck"]) {
    const highlight = report.highlights?.[key];
    require(errors, dimensionSet.has(highlight?.dimensionId), `highlights.${key}.dimensionId must be valid`);
    require(
      errors,
      dimensions.find((dimension) => dimension.id === highlight?.dimensionId)?.applicable === true,
      `highlights.${key}.dimensionId must be applicable`
    );
    requireBilingual(errors, highlight?.headline, `highlights.${key}.headline`);
  }

  require(
    errors,
    Array.isArray(report.observations) && observations.length >= 8 && observations.length <= 12,
    "observations must contain 8-12 entries"
  );
  for (const [index, observation] of observations.entries()) {
    const label = `observations[${index}]`;
    requireBilingual(errors, observation?.text, `${label}.text`);
    require(errors, dimensionSet.has(observation?.dimensionId), `${label}.dimensionId must be valid`);
    requireEvidenceRefs(errors, observation?.evidenceRefs, `${label}.evidenceRefs`, evidenceIds, true);
  }

  require(
    errors,
    Array.isArray(report.suggestions) && suggestions.length >= 5 && suggestions.length <= 7,
    "suggestions must contain 5-7 entries"
  );
  const triggeredRecipeIds = new Set(triggeredRecipeIdList);
  for (const recipeId of triggeredRecipeIds) {
    require(errors, rubricRecipesById.has(recipeId), `triggeredRecipeIds contains unknown recipe: ${recipeId}`);
  }
  const seenRecipeIds = new Set();
  let previousPriority = -1;
  for (const [index, suggestion] of suggestions.entries()) {
    const label = `suggestions[${index}]`;
    require(errors, SUGGESTION_TYPES.has(suggestion?.type), `${label}.type is invalid`);
    require(errors, dimensionSet.has(suggestion?.dimensionId), `${label}.dimensionId must be valid`);
    require(errors, PRIORITIES.has(suggestion?.priority), `${label}.priority is invalid`);
    if (PRIORITIES.has(suggestion?.priority)) {
      const rank = PRIORITY_RANK[suggestion.priority];
      require(errors, rank >= previousPriority, "suggestions must be sorted high → medium → low");
      previousPriority = rank;
    }
    for (const field of ["title", "summary", "body", "evidence", "verifyBy", "expectedImpact"]) {
      requireBilingual(errors, suggestion?.[field], `${label}.${field}`);
    }
    requireEvidenceRefs(errors, suggestion?.evidenceRefs, `${label}.evidenceRefs`, evidenceIds, true);
    if (suggestion?.recipeId != null) {
      const recipe = rubricRecipesById.get(suggestion.recipeId);
      require(errors, triggeredRecipeIds.has(suggestion.recipeId), `${label}.recipeId did not trigger: ${suggestion.recipeId}`);
      require(errors, !seenRecipeIds.has(suggestion.recipeId), `${label}.recipeId is duplicated: ${suggestion.recipeId}`);
      seenRecipeIds.add(suggestion.recipeId);
      if (recipe) {
        require(
          errors,
          suggestion.dimensionId === recipe.dimensionId,
          `${label}.dimensionId must match recipe ${suggestion.recipeId}`
        );
        require(
          errors,
          suggestion.type === recipe.suggestionType,
          `${label}.type must match recipe ${suggestion.recipeId}`
        );
      }
    }
    validateSuggestionPayload(errors, suggestion, label);
  }
  for (const recipeId of triggeredRecipeIdList.slice(0, 7)) {
    require(errors, seenRecipeIds.has(recipeId), `Missing suggestion for triggered recipe: ${recipeId}`);
  }

  const draftRequired = Boolean(
    report.projectAssets?.cwdResolved
    && !report.projectAssets?.hasAgentsMd
    && report.profile?.sessionCount >= 3
    && dimensions.find((dimension) => dimension.id === "architecture")?.applicable === true
  );
  if (draftRequired) {
    require(errors, typeof report.agentsMdDraft === "string", "agentsMdDraft is required for this project");
    if (typeof report.agentsMdDraft === "string") {
      const lines = nonEmptyLines(report.agentsMdDraft);
      require(errors, lines >= 30 && lines <= 60, "agentsMdDraft must contain 30-60 non-empty lines");
    }
  } else {
    require(
      errors,
      report.agentsMdDraft == null || typeof report.agentsMdDraft === "string",
      "agentsMdDraft must be a string or null"
    );
  }

  return { errors, warnings };
}

export function gradeForScore(score, grades) {
  if (!Number.isFinite(score)) return null;
  for (const grade of grades || []) {
    if (score >= grade.range[0] && score <= grade.range[1]) return grade.letter;
  }
  return null;
}

export function computeCategoryScores(dimensions, rubric) {
  const result = {};
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];
  for (const [categoryId, category] of Object.entries(rubric.categories || {})) {
    const scores = (category.dimensionIds || [])
      .map((id) => safeDimensions.find((dimension) => dimension?.id === id))
      .filter((dimension) => dimension?.applicable !== false && Number.isFinite(dimension?.score))
      .map((dimension) => dimension.score);
    result[categoryId] = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;
  }
  return result;
}

export function computeOverallScore(categoryScores, categoryWeights) {
  let weighted = 0;
  let weightTotal = 0;
  for (const [category, score] of Object.entries(categoryScores || {})) {
    const weight = categoryWeights?.[category] || 0;
    if (!Number.isFinite(score) || weight <= 0) continue;
    weighted += score * weight;
    weightTotal += weight;
  }
  return weightTotal ? Math.round(weighted / weightTotal) : null;
}

function confidenceScaledScore(formulaBaseline, confidence) {
  if (!Number.isFinite(formulaBaseline)) return null;
  if (confidence === "low") return Math.round(50 + (formulaBaseline - 50) * 0.75);
  if (confidence === "medium") return Math.round(50 + (formulaBaseline - 50) * 0.9);
  if (confidence === "high") return formulaBaseline;
  return null;
}

function recipeDefinitionsById(rubric) {
  const recipes = new Map();
  for (const dimensionId of rubric.dimensionOrder || []) {
    const dimension = rubric.dimensions?.[dimensionId];
    for (const recipe of dimension?.suggestionRecipes || []) {
      if (!recipe?.id) continue;
      recipes.set(recipe.id, {
        ...recipe,
        dimensionId,
        suggestionType: recipe.suggestionType
      });
    }
  }
  return recipes;
}

export function agentsDraftRequired(facts) {
  return Boolean(
    facts.projectAssets?.cwdResolved
    && !facts.projectAssets?.hasAgentsMd
    && facts.stats?.sessions >= 3
    && facts.computedBaselines?.architecture?.applicable === true
  );
}

function validateLegacyReport(report) {
  const errors = [];
  const warnings = ["Legacy report schema detected; strict 3.0 consistency checks were not applied"];
  require(errors, typeof report?.project === "string" && report.project.length > 0, "project is required");
  require(errors, report?.language === "zh" || report?.language === "en", "language must be exactly 'zh' or 'en'");
  require(errors, typeof report?.overallScore === "number", "overallScore is required");
  require(errors, Array.isArray(report?.dimensions) && report.dimensions.length === 9, "dimensions must be an array of exactly 9 entries");
  require(errors, Array.isArray(report?.suggestions) && report.suggestions.length >= 1, "suggestions must contain at least 1 entry");
  if (!report?.highlights?.strength || !report?.highlights?.bottleneck) {
    warnings.push("highlights.strength/bottleneck missing; renderer will derive them");
  }
  if (Array.isArray(report?.suggestions) && report.suggestions.some((suggestion) => !suggestion.summary)) {
    warnings.push("some suggestions are missing summary; renderer will use the first body sentence");
  }
  return { errors, warnings };
}

function validateSuggestionPayload(errors, suggestion, label) {
  switch (suggestion?.type) {
    case "prompt_rewrite":
    case "verification_loop":
      requireBilingual(errors, suggestion.promptRewrite, `${label}.promptRewrite`);
      break;
    case "workflow_habit":
      requireBilingualSteps(errors, suggestion.steps, `${label}.steps`, 3, 5);
      break;
    case "setup_action":
      require(
        errors,
        typeof suggestion.snippet === "string" || isBilingual(suggestion.snippet) || Array.isArray(suggestion.steps),
        `${label} needs snippet or steps`
      );
      if (Array.isArray(suggestion.steps)) {
        requireBilingualSteps(errors, suggestion.steps, `${label}.steps`, 2, 5);
      }
      break;
    case "tool_adoption":
      requireBilingualSteps(errors, suggestion.steps, `${label}.steps`, 2, 5);
      break;
    default:
      break;
  }
}

function requireBilingualSteps(errors, steps, label, min, max) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  require(errors, Array.isArray(steps) && safeSteps.length >= min && safeSteps.length <= max, `${label} must contain ${min}-${max} entries`);
  for (const [index, step] of safeSteps.entries()) {
    requireBilingual(errors, step, `${label}[${index}]`);
  }
}

function requireEvidenceRefs(errors, refs, label, validIds, required) {
  const safeRefs = Array.isArray(refs) ? refs : [];
  require(errors, Array.isArray(refs), `${label} must be an array`);
  if (required) require(errors, Array.isArray(refs) && safeRefs.length >= 1, `${label} needs at least one reference`);
  for (const ref of safeRefs) {
    require(errors, validIds.has(ref), `${label} contains unknown reference: ${ref}`);
  }
}

function evidenceIdSet(facts) {
  const atoms = Array.isArray(facts?.evidenceAtoms) ? facts.evidenceAtoms : [];
  const incidents = Array.isArray(facts?.criticalIncidents) ? facts.criticalIncidents : [];
  const episodes = Array.isArray(facts?.workflowEpisodes) ? facts.workflowEpisodes : [];
  return new Set([
    ...atoms.map((entry) => entry?.id),
    ...incidents.map((entry) => entry?.id),
    ...episodes.map((entry) => entry?.sessionId)
  ].filter(Boolean));
}

function requireBilingual(errors, value, label) {
  require(errors, isBilingual(value), `${label} must contain non-empty en and zh strings`);
}

function isBilingual(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.en === "string"
    && value.en.trim()
    && typeof value.zh === "string"
    && value.zh.trim()
  );
}

function nonEmptyLines(text) {
  return String(text || "").split(/\r?\n/).filter((line) => line.trim()).length;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateEvidenceContainers(errors, {
  evidenceAtoms,
  incidents,
  episodes,
  atomLabel,
  incidentLabel,
  episodeLabel
}) {
  for (const [index, atom] of evidenceAtoms.entries()) {
    require(errors, typeof atom?.id === "string" && atom.id.length > 0, `${atomLabel}[${index}].id is required`);
    require(errors, typeof atom?.snippet === "string", `${atomLabel}[${index}].snippet must be a string`);
  }
  for (const [index, incident] of incidents.entries()) {
    require(errors, typeof incident?.id === "string" && incident.id.length > 0, `${incidentLabel}[${index}].id is required`);
    require(errors, INCIDENT_TYPES.has(incident?.type), `${incidentLabel}[${index}].type is invalid`);
    require(errors, typeof incident?.summary === "string", `${incidentLabel}[${index}].summary must be a string`);
  }
  for (const [index, episode] of episodes.entries()) {
    require(
      errors,
      typeof episode?.sessionId === "string" && episode.sessionId.length > 0,
      `${episodeLabel}[${index}].sessionId is required`
    );
  }
}

function validateStrictPrivacy(errors, {
  evidenceAtoms,
  incidents,
  episodes,
  topQueries,
  atomLabel,
  incidentLabel,
  episodeLabel,
  queryLabel
}) {
  for (const [index, atom] of evidenceAtoms.entries()) {
    require(
      errors,
      isStrictOmissionSnippet(atom?.snippet),
      `${atomLabel}[${index}].snippet must be omitted in strict mode`
    );
  }
  for (const [index, incident] of incidents.entries()) {
    if (incident?.type === "command_retry_churn") {
      require(
        errors,
        incident?.summary?.includes("[command omitted in strict mode]"),
        `${incidentLabel}[${index}].summary must omit command text in strict mode`
      );
    }
    if (incident?.type === "correction") {
      require(
        errors,
        incident?.summary?.includes("[content omitted in strict mode;"),
        `${incidentLabel}[${index}].summary must omit message text in strict mode`
      );
    }
  }
  for (const [index, episode] of episodes.entries()) {
    require(errors, episode?.threadName === null, `${episodeLabel}[${index}].threadName must be null in strict mode`);
    require(
      errors,
      episode?.firstUserMessage === null,
      `${episodeLabel}[${index}].firstUserMessage must be null in strict mode`
    );
    require(
      errors,
      episode?.lastAgentMessage === null,
      `${episodeLabel}[${index}].lastAgentMessage must be null in strict mode`
    );
  }
  require(
    errors,
    Array.isArray(topQueries) && topQueries.length === 0,
    `${queryLabel} must be empty in strict mode`
  );
}

function isStrictOmissionSnippet(value) {
  return typeof value === "string" && (
    value.startsWith("[content omitted in strict mode;")
    || value.startsWith("[command omitted in strict mode]")
  );
}

function require(errors, condition, message) {
  if (!condition) errors.push(message);
}
