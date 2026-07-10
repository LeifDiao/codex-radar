#!/usr/bin/env node
// parse-codex-project.mjs — extract deterministic FACTS from local Codex sessions.
// It does NOT write prose. prepare-model-input.mjs turns these facts into the
// compact, security-bounded input used for model-authored analysis (see SKILL.md).
//
// v2.1: joins function_call/function_call_output by call_id (modern rollout format),
// classifies sessions (interactive / automation / subagent), computes the baseline
// formulas in code, and emits evidenceAtoms / workflowEpisodes / criticalIncidents
// plus a modernToolSummary and parserCoverage drift detector.
import fs from "node:fs";
import path from "node:path";
import {
  allSessionFiles,
  cleanupOldFiles,
  clip,
  CODEX_HOME,
  countBy,
  displayNameFromCwd,
  eachJsonLine,
  extractTextContent,
  fileExists,
  isSameOrChild,
  loadRubric,
  loadSessionMetasCached,
  loadThreadIndex,
  normalizePath,
  RADAR_HOME,
  redactSensitiveText,
  ratio,
  readSessionMeta,
  topCounts,
  writeFilePrivate
} from "./lib.mjs";
import {
  categorizeTool,
  classifyMessage,
  extractExitCode,
  filesFromPatchText,
  isProofCommand,
  normalizeCommand,
  parseExecArguments,
  sessionKindFromMeta,
  skillNameFromCommand
} from "./signals.mjs";
import { computeBaselines, FORMULA_VERSION } from "./scoring.mjs";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rubric = loadRubric(SKILL_DIR);

// payload types the parser handles or knowingly ignores; anything else counts
// as unknown for the format-drift detector.
const KNOWN_PAYLOAD_TYPES = new Set([
  "task_started", "task_complete", "turn_aborted", "user_message", "agent_message",
  "message", "reasoning", "function_call", "function_call_output",
  "custom_tool_call", "custom_tool_call_output", "web_search_call", "web_search_end",
  "image_generation_call", "image_generation_end", "view_image_tool_call",
  "mcp_tool_call_begin", "mcp_tool_call_end", "collab_agent_spawn_begin", "collab_agent_spawn_end",
  "collab_close_begin", "collab_close_end", "collab_waiting_begin", "collab_waiting_end",
  "exec_command_begin", "exec_command_end", "exec_command_output_delta",
  "patch_apply_begin", "patch_apply_end", "token_count", "error", "context_compacted",
  "thread_goal_updated", "thread_name_updated", "thread_rolled_back",
  "tool_search_call", "tool_search_output", "agent_reasoning", "agent_reasoning_delta",
  "turn_diff", "plan_update", "stream_error"
]);

function usage() {
  console.error("Usage: node parse-codex-project.mjs <project-cwd> [--privacy standard|strict]");
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = { projectCwd: null, privacyMode: "standard" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--privacy") {
      parsed.privacyMode = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--privacy=")) {
      parsed.privacyMode = arg.slice("--privacy=".length);
    } else if (!arg.startsWith("--") && !parsed.projectCwd) {
      parsed.projectCwd = arg;
    }
  }
  if (!["standard", "strict"].includes(parsed.privacyMode)) usage();
  return parsed;
}

const cli = parseArgs(process.argv.slice(2));
const projectCwd = normalizePath(cli.projectCwd);
if (!projectCwd) usage();

const threadIndex = loadThreadIndex();
const files = await allSessionFiles();
const metaMap = await loadSessionMetasCached(files);
const metas = [];
for (const [file, meta] of metaMap) {
  if (!meta?.cwd) continue;
  metas.push({ file, meta, cwd: normalizePath(meta.cwd) });
}

let selected = metas.filter((entry) => entry.cwd === projectCwd);
let selectionMode = "exact";
if (selected.length === 0) {
  selected = metas.filter((entry) => isSameOrChild(projectCwd, entry.cwd) || isSameOrChild(entry.cwd, projectCwd));
  selectionMode = "related";
}

if (selected.length === 0) {
  console.error(`No Codex sessions found for cwd: ${projectCwd}`);
  process.exit(1);
}

const state = createEmptyState(projectCwd, selectionMode, cli.privacyMode);
for (const entry of selected) {
  // The cache holds slim metas; re-read the full session_meta for the
  // selected sessions only (dynamic_tools, subagent spawn details).
  const fullMeta = await readSessionMeta(entry.file) || entry.meta;
  const kind = sessionKindFromMeta(fullMeta);
  if (kind === "subagent") {
    await parseSubagentSession(entry.file, fullMeta, state);
  } else {
    await parseSession(entry.file, fullMeta, state, kind);
  }
}

if (state.sessions.length === 0) {
  console.error(`All ${selected.length} sessions for this cwd are subagent threads — nothing user-authored to evaluate.`);
  process.exit(1);
}

finalizeShellCommands(state);
finalizeSignals(state);
const facts = buildFacts(state);
facts.computedBaselines = computeBaselines(facts);

const tempDir = path.join(RADAR_HOME, "temp");
cleanupOldFiles(tempDir, {
  prefixes: ["codex-facts-", "codex-model-input-", "codex-analysis-", "codex-report-"]
});
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const factsPath = path.join(tempDir, `codex-facts-${stamp}.json`);
writeFilePrivate(factsPath, JSON.stringify(facts, null, 2) + "\n");

