#!/usr/bin/env node
// compute-baseline.mjs — build the user's self-baseline: the distribution of
// per-session collaboration metrics across ALL their Codex projects.
// Entirely local; used so reports can say "half the proof density of your
// median session" instead of quoting numbers with no anchor.
//
// Usage: node compute-baseline.mjs [--if-stale] [--refresh]
//   --if-stale  exit immediately if the cache is fresher than 7 days (default for SKILL flow)
//   --refresh   force a rebuild
import fs from "node:fs";
import path from "node:path";
import { allSessionFiles, eachJsonLine, ensureDir, RADAR_HOME, readSessionMeta } from "./lib.mjs";
import { classifyMessage, isProofCommand, parseExecArguments, sessionKindFromMeta } from "./signals.mjs";

const MAX_FILES = 400;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const cachePath = path.join(RADAR_HOME, "cache", "self-baseline.json");

if (args.has("--if-stale") && !args.has("--refresh")) {
  try {
    const existing = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (existing?.generatedAt && Date.now() - new Date(existing.generatedAt).getTime() < STALE_MS) {
      console.log(JSON.stringify({ cachePath, status: "fresh", generatedAt: existing.generatedAt }));
      process.exit(0);
    }
  } catch { /* no cache — build it */ }
}

const files = await allSessionFiles();
const step = Math.max(1, Math.floor(files.length / MAX_FILES));
const sampled = files.filter((_, index) => index % step === 0).slice(0, MAX_FILES);

const byKind = { interactive: [], automation: [] };
for (const file of sampled) {
  const meta = await readSessionMeta(file);
  if (!meta?.cwd) continue;
  const kind = sessionKindFromMeta(meta);
  if (kind === "subagent") continue;
  const metrics = await sessionMetrics(file);
  if (metrics.humanMessages > 0) byKind[kind].push(metrics);
}

function metricsFor(sessions) {
  if (!sessions.length) return null;
  return {
    sessions: sessions.length,
    humanMessages: distribution(sessions.map((s) => s.humanMessages)),
    averageMessageLength: distribution(sessions.map((s) => s.avgMsgLen)),
    editsPerHumanMsg: distribution(sessions.map((s) => s.edits / s.humanMessages)),
    toolsPerHumanMsg: distribution(sessions.map((s) => s.toolCalls / s.humanMessages)),
    proofRunsPerSession: distribution(sessions.map((s) => s.proofRuns)),
    explicitGoalRatio: distribution(sessions.map((s) => s.explicitGoal / s.humanMessages)),
    asksVerifyRatio: distribution(sessions.map((s) => s.asksVerify / s.humanMessages)),
    filePathRatio: distribution(sessions.map((s) => s.filePath / s.humanMessages))
  };
}

const result = {
  schemaVersion: "self-baseline-1",
  generatedAt: new Date().toISOString(),
  sessionsSampled: byKind.interactive.length + byKind.automation.length,
  interactive: metricsFor(byKind.interactive),
  automation: metricsFor(byKind.automation)
};

ensureDir(path.dirname(cachePath));
fs.writeFileSync(cachePath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ cachePath, status: "rebuilt", sessionsSampled: result.sessionsSampled }));

async function sessionMetrics(file) {
  const metrics = {
    humanMessages: 0, totalChars: 0, avgMsgLen: 0, edits: 0, toolCalls: 0,
    proofRuns: 0, explicitGoal: 0, asksVerify: 0, filePath: 0
  };
  await eachJsonLine(file, (record) => {
    const payload = record.payload || {};
    switch (payload.type) {
      case "user_message": {
        const text = String(payload.message || "").trim();
        if (!text) break;
        metrics.humanMessages += 1;
        metrics.totalChars += text.length;
        const features = classifyMessage(text);
        if (features.explicitGoal) metrics.explicitGoal += 1;
        if (features.asksVerify) metrics.asksVerify += 1;
        if (features.filePath) metrics.filePath += 1;
        break;
      }
      case "function_call":
        metrics.toolCalls += 1;
        if (payload.name === "exec_command" && isProofCommand(parseExecArguments(payload.arguments).command)) {
          metrics.proofRuns += 1;
        }
        break;
      case "custom_tool_call":
        metrics.toolCalls += 1;
        break;
      case "patch_apply_end": {
        const changes = payload.changes && typeof payload.changes === "object" ? Object.keys(payload.changes).length : 0;
        metrics.edits += Math.max(1, changes);
        break;
      }
      case "exec_command_end":
        // old format may lack the function_call twin; count proof from here too
        if (!payload.call_id && Array.isArray(payload.command) && isProofCommand(payload.command.join(" "))) {
          metrics.proofRuns += 1;
        }
        break;
      default:
        break;
    }
  });
  metrics.avgMsgLen = metrics.humanMessages ? Math.round(metrics.totalChars / metrics.humanMessages) : 0;
  return metrics;
}

function distribution(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    p25: round2(q(0.25)),
    median: round2(q(0.5)),
    p75: round2(q(0.75))
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
