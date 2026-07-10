// Deterministic predicates for rubric suggestion recipes.
// Every recipe id in rubric.json must have exactly one predicate here.

const predicates = {
  "lock-on-name-target-file": (f) => directing(f).filePath < 0.15 && f.outcomeTotals.fileEditCount > 0,
  "lock-on-state-boundary": (f) => directing(f).constraints < 0.1 && hasIncident(f, "correction"),
  "scene-setting-three-line-opening": (f) => opening(f).codeOrData < 0.1 && f.stats.sessions >= 3,
  "scene-setting-persist-context": (f) => (
    f.projectAssets.cwdResolved && !f.projectAssets.hasAgentsMd && f.stats.sessions >= 5
  ),
  "steering-correct-with-coordinates": (f) => (
    (f.signalsByPosition.correcting.substanceRatio ?? 0.5) < 0.4
    && f.signalsByPosition.correcting.messageCount >= 2
  ),
  "steering-request-proof": (f) => directing(f).asksVerify < 0.08 && f.outcomeTotals.fileEditCount > 5,
  "toolcraft-close-subagents": (f) => f.modernToolSummary.subagentLifecycle.orphanedEstimate > 0,
  "toolcraft-plan-multifile-work": (f) => (
    f.toolcraftSummary.planUpdates === 0 && f.outcomeTotals.distinctFilesTouched >= 5
  ),
  "toolcraft-reuse-research-source": (f) => (
    f.modernToolSummary.web.searches > 10 && f.toolcraftSummary.mcpCalls === 0
  ),
  "architecture-create-agents-md": (f) => (
    !f.projectAssets.hasAgentsMd && f.projectAssets.cwdResolved
  ),
  "architecture-add-test-harness": (f) => (
    f.projectAssets.cwdResolved && !f.projectAssets.hasTestsDir && f.outcomeTotals.fileEditCount > 10
  ),
  "tempo-break-retry-loop": (f) => hasIncident(f, "command_retry_churn"),
  "tempo-split-long-session": (f) => f.stats.contextCompactions >= 2,
  "efficiency-bound-exploration": (f) => (
    f.outcomeTotals.toolsPerHumanMsg > 15 && f.outcomeTotals.editsPerHumanMsg < 0.5
  ),
  "proof-check-run-verification": (f) => (
    f.outcomeTotals.fileEditCount > 0 && f.outcomeTotals.proofCommands.total === 0
  ),
  "proof-check-make-green-exit": (f) => (
    f.outcomeTotals.proofCommands.failed > f.outcomeTotals.proofCommands.passed
  ),
  "completion-bank-state": (f) => (
    f.stats.silentDrops + f.stats.turnAborts > f.stats.turnCompletes * 0.2
  )
};

export function selectTriggeredRecipes(rubric, facts) {
  const selected = [];
  const seen = new Set();
  for (const dimensionId of rubric.dimensionOrder || []) {
    const dimension = rubric.dimensions?.[dimensionId];
    const applicable = facts.computedBaselines?.[dimensionId]?.applicable !== false;
    for (const recipe of dimension?.suggestionRecipes || []) {
      if (!recipe.id) throw new Error(`Suggestion recipe in ${dimensionId} is missing an id`);
      if (seen.has(recipe.id)) throw new Error(`Duplicate suggestion recipe id: ${recipe.id}`);
      seen.add(recipe.id);
      const predicate = predicates[recipe.id];
      if (!predicate) throw new Error(`No deterministic predicate for suggestion recipe: ${recipe.id}`);
      if (!applicable) continue;
      if (!predicate(facts)) continue;
      selected.push({
        ...recipe,
        dimensionId,
        dimensionName: dimension.name
      });
    }
  }
  const orphanPredicates = Object.keys(predicates).filter((id) => !seen.has(id));
  if (orphanPredicates.length) {
    throw new Error(`Recipe predicates without rubric entries: ${orphanPredicates.join(", ")}`);
  }
  return selected;
}

export function recipePredicateIds() {
  return Object.keys(predicates).sort();
}

function directing(facts) {
  return facts.signalsByPosition.directing.ratios;
}

function opening(facts) {
  return facts.signalsByPosition.opening.ratios;
}

function hasIncident(facts, type) {
  return (facts.criticalIncidents || []).some((incident) => incident.type === type);
}