console.log(JSON.stringify({
  factsPath,
  project: facts.project.displayName,
  profile: facts.projectProfile.label,
  profileType: facts.projectProfile.type,
  sessions: facts.project.sessionCount,
  subagentSessionsExcluded: facts.subagentActivity.sessionCount,
  automationShare: facts.projectProfile.automationShare,
  humanMessages: facts.stats.humanMessages,
  confidence: facts.confidenceLevel,
  dominantLanguage: facts.dominantLanguage,
  privacyMode: facts.privacyMode,
  parserWarnings: facts.parserWarnings
}, null, 2));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function createEmptyState(cwd, selectionMode, privacyMode) {
  return {
    cwd,
    selectionMode,
    privacyMode,
    sessions: [],
    humanMessages: [],
    assistantMessages: 0,
    agentMessages: 0,
    toolCalls: [],
    shellByCallId: new Map(),
    shellCommands: [],           // entries without a call_id
    patchEvents: [],
    patchFallbacks: [],
    turnStarts: 0,
    turnCompletes: 0,
    turnAborts: 0,
    contextCompactions: 0,
    errors: 0,
    oversizedLines: 0,
    unknownExitCodeCommands: 0,
    tokenEvents: 0,
    maxContextUsedPct: 0,
    correctionSubstanceCount: 0,
    dynamicTools: new Set(),
    models: new Set(),
    sources: new Set(),
    filesTouched: new Set(),
    countedToolCallIds: new Set(),
    counters: {
      planUpdates: 0,
      webSearchCalls: 0,
      imageGenerationCalls: 0,
      viewImageCalls: 0,
      browserCalls: 0,
      mcpCalls: 0,
      subagentSpawns: 0,
      toolSearchCalls: 0,
      goalCalls: 0,
      threadGoalEvents: 0,
      nodeReplCalls: 0
    },
    mcpByServer: new Map(),
    subagentLifecycle: { spawned: 0, waitTargets: new Set(), closeTargets: new Set() },
    webQueries: [],
    skillReads: new Map(),
    subagent: { sessionCount: 0, byRole: {}, toolCalls: 0, edits: 0, nicknames: new Set() },
    eventTotal: 0,
    unknownTypes: new Map(),
    signals: {
      opening: emptySignalBucket(),
      directing: emptySignalBucket(),
      correcting: emptySignalBucket(),
      confirming: emptySignalBucket(),
      continuing: emptySignalBucket()
    }
  };
}

function emptySignalBucket() {
  return {
    messageCount: 0,
    counts: {
      explicitGoal: 0,
      expectedBehavior: 0,
      constraints: 0,
      filePath: 0,
      errorLog: 0,
      asksPlan: 0,
      asksVerify: 0,
      correction: 0,
      confirmation: 0,
      codeOrData: 0
    },
    ratios: {}
  };
}

// ---------------------------------------------------------------------------
// Session parsing
// ---------------------------------------------------------------------------

function newSessionRecord(file, meta, kind) {
  const indexed = meta.id ? threadIndex.get(meta.id) : null;
  return {
    id: meta.id || path.basename(file, ".jsonl"),
    file,
    kind,
    cwd: normalizePath(meta.cwd),
    timestamp: meta.timestamp || null,
    updatedAt: indexed?.updated_at || meta.timestamp || null,
    lastEventAt: meta.timestamp || null,
    threadName: indexed?.thread_name ? clip(redactSensitiveText(indexed.thread_name), 160) : null,
    source: typeof meta.source === "string" ? meta.source : null,
    modelProvider: meta.model_provider || null,
    humanMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    edits: 0,
    proofPassed: 0,
    proofFailed: 0,
    proofUnknown: 0,
    failedCommands: 0,
    completedTurns: 0,
    abortedTurns: 0,
    startedTurns: 0,
    planUpdates: 0,
    lastPlan: null,
    corrections: 0,
    firstUserMessage: null,
    lastAgentMessage: null,
    currentHuman: null
  };
}

async function parseSession(file, meta, state, kind) {
  const session = newSessionRecord(file, meta, kind);
  state.sessions.push(session);
  if (meta.model_provider) state.models.add(meta.model_provider);
  const sourceLabel = typeof meta.source === "string" ? meta.source : meta.originator;
  if (sourceLabel) state.sources.add(sourceLabel);
  if (Array.isArray(meta.dynamic_tools)) {
    for (const tool of meta.dynamic_tools) {
      if (tool?.namespace && tool?.name) state.dynamicTools.add(`${tool.namespace}.${tool.name}`);
    }
  }

  const pendingExec = new Map(); // call_id -> {command, workdir, timestamp}

  await eachJsonLine(file, (record) => {
    const payload = record.payload || {};
    const timestamp = record.timestamp || payload.timestamp || session.timestamp;
    if (timestamp) session.lastEventAt = timestamp;
    if (payload.oversized) state.oversizedLines += 1;

    if (record.type === "turn_context") {
      if (payload.model) state.models.add(payload.model);
      return;
    }
    if (record.type === "compacted" || payload.type === "context_compacted") {
      state.contextCompactions += 1;
      return;
    }
    if (record.type === "session_meta") return;

    if (payload.type) {
      state.eventTotal += 1;
      if (!KNOWN_PAYLOAD_TYPES.has(payload.type)) {
        state.unknownTypes.set(payload.type, (state.unknownTypes.get(payload.type) || 0) + 1);
      }
    }

    switch (payload.type) {
      case "task_started":
        state.turnStarts += 1;
        session.startedTurns += 1;
        break;
      case "task_complete":
        state.turnCompletes += 1;
        session.completedTurns += 1;
        if (payload.last_agent_message) {
          // narrative only — NOT added to agentMessages (agent_message events already count)
          session.lastAgentMessage = clip(redactSensitiveText(payload.last_agent_message), 220);
        }
        break;
      case "turn_aborted":
        state.turnAborts += 1;
        session.abortedTurns += 1;
        if (session.currentHuman) session.currentHuman.after.aborts += 1;
        break;
      case "user_message":
        addHumanMessage(state, session, payload.message || "", timestamp);
        break;
      case "agent_message":
        state.agentMessages += 1;
        if (payload.message) session.lastAgentMessage = clip(redactSensitiveText(payload.message), 220);
        break;
      case "message":
        if (payload.role === "assistant") {
          const text = extractTextContent(payload.content);
          if (text) {
            state.assistantMessages += 1;
            session.assistantMessages += 1;
          }
        }
        break;
      case "function_call":
        handleFunctionCall(state, session, payload, timestamp, pendingExec);
        break;
      case "custom_tool_call":
        handleCustomToolCall(state, session, payload, timestamp);
        break;
      case "function_call_output":
        handleFunctionCallOutput(state, session, payload, timestamp, pendingExec);
        break;
      case "web_search_call":
        state.counters.webSearchCalls += 1;
        if (payload.action?.query && state.privacyMode !== "strict") {
          state.webQueries.push(clip(redactSensitiveText(payload.action.query), 120));
        }
        addToolCall(state, session, "web_search", payload, timestamp);
        break;
      case "image_generation_call":
        state.counters.imageGenerationCalls += 1;
        addToolCall(state, session, "image_generation", payload, timestamp);
        break;
      case "view_image_tool_call":
        state.counters.viewImageCalls += 1;
        addToolCall(state, session, "view_image", payload, timestamp);
        break;
      case "mcp_tool_call_end":
        handleMcpCallEnd(state, session, payload, timestamp);
        break;
      case "collab_agent_spawn_end":
        recordSubagentSpawn(state, session, payload, timestamp, payload.call_id);
        break;
      case "exec_command_end":
        handleExecCommandEnd(state, session, payload, timestamp);
        break;
      case "patch_apply_end":
        addPatchEvent(state, session, payload, timestamp);
        break;
      case "token_count":
        state.tokenEvents += 1;
        trackContextUsage(state, payload);
        break;
      case "thread_goal_updated":
        state.counters.threadGoalEvents += 1;
        break;
      case "tool_search_call":
        state.counters.toolSearchCalls += 1;
        addToolCall(state, session, "tool_search", payload, timestamp);
        break;
      case "error":
      case "stream_error":
        state.errors += 1;
        break;
      default:
        break;
    }
  });
}

