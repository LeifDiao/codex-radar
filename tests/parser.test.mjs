import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureProject } from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSER = path.join(__dirname, "..", "plugins", "codex-radar", "skills", "analyze", "scripts", "parse-codex-project.mjs");
const LISTER = path.join(__dirname, "..", "plugins", "codex-radar", "skills", "analyze", "scripts", "list-codex-projects.mjs");

function runParser(fixture) {
  const stdout = execFileSync("node", [PARSER, fixture.projectCwd], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome }
  });
  const summary = JSON.parse(stdout);
  const facts = JSON.parse(fs.readFileSync(summary.factsPath, "utf8"));
  return { summary, facts };
}

const fixture = buildFixtureProject();
const { summary, facts } = runParser(fixture);

test("subagent sessions are excluded from stats but summarized", () => {
  assert.equal(facts.project.sessionCount, 3, "3 included sessions (a, b, d)");
  assert.equal(facts.subagentActivity.sessionCount, 1);
  assert.equal(facts.subagentActivity.byRole.explorer, 1);
  const allText = JSON.stringify(facts.keyMessages) + JSON.stringify(facts.evidenceAtoms);
  assert.ok(!allText.includes("AGENT-AUTHORED"), "agent-authored prompt must not appear in evidence");
});

test("modern-format shell commands are reconstructed via call_id join", () => {
  // session A: 3 exec calls; session B: 3 (one repeated); session D: 1 → 7 total
  assert.equal(facts.stats.shellCommandCount, 7);
  // exec_command_end twins in session B must NOT double count
  const successes = facts.toolcraftSummary.commandSuccesses;
  const failures = facts.toolcraftSummary.commandFailures;
  assert.equal(successes + failures, 7, "every command has a recognized exit code");
  assert.equal(failures, 3, "npm test fail + rg fail ×2");
  assert.ok(facts.toolcraftSummary.commandSuccessRate > 0.5 && facts.toolcraftSummary.commandSuccessRate < 1);
});

test("proof commands are split into passed / failed", () => {
  const proof = facts.outcomeTotals.proofCommands;
  // npm test (fail), npm test (pass), npm run build (pass, deduped) = 3
  assert.equal(proof.total, 3);
  assert.equal(proof.passed, 2);
  assert.equal(proof.failed, 1);
});

test("opening bucket is per-session", () => {
  // session A has 3 human messages (2 count as opening), B has 1, D has 1 → 4
  assert.equal(facts.signalsByPosition.opening.messageCount, 4);
  assert.equal(facts.signalsByPosition.directing.messageCount, 5);
});

test("correction and confirmation are detected with substance", () => {
  assert.equal(facts.signalsByPosition.correcting.messageCount, 1);
  assert.equal(facts.signalsByPosition.correcting.substanceRatio, 1, "correction carries a file path");
  assert.equal(facts.signalsByPosition.confirming.messageCount, 1);
});

test("retry churn incident is detected", () => {
  const churn = facts.criticalIncidents.find((incident) => incident.type === "command_retry_churn");
  assert.ok(churn, "rg TODO failed twice → incident");
  assert.match(churn.summary, /rg -n TODO/);
});

test("computedBaselines cover all 9 dimensions and respect the profile", () => {
  const ids = Object.keys(facts.computedBaselines);
  assert.equal(ids.length, 9);
  for (const [id, entry] of Object.entries(facts.computedBaselines)) {
    if (entry.applicable) {
      assert.equal(typeof entry.baseline, "number", id);
      assert.ok(entry.baseline >= 0 && entry.baseline <= 100, id);
      assert.equal(typeof entry.confidenceScaled, "number", id);
    } else {
      assert.equal(entry.baseline, null, id);
      assert.ok(entry.naReason, id);
    }
  }
});

test("subagent lifecycle and MCP servers are tracked", () => {
  const lifecycle = facts.modernToolSummary.subagentLifecycle;
  assert.equal(lifecycle.spawned, 1);
  assert.equal(lifecycle.waited, 1);
  assert.equal(lifecycle.closed, 1);
  assert.equal(lifecycle.orphanedEstimate, 0);
  const nodeRepl = facts.modernToolSummary.mcpByServer.node_repl;
  assert.ok(nodeRepl);
  assert.equal(nodeRepl.calls, 2);
  assert.equal(nodeRepl.errors, 1);
});

test("plan completion is computed from update_plan arguments", () => {
  assert.equal(facts.modernToolSummary.plans.updates, 1);
  assert.equal(facts.modernToolSummary.plans.planCompletionAvg, 1);
});

test("format-drift detector counts unknown payload types", () => {
  assert.equal(facts.parserCoverage.eventsUnknown, 1);
  assert.equal(facts.parserCoverage.unknownTypes[0].name, "fancy_new_event");
});

test("automation share and profile classification", () => {
  // 1 automation of 3 included sessions
  assert.ok(Math.abs(facts.projectProfile.automationShare - 1 / 3) < 0.01);
  assert.notEqual(facts.projectProfile.type, "automation");
});

test("evidence atoms have ids and after-attribution", () => {
  assert.ok(facts.evidenceAtoms.length >= 4);
  const withAfter = facts.evidenceAtoms.find((atom) => atom.role === "user" && atom.after && atom.after.edits > 0);
  assert.ok(withAfter, "at least one user atom shows downstream edits");
  const ids = new Set(facts.evidenceAtoms.map((atom) => atom.id));
  assert.equal(ids.size, facts.evidenceAtoms.length, "atom ids are unique");
});

test("workflow episodes carry narrative fields", () => {
  assert.equal(facts.workflowEpisodes.length, 3);
  const sessionA = facts.workflowEpisodes.find((episode) => episode.sessionId === "sess-a");
  assert.ok(sessionA.firstUserMessage.includes("src/app.js"));
  assert.ok(sessionA.lastAgentMessage, "closing message captured");
  assert.equal(sessionA.proofPassed, 1);
  assert.equal(sessionA.proofFailed, 1);
  assert.equal(sessionA.corrections, 1);
});

test("summary output includes drift warnings array", () => {
  assert.ok(Array.isArray(summary.parserWarnings));
});

test("list-codex-projects reports sessionKinds and uses the meta cache", () => {
  const run = () => JSON.parse(execFileSync("node", [LISTER, "--cwd", fixture.projectCwd], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: fixture.codexHome, CODEX_RADAR_HOME: fixture.radarHome }
  }));
  const first = run();
  assert.equal(first.cwdMatch.cwd, fixture.projectCwd);
  assert.deepEqual(first.cwdMatch.sessionKinds, { interactive: 2, automation: 1, subagent: 1 });
  const cachePath = path.join(fixture.radarHome, "cache", "session-meta.json");
  assert.ok(fs.existsSync(cachePath), "meta cache written");
  const second = run();
  assert.deepEqual(second.cwdMatch, first.cwdMatch, "cached run returns identical results");
});
