import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMessage,
  extractExitCode,
  filesFromPatchText,
  isProofCommand,
  parseExecArguments,
  sessionKindFromMeta,
  skillNameFromCommand
} from "../plugins/codex-radar/skills/analyze/scripts/signals.mjs";

// ---------------------------------------------------------------------------
// classifyMessage — labeled regression set (zh + en, positives AND negatives)
// ---------------------------------------------------------------------------

const CASES = [
  // [text, feature, expected]
  ["帮我修复 src/app.js 里的 parse 函数", "explicitGoal", true],
  ["帮我修复 src/app.js 里的 parse 函数", "filePath", true],
  ["fix the login bug in auth.ts", "explicitGoal", true],
  ["好的", "explicitGoal", false],                       // confirmation is not a goal
  ["好的", "confirmation", true],
  ["好的，但是把颜色改成蓝色，然后再检查一遍所有页面的布局", "confirmation", false], // long follow-up ≠ bare confirmation
  ["对比一下这两个方案的优缺点", "confirmation", false],   // 对比 ≠ 确认
  ["对", "confirmation", true],
  ["ok", "confirmation", true],
  ["不对 — 问题在 src/app.js 第 12 行", "correction", true],
  ["改成 null 而不是 undefined", "correction", true],
  ["这个函数不是很复杂", "correction", false],             // 不是 in mid-sentence ≠ correction
  ["wait, that's not what I meant", "correction", true],
  ["改完跑一下测试", "asksVerify", true],
  ["run the tests and paste the output", "asksVerify", true],
  ["检查 src 目录下有哪些文件", "asksVerify", false],       // 检查=goal here, not verify-after-work
  ["验证一下没问题再收工", "asksVerify", true],
  ["必须保持接口不变", "constraints", true],
  ["do not touch the config file", "constraints", true],
  ["报错了：TypeError: cannot read properties of undefined", "errorLog", true],
  ["一切正常", "errorLog", false],
  ["先出个方案我看看", "asksPlan", true],
  ["make a plan first, then implement", "asksPlan", true],
  ["```js\nconst a = 1;\n```", "codeOrData", true]
];

test("classifyMessage labeled regression set", () => {
  const failures = [];
  for (const [text, feature, expected] of CASES) {
    const got = classifyMessage(text)[feature];
    if (got !== expected) failures.push(`"${text}" .${feature}: expected ${expected}, got ${got}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

// ---------------------------------------------------------------------------
// isProofCommand — real runners only
// ---------------------------------------------------------------------------

test("isProofCommand accepts real verification runners", () => {
  for (const cmd of [
    "npm test", "npm run build", "pnpm run lint", "bun test",
    "pytest -x tests/", "cargo test", "go test ./...", "npx vitest run",
    "node --test tests/", "tsc", "eslint src/", "make test", "python3 -m pytest",
    "./gradlew test", "./mvnw verify", "dotnet test", "bundle exec rspec",
    "composer test", "swift test", "xcodebuild -scheme App test",
    "deno test", "flutter analyze", "cmake --build build"
  ]) {
    assert.equal(isProofCommand(cmd), true, cmd);
  }
});

test("isProofCommand rejects proof theater", () => {
  for (const cmd of [
    "echo 验证", "echo done 检查完毕", "ls -la", "cat README.md",
    "python3 gen.py --render", "screenshot.sh", "git status", "npm install",
    "xcodebuild -list", "dotnet --info", "./gradlew dependencies"
  ]) {
    assert.equal(isProofCommand(cmd), false, cmd);
  }
});

// ---------------------------------------------------------------------------
// extractExitCode — modern output formats
// ---------------------------------------------------------------------------

test("extractExitCode reads the textual formats", () => {
  assert.deepEqual(extractExitCode("Command: npm test\nProcess exited with code 0\nOutput:"), { exitCode: 0, recognized: true });
  assert.deepEqual(extractExitCode("blah\nProcess exited with code 127\n"), { exitCode: 127, recognized: true });
  assert.deepEqual(extractExitCode("exited with status 2"), { exitCode: 2, recognized: true });
  assert.deepEqual(extractExitCode("no exit info at all"), { exitCode: null, recognized: false });
});

test("extractExitCode reads structured formats", () => {
  assert.deepEqual(extractExitCode({ metadata: { exit_code: 3 } }), { exitCode: 3, recognized: true });
  assert.deepEqual(extractExitCode(JSON.stringify({ output: "Process exited with code 1" })), { exitCode: 1, recognized: true });
  assert.deepEqual(extractExitCode(JSON.stringify({ metadata: { exit_code: 0 }, output: "ok" })), { exitCode: 0, recognized: true });
});

// ---------------------------------------------------------------------------
// misc extractors
// ---------------------------------------------------------------------------

test("parseExecArguments", () => {
  assert.deepEqual(parseExecArguments('{"cmd": "npm test", "workdir": "/x"}'), { command: "npm test", workdir: "/x" });
  assert.deepEqual(parseExecArguments('{"command": ["bash", "-c", "ls"]}'), { command: "bash -c ls", workdir: null });
  assert.deepEqual(parseExecArguments("not json"), { command: "", workdir: null });
});

test("sessionKindFromMeta", () => {
  assert.equal(sessionKindFromMeta({ thread_source: "subagent" }), "subagent");
  assert.equal(sessionKindFromMeta({ source: { subagent: { other: "guardian" } } }), "subagent");
  assert.equal(sessionKindFromMeta({ source: "exec" }), "automation");
  assert.equal(sessionKindFromMeta({ source: "cli", thread_source: "user" }), "interactive");
  assert.equal(sessionKindFromMeta({ source: "vscode" }), "interactive");
  assert.equal(sessionKindFromMeta(null), "interactive");
});

test("filesFromPatchText", () => {
  const patch = "*** Begin Patch\n*** Add File: a.md\n+x\n*** Update File: src/b.js\n+y\n*** Delete File: c.txt\n*** End Patch";
  assert.deepEqual(filesFromPatchText(patch), ["a.md", "src/b.js", "c.txt"]);
});

test("skillNameFromCommand", () => {
  assert.equal(skillNameFromCommand("sed -n '1,200p' /Users/x/.codex/skills/.system/imagegen/SKILL.md"), "imagegen");
  assert.equal(skillNameFromCommand("cat ~/.codex/skills/my-writer/SKILL.md"), "my-writer");
  assert.equal(skillNameFromCommand("npm test"), null);
});