// Subagent threads share the project cwd but their "user messages" are written
// by the parent agent — they must not pollute communication/outcome stats.
// We only aggregate them as orchestration evidence.
async function parseSubagentSession(file, meta, state) {
  state.subagent.sessionCount += 1;
  const spawn = typeof meta.source === "object" ? meta.source?.subagent?.thread_spawn : null;
  const role = spawn?.agent_role || (typeof meta.source === "object" ? Object.keys(meta.source.subagent || {})[0] : "unknown") || "unknown";
  state.subagent.byRole[role] = (state.subagent.byRole[role] || 0) + 1;
  if (spawn?.agent_nickname) state.subagent.nicknames.add(spawn.agent_nickname);
  await eachJsonLine(file, (record) => {
    const payload = record.payload || {};
    if (payload.type === "function_call" || payload.type === "custom_tool_call") state.subagent.toolCalls += 1;
    if (payload.type === "patch_apply_end") state.subagent.edits += 1;
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function addHumanMessage(state, session, text, timestamp) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  const features = classifyMessage(cleaned);
  const message = {
    timestamp,
    text: cleaned,
    sessionId: session.id,
    sessionKind: session.kind,
    index: state.humanMessages.length,
    sessionIndex: session.humanMessages,
    features,
    after: { toolCalls: 0, edits: 0, proofRuns: 0, failedCommands: 0, aborts: 0 }
  };
  state.humanMessages.push(message);
  session.humanMessages += 1;
  session.currentHuman = message;
  if (session.firstUserMessage === null) {
    session.firstUserMessage = clip(redactSensitiveText(cleaned), 220);
  }

  addSignals(state.signals.directing, features);
  if (message.sessionIndex < 2) addSignals(state.signals.opening, features); // per-session opening
  if (features.correction) {
    addSignals(state.signals.correcting, features);
    session.corrections += 1;
    if (features.filePath || features.errorLog || features.codeOrData) state.correctionSubstanceCount += 1;
  }
  if (features.confirmation) addSignals(state.signals.confirming, features);
  if (/^(继续|continue|go on|next|再来|接着)/i.test(cleaned)) addSignals(state.signals.continuing, features);
}

function addToolCall(state, session, name, payload, timestamp, callId = payload?.call_id) {
  if (callId) {
    if (state.countedToolCallIds.has(callId)) return; // dedup across event forms
    state.countedToolCallIds.add(callId);
  }
  const toolName = name || "unknown_tool";
  const category = categorizeTool(toolName, payload);
  state.toolCalls.push({ timestamp, name: toolName, category, sessionId: session.id });
  session.toolCalls += 1;
  if (session.currentHuman) session.currentHuman.after.toolCalls += 1;
}

function handleFunctionCall(state, session, payload, timestamp, pendingExec) {
  const name = payload.name || "unknown_tool";
  addToolCall(state, session, name, payload, timestamp);
  switch (name) {
    case "exec_command":
      if (payload.call_id) {
        const { command, workdir } = parseExecArguments(payload.arguments);
        pendingExec.set(payload.call_id, { command, workdir, timestamp });
      }
      break;
    case "update_plan":
      state.counters.planUpdates += 1;
      session.planUpdates += 1;
      session.lastPlan = parsePlanArguments(payload.arguments);
      break;
    case "spawn_agent":
      recordSubagentSpawn(state, session, payload, timestamp, payload.call_id, true);
      break;
    case "wait_agent":
      for (const target of parseAgentTargets(payload.arguments)) state.subagentLifecycle.waitTargets.add(target);
      break;
    case "close_agent":
      for (const target of parseAgentTargets(payload.arguments)) state.subagentLifecycle.closeTargets.add(target);
      break;
    case "view_image":
      state.counters.viewImageCalls += 1;
      break;
    case "js":
      state.counters.nodeReplCalls += 1;
      break;
    case "web_search":
      state.counters.webSearchCalls += 1;
      break;
    case "create_goal":
    case "update_goal":
    case "get_goal":
      state.counters.goalCalls += 1;
      break;
    default:
      if (name.toLowerCase().includes("browser") || name.toLowerCase().includes("screenshot")) {
        state.counters.browserCalls += 1;
      }
      break;
  }
}

function handleCustomToolCall(state, session, payload, timestamp) {
  addToolCall(state, session, payload.name, payload, timestamp);
  if (payload.name === "apply_patch") {
    // Fallback file extraction — used only if no patch_apply_end events exist at all.
    const files = filesFromPatchText(payload.input);
    if (files.length) state.patchFallbacks.push({ files, session, timestamp });
  }
}

function handleFunctionCallOutput(state, session, payload, timestamp, pendingExec) {
  const callId = payload.call_id;
  if (!callId || !pendingExec.has(callId)) return;
  const pending = pendingExec.get(callId);
  pendingExec.delete(callId);
  const { exitCode, recognized } = extractExitCode(payload.output);
  if (!recognized) state.unknownExitCodeCommands += 1;
  upsertShellCommand(state, session, {
    callId,
    timestamp: pending.timestamp || timestamp,
    command: pending.command,
    cwd: pending.workdir,
    exitCode
  });
}

function handleExecCommandEnd(state, session, payload, timestamp) {
  const command = Array.isArray(payload.command) ? payload.command.join(" ") : String(payload.command || "");
  const parsed = Array.isArray(payload.parsed_cmd)
    ? payload.parsed_cmd.map((item) => item?.cmd).filter(Boolean).join(" ")
    : "";
  upsertShellCommand(state, session, {
    callId: payload.call_id || null,
    timestamp,
    command: parsed || command,
    cwd: payload.cwd || null,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : null
  });
}

// Merge shell info across the two persistence formats, keyed by call_id.
function upsertShellCommand(state, session, entry) {
  let target;
  if (entry.callId && state.shellByCallId.has(entry.callId)) {
    target = state.shellByCallId.get(entry.callId);
    if (!target.command && entry.command) target.command = entry.command;
    if (target.exitCode === null && typeof entry.exitCode === "number") target.exitCode = entry.exitCode;
    return; // outcome already attributed on first sighting
  }
  target = {
    callId: entry.callId,
    timestamp: entry.timestamp,
    command: entry.command || "",
    cwd: entry.cwd || null,
    exitCode: typeof entry.exitCode === "number" ? entry.exitCode : null,
    sessionId: session.id
  };
  if (entry.callId) state.shellByCallId.set(entry.callId, target);
  else state.shellCommands.push(target);
  attributeShellOutcome(state, session, target);
}

function attributeShellOutcome(state, session, shell) {
  const skill = skillNameFromCommand(shell.command);
  if (skill) state.skillReads.set(skill, (state.skillReads.get(skill) || 0) + 1);
  const proof = isProofCommand(shell.command);
  if (proof) {
    if (shell.exitCode === 0) session.proofPassed += 1;
    else if (typeof shell.exitCode === "number") session.proofFailed += 1;
    else session.proofUnknown += 1;
    if (session.currentHuman) session.currentHuman.after.proofRuns += 1;
  }
  if (typeof shell.exitCode === "number" && shell.exitCode !== 0) {
    session.failedCommands += 1;
    if (session.currentHuman) session.currentHuman.after.failedCommands += 1;
  }
}

function handleMcpCallEnd(state, session, payload, timestamp) {
  state.counters.mcpCalls += 1;
  const server = payload.invocation?.server || "unknown";
  const tool = payload.invocation?.tool || "unknown";
  const isError = Boolean(payload.result && typeof payload.result === "object" && "Err" in payload.result);
  const entry = state.mcpByServer.get(server) || { calls: 0, errors: 0, tools: {} };
  entry.calls += 1;
  if (isError) entry.errors += 1;
  entry.tools[tool] = (entry.tools[tool] || 0) + 1;
  state.mcpByServer.set(server, entry);
  addToolCall(state, session, `mcp:${server}.${tool}`, payload, timestamp);
}

function recordSubagentSpawn(state, session, payload, timestamp, callId, fromFunctionCall = false) {
  // Dedup: a spawn may appear both as function_call and collab_agent_spawn_end.
  const key = callId ? `spawn:${callId}` : null;
  if (key && state.countedToolCallIds.has(key)) return;
  if (key) state.countedToolCallIds.add(key);
  state.counters.subagentSpawns += 1;
  state.subagentLifecycle.spawned += 1;
  if (!fromFunctionCall) addToolCall(state, session, "spawn_agent", payload, timestamp, callId ? `tool:${callId}` : undefined);
}

function addPatchEvent(state, session, payload, timestamp) {
  const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  let changedFiles = Object.keys(changes);
  if (changedFiles.length === 0 && typeof payload.stdout === "string") {
    changedFiles = payload.stdout.match(/^[AMD]\s+(.+)$/gm)?.map((line) => line.replace(/^[AMD]\s+/, "")) || [];
  }
  for (const file of changedFiles) state.filesTouched.add(file);
  state.patchEvents.push({
    timestamp,
    success: payload.success !== false && payload.status !== "failed",
    files: changedFiles,
    sessionId: session.id
  });
  const editCount = changedFiles.length || 1;
  session.edits += editCount;
  if (session.currentHuman) session.currentHuman.after.edits += editCount;
}

function trackContextUsage(state, payload) {
  const info = payload.info;
  // last_token_usage.input_tokens approximates the live context size;
  // total_token_usage is cumulative and can exceed the window.
  if (!info?.last_token_usage?.input_tokens || !info.model_context_window) return;
  const pct = info.last_token_usage.input_tokens / info.model_context_window;
  if (pct > state.maxContextUsedPct) state.maxContextUsedPct = Math.min(1, pct);
}

function parsePlanArguments(argsText) {
  try {
    const parsed = JSON.parse(String(argsText || ""));
    const plan = Array.isArray(parsed.plan) ? parsed.plan : [];
    return {
      total: plan.length,
      completed: plan.filter((step) => step?.status === "completed").length
    };
  } catch {
    return null;
  }
}

function parseAgentTargets(argsText) {
  try {
    const parsed = JSON.parse(String(argsText || ""));
    if (Array.isArray(parsed.targets)) return parsed.targets.filter(Boolean);
    if (parsed.target) return [parsed.target];
    return [];
  } catch {
    return [];
  }
}

function addSignals(bucket, features) {
  bucket.messageCount += 1;
  for (const [key, value] of Object.entries(features)) {
    if (value && key in bucket.counts) bucket.counts[key] += 1;
  }
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

function finalizeShellCommands(state) {
  state.allShellCommands = [...state.shellByCallId.values(), ...state.shellCommands]
    .map((entry) => ({ ...entry, proof: isProofCommand(entry.command) }));

  // Recompute session-level proof/failure counts from the merged entries —
  // an exec_command_end may have supplied the exit code after first sighting.
  const sessionById = new Map(state.sessions.map((session) => [session.id, session]));
  for (const session of state.sessions) {
    session.proofPassed = 0;
    session.proofFailed = 0;
    session.proofUnknown = 0;
    session.failedCommands = 0;
  }
  for (const shell of state.allShellCommands) {
    const session = sessionById.get(shell.sessionId);
    if (!session) continue;
    if (shell.proof) {
      if (shell.exitCode === 0) session.proofPassed += 1;
      else if (typeof shell.exitCode === "number") session.proofFailed += 1;
      else session.proofUnknown += 1;
    }
    if (typeof shell.exitCode === "number" && shell.exitCode !== 0) session.failedCommands += 1;
  }

  // apply_patch fallback: only when the format persisted no patch_apply_end at all.
  if (state.patchEvents.length === 0 && state.patchFallbacks.length > 0) {
    for (const fallback of state.patchFallbacks) {
      for (const file of fallback.files) state.filesTouched.add(file);
      state.patchEvents.push({
        timestamp: fallback.timestamp,
        success: true,
        files: fallback.files,
        sessionId: fallback.session.id
      });
      fallback.session.edits += fallback.files.length;
    }
  }
}

function finalizeSignals(state) {
  for (const bucket of Object.values(state.signals)) {
    for (const key of Object.keys(bucket.counts)) {
      bucket.ratios[key] = ratio(bucket.counts[key], bucket.messageCount);
    }
  }
  // Share of corrections that show substance (path / error log / code) —
  // corrections that show, not just tell.
  state.signals.correcting.substanceRatio = state.signals.correcting.messageCount
    ? round2(ratio(state.correctionSubstanceCount, state.signals.correcting.messageCount))
    : null;
}

// ---------------------------------------------------------------------------
// Facts assembly
// ---------------------------------------------------------------------------

function buildFacts(state) {
  const stats = buildStats(state);
  const toolcraftSummary = buildToolcraft(state, stats);
  const outcomeTotals = buildOutcomes(state, stats);
  const projectAssets = inspectProjectAssets(state.cwd);
  const projectProfile = classifyProject(state, stats, outcomeTotals, projectAssets);
  const confidence = computeConfidence(state, stats);
  const dominantLanguage = detectLanguage(state.humanMessages);
  const evidence = buildEvidence(state);
  const modernToolSummary = buildModernToolSummary(state);
  const parserCoverage = buildParserCoverage(state);
  const parserWarnings = buildParserWarnings(state, parserCoverage, toolcraftSummary);
  const selfBaseline = loadSelfBaseline();

  return {
    schemaVersion: "facts-2.1",
    formulaVersion: FORMULA_VERSION,
    generatedAt: new Date().toISOString(),
    privacyMode: state.privacyMode,
    source: { codexHome: CODEX_HOME, selectionMode: state.selectionMode },
    project: {
      cwd: state.cwd,
      displayName: displayNameFromCwd(state.cwd),
      sessionCount: state.sessions.length,
      firstActiveAt: minDate(state.sessions.map((session) => session.timestamp)),
      lastActiveAt: maxDate(state.sessions.map((session) => session.updatedAt || session.lastEventAt || session.timestamp)),
      sessionKinds: countBy(state.sessions, (session) => session.kind)
    },
    projectProfile,
    projectAssets,
    stats,
    toolcraftSummary,
    modernToolSummary,
    outcomeTotals,
    signalsByPosition: state.signals,
    subagentActivity: {
      sessionCount: state.subagent.sessionCount,
      byRole: state.subagent.byRole,
      toolCalls: state.subagent.toolCalls,
      edits: state.subagent.edits,
      nicknames: [...state.subagent.nicknames].slice(0, 10)
    },
    confidenceLevel: confidence.level,
    signalDensity: confidence.signalDensity,
    outcomeDensity: confidence.outcomeDensity,
    dominantLanguage,
    keyMessages: evidence.keyMessages,
    evidenceAtoms: evidence.atoms,
    workflowEpisodes: evidence.episodes,
    criticalIncidents: evidence.incidents,
    sessionFlows: evidence.episodes.map((episode) => ({
      id: episode.sessionId,
      threadName: episode.threadName,
      humanMessages: episode.humanMessages,
      toolCalls: episode.toolCalls,
      edits: episode.edits,
      proofCommands: episode.proofPassed + episode.proofFailed + episode.proofUnknown,
      completedTurns: episode.completedTurns,
      abortedTurns: episode.aborts
    })),
    parserCoverage,
    parserWarnings,
    selfBaseline
  };
}

function buildStats(state) {
  const humanMessages = state.humanMessages.length;
  const totalChars = state.humanMessages.reduce((sum, message) => sum + message.text.length, 0);
  return {
    sessions: state.sessions.length,
    humanMessages,
    assistantMessages: state.assistantMessages,
    agentMessages: state.agentMessages,
    totalToolCalls: state.toolCalls.length,
    shellCommandCount: state.allShellCommands.length,
    patchEventCount: state.patchEvents.length,
    turnStarts: state.turnStarts,
    turnCompletes: state.turnCompletes,
    turnAborts: state.turnAborts,
    silentDrops: Math.max(0, state.turnStarts - state.turnCompletes - state.turnAborts),
    contextCompactions: state.contextCompactions,
    errors: state.errors,
    oversizedLines: state.oversizedLines,
    imageCalls: state.counters.imageGenerationCalls,
    viewImageCalls: state.counters.viewImageCalls,
    webSearchCalls: state.counters.webSearchCalls,
    mcpCalls: state.counters.mcpCalls,
    browserCalls: state.counters.browserCalls,
    planCalls: state.counters.planUpdates,
    subagentCalls: state.counters.subagentSpawns,
    averageHumanMessageLength: humanMessages ? Math.round(totalChars / humanMessages) : 0,
    sources: [...state.sources],
    models: [...state.models]
  };
}

function buildToolcraft(state, stats) {
  const byTool = countBy(state.toolCalls, (call) => call.name);
  const byCategory = countBy(state.toolCalls, (call) => call.category);
  const commandSuccesses = state.allShellCommands.filter((command) => command.exitCode === 0).length;
  const commandFailures = state.allShellCommands.filter((command) => typeof command.exitCode === "number" && command.exitCode !== 0).length;
  const known = commandSuccesses + commandFailures;
  return {
    totalToolCalls: stats.totalToolCalls,
    byTool: topCounts(byTool, 18),
    topTools: topCounts(byTool, 10),
    byCategory: topCounts(byCategory, 12),
    commandSuccesses,
    commandFailures,
    commandsWithUnknownExit: state.unknownExitCodeCommands,
    // null when no command carried a readable exit code — formulas treat null as neutral
    commandSuccessRate: known ? commandSuccesses / known : null,
    dynamicTools: [...state.dynamicTools].sort().slice(0, 24),
    planModeEntries: state.counters.planUpdates,
    planUpdates: state.counters.planUpdates,
    subagentCalls: state.counters.subagentSpawns,
    webSearchCalls: state.counters.webSearchCalls,
    imageCalls: state.counters.imageGenerationCalls,
    viewImageCalls: state.counters.viewImageCalls,
    mcpCalls: state.counters.mcpCalls,
    browserCalls: state.counters.browserCalls,
    toolSearchCalls: state.counters.toolSearchCalls
  };
}

function buildOutcomes(state, stats) {
  const proofPassed = state.sessions.reduce((sum, session) => sum + session.proofPassed, 0);
  const proofFailed = state.sessions.reduce((sum, session) => sum + session.proofFailed, 0);
  const proofUnknown = state.sessions.reduce((sum, session) => sum + session.proofUnknown, 0);
  const successfulPatches = state.patchEvents.filter((event) => event.success).length;
  const fileEditCount = state.patchEvents.reduce((sum, event) => sum + Math.max(1, event.files.length), 0);
  const turnDenominator = Math.max(1, stats.turnStarts || (stats.turnCompletes + stats.turnAborts));
  return {
    fileEditCount,
    distinctFilesTouched: state.filesTouched.size,
    successfulPatches,
    proofCommands: { total: proofPassed + proofFailed + proofUnknown, passed: proofPassed, failed: proofFailed, unknown: proofUnknown },
    cleanEndRatio: ratio(stats.turnCompletes, turnDenominator),
    editsPerHumanMsg: ratio(fileEditCount, stats.humanMessages),
    toolsPerHumanMsg: ratio(stats.totalToolCalls, stats.humanMessages),
    filesPerHumanMsg: ratio(state.filesTouched.size, stats.humanMessages),
    abortRatio: ratio(stats.turnAborts + stats.silentDrops, turnDenominator)
  };
}

function inspectProjectAssets(cwd) {
  const resolved = fileExists(cwd);
  const has = (relativePath) => resolved && fileExists(path.join(cwd, relativePath));
  const entries = resolved ? safeReaddir(cwd) : [];
  const manifestRules = [
    ["javascript", /^(package\.json|deno\.jsonc?|bun\.lockb?)$/i],
    ["python", /^(pyproject\.toml|requirements(?:\.[^.]+)?\.txt|setup\.py|Pipfile)$/i],
    ["rust", /^Cargo\.toml$/i],
    ["go", /^go\.mod$/i],
    ["java", /^(pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$/i],
    ["dotnet", /\.(?:sln|csproj|fsproj|vbproj)$/i],
    ["swift", /^(Package\.swift|.*\.xcodeproj|.*\.xcworkspace)$/i],
    ["ruby", /^(Gemfile|Rakefile|.*\.gemspec)$/i],
    ["php", /^composer\.json$/i],
    ["elixir", /^mix\.exs$/i],
    ["dart", /^pubspec\.yaml$/i],
    ["cpp", /^(CMakeLists\.txt|meson\.build)$/i]
  ];
  const manifestFiles = [];
  const detectedStacks = new Set();
  for (const entry of entries) {
    for (const [stack, pattern] of manifestRules) {
      if (!pattern.test(entry)) continue;
      manifestFiles.push(entry);
      detectedStacks.add(stack);
      break;
    }
  }
  const hasPackageJson = entries.some((entry) => /^package\.json$/i.test(entry));
  const hasPyproject = entries.some((entry) => /^pyproject\.toml$/i.test(entry));
  const hasCargoToml = entries.some((entry) => /^Cargo\.toml$/i.test(entry));
  return {
    cwdResolved: resolved,
    hasAgentsMd: has("AGENTS.md"),
    hasClaudeMd: has("CLAUDE.md"),
    hasCodexDir: has(".codex"),
    hasAgentsDir: has(".agents"),
    hasGit: has(".git"),
    hasPackageJson,
    hasPyproject,
    hasCargoToml,
    hasManifest: manifestFiles.length > 0,
    manifestFiles: manifestFiles.slice(0, 12),
    detectedStacks: [...detectedStacks].sort(),
    hasReadme: entries.some((entry) => /^readme\.(md|txt)$/i.test(entry)),
    hasTestsDir: resolved && hasTestAssets(cwd),
    rootEntryCount: entries.length
  };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function hasTestAssets(root, maxDepth = 2) {
  const ignored = new Set([
    ".git", ".hg", ".svn", "node_modules", "vendor", "Pods", ".build",
    "build", "dist", "coverage", "target", ".venv", "venv"
  ]);
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 500);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (/^(test|tests|__tests__|spec|specs|uitests|integration-tests?)$/i.test(entry.name)) return true;
        if (depth < maxDepth && !ignored.has(entry.name)) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      } else if (
        /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)
        || /_test\.go$/i.test(entry.name)
        || /(?:Tests?|Spec)\.swift$/i.test(entry.name)
        || /(?:Test|Tests)\.(?:cs|fs|java|kt|rb|php|py)$/i.test(entry.name)
      ) {
        return true;
      }
    }
  }
  return false;
}

