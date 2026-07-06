// helpers.mjs — build synthetic Codex session fixtures in a temp CODEX_HOME.
// Fixtures are generated (not copied from real sessions) so the repo never
// contains real conversation data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempHome(prefix = "codex-radar-test-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    codexHome: path.join(root, "codex"),
    radarHome: path.join(root, "radar"),
    root
  };
}

export function writeSession(codexHome, relPath, records) {
  const filePath = path.join(codexHome, "sessions", relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return filePath;
}

let ts = 0;
export function stamp(base = "2026-06-29T10:00:00.000Z") {
  ts += 1;
  return new Date(new Date(base).getTime() + ts * 1000).toISOString();
}

export function sessionMeta({ id, cwd, source = "cli", threadSource = "user", extra = {} }) {
  return {
    timestamp: stamp(),
    type: "session_meta",
    payload: {
      id,
      timestamp: stamp(),
      cwd,
      originator: "codex-tui",
      cli_version: "0.150.0",
      source,
      thread_source: threadSource,
      model_provider: "openai",
      ...extra
    }
  };
}

export const evt = {
  userMessage: (message) => ({ timestamp: stamp(), type: "event_msg", payload: { type: "user_message", message } }),
  agentMessage: (message) => ({ timestamp: stamp(), type: "event_msg", payload: { type: "agent_message", message } }),
  taskStarted: () => ({ timestamp: stamp(), type: "event_msg", payload: { type: "task_started" } }),
  taskComplete: (last) => ({ timestamp: stamp(), type: "event_msg", payload: { type: "task_complete", last_agent_message: last } }),
  turnAborted: () => ({ timestamp: stamp(), type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } }),
  functionCall: (name, args, callId) => ({
    timestamp: stamp(), type: "response_item",
    payload: { type: "function_call", name, arguments: JSON.stringify(args), call_id: callId }
  }),
  functionOutput: (callId, output) => ({
    timestamp: stamp(), type: "response_item",
    payload: { type: "function_call_output", call_id: callId, output }
  }),
  customToolCall: (name, input, callId) => ({
    timestamp: stamp(), type: "response_item",
    payload: { type: "custom_tool_call", name, input, call_id: callId }
  }),
  execCommandEnd: (callId, command, exitCode) => ({
    timestamp: stamp(), type: "event_msg",
    payload: { type: "exec_command_end", call_id: callId, command, exit_code: exitCode, status: "completed" }
  }),
  patchApplyEnd: (callId, files) => ({
    timestamp: stamp(), type: "event_msg",
    payload: { type: "patch_apply_end", call_id: callId, success: true, changes: Object.fromEntries(files.map((f) => [f, {}])) }
  }),
  mcpEnd: (callId, server, tool, isError = false) => ({
    timestamp: stamp(), type: "event_msg",
    payload: {
      type: "mcp_tool_call_end", call_id: callId,
      invocation: { server, tool, arguments: {} },
      result: isError ? { Err: "boom" } : { Ok: { content: [] } }
    }
  }),
  webSearch: (query) => ({
    timestamp: stamp(), type: "response_item",
    payload: { type: "web_search_call", status: "completed", action: { type: "search", query } }
  }),
  tokenCount: (inputTokens, window) => ({
    timestamp: stamp(), type: "event_msg",
    payload: { type: "token_count", info: { last_token_usage: { input_tokens: inputTokens }, total_token_usage: { total_tokens: inputTokens }, model_context_window: window } }
  }),
  unknown: (type) => ({ timestamp: stamp(), type: "event_msg", payload: { type } })
};

