import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evt,
  makeTempHome,
  sessionMeta,
  writeSession
} from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSER = path.join(
  __dirname,
  "..",
  "plugins",
  "codex-radar",
  "skills",
  "analyze",
  "scripts",
  "parse-codex-project.mjs"
);

function buildSensitiveFixture() {
  const home = makeTempHome("codex-radar-privacy-");
  const projectCwd = path.join(home.root, "private-project");
  fs.mkdirSync(projectCwd, { recursive: true });
  fs.writeFileSync(path.join(projectCwd, "package.json"), "{}");
  fs.mkdirSync(home.codexHome, { recursive: true });
  fs.writeFileSync(path.join(home.codexHome, "session_index.jsonl"), JSON.stringify({
    id: "privacy-session",
    thread_name: "super-secret-thread-title",
    updated_at: "2026-07-10T00:00:00.000Z"
  }) + "\n");
  writeSession(home.codexHome, "2026/07/10/privacy.jsonl", [
    sessionMeta({ id: "privacy-session", cwd: projectCwd }),
    evt.taskStarted(),
    evt.userMessage("Fix auth.ts with api_key=sk-1234567890abcdefghijklmnop and keep the API stable"),
    evt.functionCall("exec_command", {
      cmd: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' https://example.test"
    }, "privacy-call"),
    evt.functionOutput("privacy-call", "Process exited with code 1\nOutput:\nfailed"),
    evt.webSearch("super-secret-search-query"),
    evt.turnAborted(),
    evt.agentMessage("Do not share github_pat_abcdefghijklmnopqrstuvwxyz123456"),
    evt.taskComplete("Finished with password=super-secret-value")
  ]);
  return { ...home, projectCwd };
}

function parseFixture(fixture, privacyMode) {
  const stdout = execFileSync("node", [PARSER, fixture.projectCwd, "--privacy", privacyMode], {
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      CODEX_RADAR_HOME: fixture.radarHome
    }
  });
  const summary = JSON.parse(stdout);
  return JSON.parse(fs.readFileSync(summary.factsPath, "utf8"));
}

test("standard privacy mode redacts common credentials", () => {
  const facts = parseFixture(buildSensitiveFixture(), "standard");
  const serialized = JSON.stringify(facts);
  assert.ok(serialized.includes("[REDACTED"));
  assert.ok(!serialized.includes("sk-1234567890abcdefghijklmnop"));
  assert.ok(!serialized.includes("abcdefghijklmnopqrstuvwxyz123456"));
  assert.ok(!serialized.includes("super-secret-value"));
});

test("strict privacy mode omits message and command snippets", () => {
  const facts = parseFixture(buildSensitiveFixture(), "strict");
  const serialized = JSON.stringify(facts);
  assert.equal(facts.privacyMode, "strict");
  assert.ok(serialized.includes("content omitted in strict mode"));
  assert.ok(serialized.includes("command omitted in strict mode"));
  assert.ok(!serialized.includes("Fix auth.ts"));
  assert.ok(!serialized.includes("super-secret-thread-title"));
  assert.ok(!serialized.includes("super-secret-search-query"));
  assert.ok(facts.workflowEpisodes.every((episode) => episode.firstUserMessage === null));
  assert.ok(facts.workflowEpisodes.every((episode) => episode.lastAgentMessage === null));
  assert.ok(facts.workflowEpisodes.every((episode) => episode.threadName === null));
  assert.deepEqual(facts.modernToolSummary.web.topQueries, []);
});