function classifyProject(state, stats, outcomes, assets) {
  const automationSessions = state.sessions.filter((session) => session.kind === "automation").length;
  const automationShare = ratio(automationSessions, state.sessions.length);
  let type;
  let rationale;
  if (automationShare >= 0.6) {
    type = "automation";
    rationale = {
      en: `${Math.round(automationShare * 100)}% of sessions are non-interactive codex exec runs, so this is judged as an automation pipeline.`,
      zh: `${Math.round(automationShare * 100)}% 的会话是非交互式 codex exec 运行，因此按自动化流水线评估。`
    };
  } else if (outcomes.fileEditCount === 0 && stats.humanMessages >= 4 && outcomes.proofCommands?.total === 0) {
    type = "learning";
    rationale = {
      en: "Conversation-heavy sessions with no file edits or proof runs indicate learning or exploration.",
      zh: "会话以讨论为主，没有文件编辑或验证运行，符合学习探索型项目。"
    };
  } else if (stats.sessions >= 5 || stats.contextCompactions >= 2 || stats.humanMessages >= 30) {
    type = "long_running";
    rationale = {
      en: "Multiple sessions, many messages, or context compactions indicate sustained collaboration.",
      zh: "多个会话、大量消息或上下文压缩表明这是持续协作项目。"
    };
  } else if (outcomes.fileEditCount >= 4 || outcomes.distinctFilesTouched >= 3) {
    type = "feature_build";
    rationale = {
      en: "The edit volume and number of touched files indicate implementation work.",
      zh: "文件编辑量和触及文件数量表明这是实现型工作。"
    };
  } else {
    type = "one_shot";
    rationale = {
      en: "The small number of sessions and messages fits a focused one-shot task.",
      zh: "会话和消息数量较少，符合聚焦的一次性任务。"
    };
  }
  const profile = rubric.profiles[type] || rubric.profiles.one_shot;
  const naDimensions = [...(profile.naDimensions || [])];
  if (!assets.cwdResolved && !naDimensions.includes("architecture")) naDimensions.push("architecture");
  return {
    type,
    label: profile.label,
    rationale,
    automationShare: Math.round(automationShare * 100) / 100,
    categoryWeights: profile.categoryWeights,
    naDimensions
  };
}