// Build the standard fixture project used by parser tests.
// Returns { codexHome, radarHome, projectCwd }.
export function buildFixtureProject() {
  const { codexHome, radarHome, root } = makeTempHome();
  const projectCwd = path.join(root, "myproject");
  fs.mkdirSync(projectCwd, { recursive: true });
  fs.writeFileSync(path.join(projectCwd, "package.json"), "{}\n");
  fs.writeFileSync(path.join(projectCwd, "README.md"), "# fixture\n");

  // --- Session A: modern format, interactive, multi-turn ---
  writeSession(codexHome, "2026/06/29/session-a.jsonl", [
    sessionMeta({ id: "sess-a", cwd: projectCwd }),
    evt.taskStarted(),
    evt.userMessage("帮我修复 src/app.js 里的 parse 函数，必须保持接口不变，改完跑一下测试"),
    evt.functionCall("exec_command", { cmd: "npm test", workdir: projectCwd }, "call-a1"),
    evt.functionOutput("call-a1", "Command: npm test\nProcess exited with code 1\nOutput:\n1 failing"),
    evt.functionCall("exec_command", { cmd: "cat src/app.js" }, "call-a2"),
    evt.functionOutput("call-a2", "Process exited with code 0\nOutput:\n..."),
    evt.customToolCall("apply_patch", "*** Begin Patch\n*** Update File: src/app.js\n+fixed\n*** End Patch", "call-a3"),
    evt.patchApplyEnd("call-a3", ["src/app.js"]),
    evt.functionCall("exec_command", { cmd: "npm test" }, "call-a4"),
    evt.functionOutput("call-a4", "Process exited with code 0\nOutput:\nall passing"),
    evt.functionCall("update_plan", { plan: [ { step: "fix", status: "completed" }, { step: "verify", status: "completed" } ] }, "call-a5"),
    evt.agentMessage("Fixed and verified."),
    evt.taskComplete("Fixed and verified."),
    evt.taskStarted(),
    evt.userMessage("不对 — 问题在 src/app.js 第 12 行，返回值应该是 null 而不是 undefined"),
    evt.customToolCall("apply_patch", "*** Begin Patch\n*** Update File: src/app.js\n+null\n*** End Patch", "call-a6"),
    evt.patchApplyEnd("call-a6", ["src/app.js"]),
    evt.agentMessage("Changed to null."),
    evt.taskComplete("Changed to null."),
    evt.taskStarted(),
    evt.userMessage("好的"),
    evt.agentMessage("👍"),
    evt.taskComplete("Done."),
    evt.tokenCount(50000, 200000),
    evt.unknown("fancy_new_event"),
    evt.webSearch("node undefined vs null best practice"),
    evt.mcpEnd("call-a7", "node_repl", "js", false),
    evt.mcpEnd("call-a8", "node_repl", "js", true),
    evt.functionCall("spawn_agent", { agent_type: "explorer", message: "review src/app.js" }, "call-a9"),
    evt.functionCall("wait_agent", { targets: ["agent-1"] }, "call-a10"),
    evt.functionCall("close_agent", { target: "agent-1" }, "call-a11")
  ]);

  // --- Session B: old format — function_call + exec_command_end for the SAME call (dedup) ---
  writeSession(codexHome, "2026/04/10/session-b.jsonl", [
    sessionMeta({ id: "sess-b", cwd: projectCwd }),
    evt.taskStarted(),
    evt.userMessage("check the build please, run npm run build and paste the result"),
    evt.functionCall("exec_command", { cmd: "npm run build" }, "call-b1"),
    evt.functionOutput("call-b1", "Process exited with code 0\nOutput:\nbuilt"),
    evt.execCommandEnd("call-b1", ["/bin/zsh", "-lc", "npm run build"], 0),
    evt.functionCall("exec_command", { cmd: "rg -n TODO src/" }, "call-b2"),
    evt.functionOutput("call-b2", "Process exited with code 2\nOutput:\n"),
    evt.execCommandEnd("call-b2", ["/bin/zsh", "-lc", "rg -n TODO src/"], 2),
    evt.functionCall("exec_command", { cmd: "rg -n TODO src/" }, "call-b3"),
    evt.functionOutput("call-b3", "Process exited with code 2\nOutput:\n"),
    evt.turnAborted()
  ]);

  // --- Session C: subagent thread (must be EXCLUDED from stats) ---
  writeSession(codexHome, "2026/06/29/session-c.jsonl", [
    sessionMeta({
      id: "sess-c", cwd: projectCwd, source: { subagent: { thread_spawn: { parent_thread_id: "sess-a", agent_role: "explorer", agent_nickname: "Hubble" } } },
      threadSource: "subagent"
    }),
    evt.taskStarted(),
    evt.userMessage("THIS IS AN AGENT-AUTHORED PROMPT - must not count"),
    evt.functionCall("exec_command", { cmd: "ls" }, "call-c1"),
    evt.functionOutput("call-c1", "Process exited with code 0\nOutput:\n"),
    evt.taskComplete("done")
  ]);

  // --- Session D: automation (codex exec) ---
  writeSession(codexHome, "2026/06/29/session-d.jsonl", [
    sessionMeta({ id: "sess-d", cwd: projectCwd, source: "exec" }),
    evt.taskStarted(),
    evt.userMessage("生成第 3 张配图，输出到 out/img3.png，不要改其他文件"),
    evt.functionCall("exec_command", { cmd: "python3 gen.py --n 3" }, "call-d1"),
    evt.functionOutput("call-d1", "Process exited with code 0\nOutput:\nok"),
    evt.taskComplete("generated")
  ]);

  return { codexHome, radarHome, projectCwd, root };
}
