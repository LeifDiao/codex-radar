// Single authoritative implementation of deterministic dimension baselines.

import { clamp, ratio } from "./lib.mjs";

export const FORMULA_VERSION = "3.0";

export function computeBaselines(facts) {
  const d = facts.signalsByPosition.directing.ratios;
  const o = facts.signalsByPosition.opening.ratios;
  const correcting = facts.signalsByPosition.correcting;
  const confirming = facts.signalsByPosition.confirming;
  const stats = facts.stats;
  const tc = facts.toolcraftSummary;
  const out = facts.outcomeTotals;
  const assets = facts.projectAssets;
  const successRate = tc.commandSuccessRate ?? 0.5;
  const correctionSubstance = correcting.substanceRatio ?? 0.5;
  const confirmShare = ratio(confirming.messageCount, Math.max(1, stats.humanMessages));

  const raw = {
    lock_on: 35 + d.explicitGoal * 20 + d.expectedBehavior * 18 + d.filePath * 18
      + d.constraints * 10 + d.errorLog * 8
      - Math.max(0, 90 - stats.averageHumanMessageLength) * 0.08,
    scene_setting: 30 + o.expectedBehavior * 22 + o.constraints * 16 + o.filePath * 16
      + o.codeOrData * 14 + clamp(stats.averageHumanMessageLength / 7, 0, 12),
    steering: 38 + d.asksVerify * 20 + correctionSubstance * 16
      + Math.min(10, confirmShare * 30) + d.errorLog * 8 - out.abortRatio * 12,
    toolcraft: 30 + Math.min(20, facts.toolcraftSummary.byCategory.length * 4)
      + successRate * 18 + Math.min(12, tc.planUpdates * 3)
      + Math.min(10, tc.webSearchCalls + tc.browserCalls + tc.mcpCalls)
      + Math.min(10, tc.subagentCalls * 3),
    architecture: 25 + (assets.hasAgentsMd ? 20 : 0)
      + ((assets.hasCodexDir || assets.hasAgentsDir) ? 12 : 0)
      + (assets.hasGit ? 12 : 0) + (assets.hasManifest ? 12 : 0)
      + (assets.hasReadme ? 8 : 0) + (assets.hasTestsDir ? 8 : 0)
      + Math.min(8, assets.rootEntryCount / 8),
    tempo: 72 - out.abortRatio * 28 - Math.min(14, stats.contextCompactions * 3)
      - Math.min(12, stats.errors * 3) + Math.min(10, out.cleanEndRatio * 10)
      - Math.max(0, out.toolsPerHumanMsg - 10) * 2,
    efficiency: 35 + Math.min(24, out.editsPerHumanMsg * 18)
      + Math.min(16, out.filesPerHumanMsg * 18) + successRate * 12
      + out.cleanEndRatio * 10 - Math.max(0, out.toolsPerHumanMsg - 12) * 2,
    proof_check: 28 + Math.min(34, out.proofCommands.passed * 8 + out.proofCommands.failed * 4 + out.proofCommands.unknown * 2)
      + d.asksVerify * 18 + (assets.hasTestsDir ? 8 : 0)
      + Math.min(12, tc.browserCalls + tc.viewImageCalls),
    completion: 45 + out.cleanEndRatio * 35
      + Math.min(10, (stats.agentMessages / Math.max(1, stats.turnCompletes)) * 3)
      - out.abortRatio * 18 - Math.min(8, stats.errors * 2)
  };

  const naSet = new Set(facts.projectProfile.naDimensions);
  const result = {};
  for (const [id, value] of Object.entries(raw)) {
    if (naSet.has(id)) {
      result[id] = {
        applicable: false,
        baseline: null,
        confidenceScaled: null,
        naReason: naReasonFor(id, facts)
      };
      continue;
    }
    const baseline = Math.round(clamp(value, 0, 100));
    result[id] = {
      applicable: true,
      baseline,
      confidenceScaled: Math.round(scaleByConfidence(baseline, facts.confidenceLevel))
    };
  }
  return result;
}

function naReasonFor(id, facts) {
  if (id === "architecture" && !facts.projectAssets.cwdResolved) {
    return {
      en: "The recorded project directory could not be located on this machine.",
      zh: "当前机器上无法定位会话记录中的项目目录。"
    };
  }
  return {
    en: `Not applicable for the '${facts.projectProfile.type}' project profile.`,
    zh: `此维度不适用于 '${facts.projectProfile.type}' 项目画像。`
  };
}

function scaleByConfidence(baseline, level) {
  if (level === "low") return 50 + (baseline - 50) * 0.75;
  if (level === "medium") return 50 + (baseline - 50) * 0.9;
  return baseline;
}