function computeConfidence(state, stats) {
  const humanMessages = stats.humanMessages || 0;
  const directing = state.signals.directing;
  const signalSum = Object.values(directing.counts).reduce((sum, value) => sum + value, 0);
  const signalDensity = humanMessages ? signalSum / humanMessages : 0;
  const outcomeDensity = humanMessages ? stats.totalToolCalls / humanMessages : 0;
  let level = "high";
  if (humanMessages < 5) {
    level = "low";
  } else if (humanMessages < 20 && signalDensity < 1.2 && outcomeDensity < 2) {
    level = "low";
  } else if (humanMessages < 40 && (signalDensity < 1.2 || outcomeDensity < 1)) {
    level = "medium";
  } else if (humanMessages < 50) {
    level = "medium";
  }
  return { level, signalDensity: round2(signalDensity), outcomeDensity: round2(outcomeDensity) };
}

function detectLanguage(messages) {
  let cjk = 0;
  let letters = 0;
  let msgWithCjk = 0;
  for (const message of messages) {
    const stripped = String(message.text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/[\w@./:-]+\.[a-z0-9]+/gi, " ");
    const cjkChars = (stripped.match(/[一-鿿]/g) || []).length;
    const letterChars = (stripped.match(/[a-zA-Z一-鿿]/g) || []).length;
    cjk += cjkChars;
    letters += letterChars;
    if (cjkChars > 0) msgWithCjk += 1;
  }
  const charRatio = letters ? cjk / letters : 0;
  const msgRatio = messages.length ? msgWithCjk / messages.length : 0;
  return charRatio > 0.15 || msgRatio > 0.3 ? "zh" : "en";
}

// ---------------------------------------------------------------------------
// Evidence pipeline v2: atoms, episodes, incidents, stratified key messages
// ---------------------------------------------------------------------------

function messageInterestScore(message) {
  const f = message.features;
  return (f.correction ? 4 : 0) + (f.errorLog ? 3 : 0) + (f.asksVerify ? 2 : 0)
    + (f.codeOrData ? 2 : 0) + (f.constraints ? 1 : 0) + (f.expectedBehavior ? 1 : 0)
    + (f.filePath ? 1 : 0) + Math.min(2, message.text.length / 300);
}

function buildEvidence(state) {
  const evidenceText = (message, max) => {
    if (state.privacyMode === "strict") {
      const features = Object.keys(message.features || {}).filter((key) => message.features[key]);
      return `[content omitted in strict mode; signals: ${features.join(", ") || "none"}]`;
    }
    return clip(redactSensitiveText(message.text), max);
  };
  const commandText = (command, max) => state.privacyMode === "strict"
    ? "[command omitted in strict mode]"
    : clip(redactSensitiveText(command), max);

  // --- stratified key messages across three time windows ---
  const all = state.humanMessages;
  const interesting = all.filter((message) => messageInterestScore(message) >= 1);
  const third = Math.max(1, Math.ceil(all.length / 3));
  const windows = [[], [], []];
  for (const message of interesting) {
    windows[Math.min(2, Math.floor(message.index / third))].push(message);
  }
  const picked = [];
  for (const window of windows) {
    window.sort((a, b) => messageInterestScore(b) - messageInterestScore(a));
    picked.push(...window.slice(0, 10));
  }
  picked.sort((a, b) => a.index - b.index);
  const selected = picked.slice(0, 30);

  // --- evidence atoms: selected messages + notable shell failures + aborts ---
  const atoms = [];
  let atomSeq = 0;
  const atomIdByMessageIndex = new Map();
  for (const message of selected) {
    const id = `a${++atomSeq}`;
    atomIdByMessageIndex.set(message.index, id);
    atoms.push({
      id,
      role: "user",
      sessionId: message.sessionId,
      timestamp: message.timestamp,
      snippet: evidenceText(message, 400),
      features: Object.keys(message.features).filter((key) => message.features[key]),
      after: message.after
    });
  }

  const failedShell = state.allShellCommands.filter((command) => typeof command.exitCode === "number" && command.exitCode !== 0);
  const failuresByCommand = new Map();
  for (const shell of failedShell) {
    const key = normalizeCommand(shell.command);
    const entry = failuresByCommand.get(key) || { command: key, failures: 0, sessions: new Set(), lastExitCode: shell.exitCode };
    entry.failures += 1;
    entry.sessions.add(shell.sessionId);
    entry.lastExitCode = shell.exitCode;
    failuresByCommand.set(key, entry);
  }
  const topFailures = [...failuresByCommand.values()].sort((a, b) => b.failures - a.failures).slice(0, 8);
  const failureAtomIds = new Map();
  for (const failure of topFailures) {
    const id = `a${++atomSeq}`;
    failureAtomIds.set(failure.command, id);
    atoms.push({
      id,
      role: "shell",
      sessionId: [...failure.sessions][0] || null,
      timestamp: null,
      snippet: `${commandText(failure.command, 160)} → exit ${failure.lastExitCode} (${failure.failures}× failed)`,
      features: ["commandFailure"],
      after: null
    });
  }

  // --- critical incidents ---
  const incidents = [];
  let incidentSeq = 0;
  const addIncident = (incident) => incidents.push({ id: `i${++incidentSeq}`, ...incident });
  for (const failure of topFailures.filter((entry) => entry.failures >= 2).slice(0, 4)) {
    addIncident({
      type: "command_retry_churn",
      summary: `Command failed ${failure.failures}× across ${failure.sessions.size} session(s): ${commandText(failure.command, 120)}`,
      sessionIds: [...failure.sessions].slice(0, 3),
      evidenceRefs: [failureAtomIds.get(failure.command)].filter(Boolean)
    });
  }
  const correctionMessages = selected.filter((message) => message.features.correction)
    .sort((a, b) => messageInterestScore(b) - messageInterestScore(a))
    .slice(0, 4);
  for (const message of correctionMessages) {
    addIncident({
      type: "correction",
      summary: `User course-corrected: ${evidenceText(message, 140)}`,
      sessionIds: [message.sessionId],
      evidenceRefs: [atomIdByMessageIndex.get(message.index)].filter(Boolean)
    });
  }
  const abortedSessions = state.sessions.filter((session) => session.abortedTurns > 0).slice(0, 2);
  for (const session of abortedSessions) {
    addIncident({
      type: "aborted_turns",
      summary: `${session.abortedTurns} aborted turn(s) in session ${
        state.privacyMode === "strict" ? session.id : (session.threadName || session.id)
      }`,
      sessionIds: [session.id],
      evidenceRefs: []
    });
  }
  if (state.contextCompactions >= 2) {
    addIncident({
      type: "context_pressure",
      summary: `${state.contextCompactions} context compactions across the project — sessions run long enough to lose context.`,
      sessionIds: [],
      evidenceRefs: []
    });
  }

  // --- workflow episodes: last 20 sessions + earlier ones with trouble ---
  const chronological = [...state.sessions].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const tail = chronological.slice(-20);
  const troubled = chronological.slice(0, -20).filter((session) => session.abortedTurns > 0 || session.failedCommands >= 3);
  const episodeSessions = [...troubled.slice(-8), ...tail];
  const episodes = episodeSessions.map((session) => ({
    sessionId: session.id,
    kind: session.kind,
    threadName: state.privacyMode === "strict" ? null : session.threadName,
    startedAt: session.timestamp,
    endedAt: session.lastEventAt,
    durationMinutes: durationMinutes(session.timestamp, session.lastEventAt),
    humanMessages: session.humanMessages,
    toolCalls: session.toolCalls,
    edits: session.edits,
    proofPassed: session.proofPassed,
    proofFailed: session.proofFailed,
    proofUnknown: session.proofUnknown,
    failedCommands: session.failedCommands,
    completedTurns: session.completedTurns,
    aborts: session.abortedTurns,
    planUpdates: session.planUpdates,
    planCompletion: session.lastPlan,
    corrections: session.corrections,
    firstUserMessage: state.privacyMode === "strict" ? null : session.firstUserMessage,
    lastAgentMessage: state.privacyMode === "strict" ? null : session.lastAgentMessage
  }));

  const keyMessages = selected.map((message) => ({
    timestamp: message.timestamp,
    sessionId: message.sessionId,
    atomId: atomIdByMessageIndex.get(message.index),
    text: evidenceText(message, 400),
    features: Object.keys(message.features).filter((key) => message.features[key]),
    after: message.after
  }));

  return { keyMessages, atoms, episodes, incidents: incidents.slice(0, 12) };
}

function buildModernToolSummary(state) {
  const mcpByServer = {};
  for (const [server, entry] of state.mcpByServer) {
    mcpByServer[server] = {
      calls: entry.calls,
      errors: entry.errors,
      tools: topCounts(entry.tools, 8)
    };
  }
  const lifecycle = state.subagentLifecycle;
  const closed = lifecycle.closeTargets.size;
  const planSessions = state.sessions.filter((session) => session.lastPlan);
  const planCompletionAvg = planSessions.length
    ? round2(planSessions.reduce((sum, session) => sum + ratio(session.lastPlan.completed, Math.max(1, session.lastPlan.total)), 0) / planSessions.length)
    : null;
  return {
    mcpByServer,
    subagentLifecycle: {
      spawned: lifecycle.spawned,
      waited: lifecycle.waitTargets.size,
      closed,
      orphanedEstimate: Math.max(0, lifecycle.spawned - closed)
    },
    plans: {
      updates: state.counters.planUpdates,
      sessionsWithPlan: planSessions.length,
      planCompletionAvg
    },
    goals: {
      goalToolCalls: state.counters.goalCalls,
      threadGoalEvents: state.counters.threadGoalEvents
    },
    toolSearch: { calls: state.counters.toolSearchCalls },
    skillReads: topCounts(Object.fromEntries(state.skillReads), 8),
    web: {
      searches: state.counters.webSearchCalls,
      topQueries: state.webQueries.slice(0, 5)
    },
    images: {
      generated: state.counters.imageGenerationCalls,
      viewed: state.counters.viewImageCalls
    },
    nodeRepl: { jsCalls: state.counters.nodeReplCalls },
    contextHygiene: {
      compactions: state.contextCompactions,
      oversizedLines: state.oversizedLines,
      maxContextUsedPct: round2(state.maxContextUsedPct)
    }
  };
}

function buildParserCoverage(state) {
  const unknownTotal = [...state.unknownTypes.values()].reduce((sum, value) => sum + value, 0);
  return {
    eventsTotal: state.eventTotal,
    eventsUnknown: unknownTotal,
    unknownTypes: topCounts(Object.fromEntries(state.unknownTypes), 8),
    coverageRatio: state.eventTotal ? round2(1 - unknownTotal / state.eventTotal) : 1
  };
}

function buildParserWarnings(state, coverage, toolcraft) {
  const warnings = [];
  if (coverage.eventsTotal > 200 && coverage.coverageRatio < 0.9) {
    warnings.push(`Parser coverage is ${Math.round(coverage.coverageRatio * 100)}% — the Codex rollout format may have drifted; consider updating codex-radar.`);
  }
  if (state.unknownExitCodeCommands > 0) {
    warnings.push(`${state.unknownExitCodeCommands} shell command output(s) had no recognizable exit-code format; command success rate covers the rest.`);
  }
  if (toolcraft.commandSuccessRate === null && state.allShellCommands.length > 0) {
    warnings.push("No shell command carried a readable exit code — success-rate signals were treated as neutral.");
  }
  if (state.oversizedLines > 0) {
    warnings.push(`${state.oversizedLines} oversized session line(s) (>2MB) were only partially parsed.`);
  }
  return warnings;
}

function loadSelfBaseline() {
  const baselinePath = path.join(RADAR_HOME, "cache", "self-baseline.json");
  try {
    const raw = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    if (raw && raw.schemaVersion === "self-baseline-1") return raw;
  } catch { /* absent or unreadable — fine */ }
  return null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function durationMinutes(start, end) {
  const a = new Date(start || 0).getTime();
  const b = new Date(end || 0).getTime();
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / 60000);
}

function round2(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function minDate(values) {
  const dates = values.filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

function maxDate(values) {
  const dates = values.filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}
