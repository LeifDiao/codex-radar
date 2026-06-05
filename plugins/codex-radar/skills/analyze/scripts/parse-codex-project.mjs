#!/usr/bin/env node
// parse-codex-project.mjs — extract deterministic FACTS from local Codex sessions.
// It does NOT score. The Codex model reads these facts + data/rubric.json and
// authors the scores, diagnosis, and suggestions (see SKILL.md).
import fs from "node:fs";
import path from "node:path";
import {
  allSessionFiles,
  clip,
  CODEX_HOME,
  countBy,
  displayNameFromCwd,
  eachJsonLine,
  ensureDir,
  extractTextContent,
  fileExists,
  isSameOrChild,
  loadRubric,
  loadThreadIndex,
  normalizePath,
  RADAR_HOME,
  ratio,
  readSessionMeta,
  topCounts
} from "./lib.mjs";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rubric = loadRubric(SKILL_DIR);

function usage() {
  console.error("Usage: node parse-codex-project.mjs <project-cwd>");
  process.exit(2);
}

const projectCwd = normalizePath(process.argv[2]);
if (!projectCwd) usage();

const threadIndex = loadThreadIndex();
const files = await allSessionFiles();
const metas = [];
for (const file of files) {
  const meta = await readSessionMeta(file);
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

const state = createEmptyState(projectCwd, selectionMode);
for (const entry of selected) {
  await parseSession(entry.file, entry.meta, state);
}

finalizeSignals(state);
const facts = buildFacts(state);

const tempDir = path.join(RADAR_HOME, "temp");
ensureDir(tempDir);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const factsPath = path.join(tempDir, `codex-facts-${stamp}.json`);
fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2) + "\n");

console.log(JSON.stringify({
  factsPath,
  project: facts.project.displayName,
  profile: facts.projectProfile.label,
  profileType: facts.projectProfile.type,
  sessions: facts.project.sessionCount,
  humanMessages: facts.stats.humanMessages,
  confidence: facts.confidenceLevel,
  dominantLanguage: facts.dominantLanguage
}, null, 2));

function createEmptyState(cwd, selectionMode) {
  return {
    cwd,
    selectionMode,
    sessions: [],
    humanMessages: [],
    assistantMessages: [],
    agentMessages: [],
    toolCalls: [],
    shellCommands: [],
    patchEvents: [],
    turnStarts: 0,
    turnCompletes: 0,
    turnAborts: 0,
    contextCompactions: 0,
    errors: 0,
    imageCalls: 0,
    webSearchCalls: 0,
    mcpCalls: 0,
    browserCalls: 0,
    planCalls: 0,
    subagentCalls: 0,
    tokenEvents: 0,
    dynamicTools: new Set(),
    models: new Set(),
    sources: new Set(),
    filesTouched: new Set(),
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

async function parseSession(file, meta, state) {
  const indexed = meta.id ? threadIndex.get(meta.id) : null;
  const session = {
    id: meta.id || path.basename(file, ".jsonl"),
    file,
    cwd: normalizePath(meta.cwd),
    timestamp: meta.timestamp || null,
    updatedAt: indexed?.updated_at || meta.timestamp || null,
    threadName: indexed?.thread_name || null,
    source: meta.source || meta.originator || null,
    modelProvider: meta.model_provider || null,
    humanMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    edits: 0,
    proofCommands: 0,
    completedTurns: 0,
    abortedTurns: 0
  };
  state.sessions.push(session);
  if (meta.model_provider) state.models.add(meta.model_provider);
  if (meta.source || meta.originator) state.sources.add(meta.source || meta.originator);
  if (Array.isArray(meta.dynamic_tools)) {
    for (const tool of meta.dynamic_tools) {
      if (tool?.namespace && tool?.name) state.dynamicTools.add(`${tool.namespace}.${tool.name}`);
    }
  }

  await eachJsonLine(file, (record) => {
    const payload = record.payload || {};
    const timestamp = record.timestamp || payload.timestamp || session.timestamp;

    if (record.type === "turn_context") {
      if (payload.model) state.models.add(payload.model);
      return;
    }

    if (record.type === "compacted" || payload.type === "context_compacted") {
      state.contextCompactions += 1;
      return;
    }

    switch (payload.type) {
      case "task_started":
        state.turnStarts += 1;
        break;
      case "task_complete":
        state.turnCompletes += 1;
        session.completedTurns += 1;
        if (payload.last_agent_message) {
          state.agentMessages.push({
            timestamp,
            text: payload.last_agent_message,
            phase: "final",
            sessionId: session.id
          });
        }
        break;
      case "turn_aborted":
        state.turnAborts += 1;
        session.abortedTurns += 1;
        break;
      case "user_message":
        addHumanMessage(state, session, payload.message || "", timestamp);
        break;
      case "agent_message":
        state.agentMessages.push({
          timestamp,
          text: payload.message || "",
          phase: payload.phase || null,
          sessionId: session.id
        });
        break;
      case "message":
        if (payload.role === "assistant") {
          const text = extractTextContent(payload.content);
          if (text) {
            state.assistantMessages.push({ timestamp, text, sessionId: session.id });
            session.assistantMessages += 1;
          }
        }
        break;
      case "function_call":
        addToolCall(state, session, payload.name, payload, timestamp);
        break;
      case "custom_tool_call":
        addToolCall(state, session, payload.name, payload, timestamp);
        break;
      case "web_search_call":
        state.webSearchCalls += 1;
        addToolCall(state, session, "web_search", payload, timestamp);
        break;
      case "image_generation_call":
        state.imageCalls += 1;
        addToolCall(state, session, "image_generation", payload, timestamp);
        break;
      case "view_image_tool_call":
        state.browserCalls += 1;
        addToolCall(state, session, "view_image", payload, timestamp);
        break;
      case "mcp_tool_call_end":
        state.mcpCalls += 1;
        addToolCall(state, session, "mcp_tool", payload, timestamp);
        break;
      case "collab_agent_spawn_end":
        state.subagentCalls += 1;
        addToolCall(state, session, "spawn_agent", payload, timestamp);
        break;
      case "exec_command_end":
        addShellCommand(state, session, payload, timestamp);
        break;
      case "patch_apply_end":
        addPatchEvent(state, session, payload, timestamp);
        break;
      case "token_count":
        state.tokenEvents += 1;
        break;
      case "error":
        state.errors += 1;
        break;
      default:
        break;
    }
  });
}

function addHumanMessage(state, session, text, timestamp) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  const message = {
    timestamp,
    text: cleaned,
    sessionId: session.id,
    index: state.humanMessages.length,
    features: classifyMessage(cleaned)
  };
  state.humanMessages.push(message);
  session.humanMessages += 1;
  addSignals(state.signals.directing, message.features);
  if (message.index < 2) addSignals(state.signals.opening, message.features);
  if (message.features.correction) addSignals(state.signals.correcting, message.features);
  if (message.features.confirmation) addSignals(state.signals.confirming, message.features);
  if (/继续|continue|go on|next|再来|more/i.test(cleaned)) {
    addSignals(state.signals.continuing, message.features);
  }
}

function addToolCall(state, session, name, payload, timestamp) {
  const toolName = name || "unknown_tool";
  state.toolCalls.push({
    timestamp,
    name: toolName,
    category: categorizeTool(toolName, payload),
    sessionId: session.id
  });
  session.toolCalls += 1;
  if (toolName === "update_plan") state.planCalls += 1;
  if (toolName === "spawn_agent") state.subagentCalls += 1;
}

function addShellCommand(state, session, payload, timestamp) {
  const command = Array.isArray(payload.command) ? payload.command.join(" ") : String(payload.command || "");
  const parsed = Array.isArray(payload.parsed_cmd)
    ? payload.parsed_cmd.map((item) => item?.cmd).filter(Boolean).join(" ")
    : "";
  const commandText = parsed || command;
  const shell = {
    timestamp,
    command: commandText,
    cwd: payload.cwd || null,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : null,
    status: payload.status || null,
    proof: isProofCommand(commandText),
    sessionId: session.id
  };
  state.shellCommands.push(shell);
  if (shell.proof) session.proofCommands += 1;
}

function addPatchEvent(state, session, payload, timestamp) {
  const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  const changedFiles = Object.keys(changes);
  for (const file of changedFiles) state.filesTouched.add(file);
  state.patchEvents.push({
    timestamp,
    success: payload.success !== false,
    status: payload.status || null,
    files: changedFiles,
    sessionId: session.id
  });
  session.edits += changedFiles.length || 1;
}

function categorizeTool(name, payload) {
  const normalized = String(name || "").toLowerCase();
  if (["exec_command", "write_stdin"].includes(normalized)) return "shell";
  if (normalized.includes("patch") || normalized === "apply_patch" || normalized === "write") return "editing";
  if (normalized.includes("plan")) return "planning";
  if (normalized.includes("web") || normalized.includes("search") || normalized.includes("openai_doc")) return "research";
  if (normalized.includes("image") || normalized.includes("view_image")) return "visual";
  if (normalized.includes("browser") || normalized.includes("screenshot")) return "browser";
  if (normalized.includes("mcp")) return "mcp";
  if (normalized.includes("agent") || normalized.includes("collab")) return "multi-agent";
  if (payload?.namespace) return payload.namespace;
  return "other";
}

function isProofCommand(command) {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|check|lint|typecheck)\b/i.test(command)
    || /\b(pytest|ruff|mypy|cargo\s+test|cargo\s+check|go\s+test|swift\s+test|xcodebuild|playwright|vitest|jest|tsc)\b/i.test(command)
    || /screenshot|render|validate|doctor|检查|验证/i.test(command);
}

function classifyMessage(text) {
  const t = text.toLowerCase();
  const has = (regex) => regex.test(text) || regex.test(t);
  return {
    explicitGoal: has(/(做|生成|实现|修复|分析|检查|创建|开始|build|make|create|fix|analyze|implement|review)/i),
    expectedBehavior: has(/(应该|希望|需要|保持|确保|must|should|expect|want|need|make sure)/i),
    constraints: has(/(不要|不能|只|仅|必须|避免|without|avoid|only|never|must not)/i),
    filePath: has(/(?:^|\s|`)(?:\.{0,2}\/)?[\w@./: -]+\.(?:js|mjs|ts|tsx|jsx|py|md|json|html|css|scss|swift|kt|java|go|rs|sh|yaml|yml|toml|xml|sql|csv|tsx?)(?:`|\s|$)/i),
    errorLog: has(/(error|exception|traceback|failed|failure|报错|错误|失败|不对|crash|崩)/i),
    asksPlan: has(/(plan|方案|计划|先.*看|先.*分析|怎么做|approach|strategy|review)/i),
    asksVerify: has(/(test|build|check|lint|验证|检查|跑一下|截图|确认|verify|screenshot)/i),
    correction: has(/(不是|不对|错|改成|别|停|应该是|wrong|instead|not that|actually)/i),
    confirmation: has(/^(?:(?:ok|okay|yes|y)\b|对|可以|好|继续|行|明白|收到)/i),
    codeOrData: text.includes("```") || /[{[]["\w-]+["\w\s-]*[:=]/.test(text)
  };
}

function addSignals(bucket, features) {
  bucket.messageCount += 1;
  for (const [key, value] of Object.entries(features)) {
    if (value && key in bucket.counts) bucket.counts[key] += 1;
  }
}

function finalizeSignals(state) {
  for (const bucket of Object.values(state.signals)) {
    for (const key of Object.keys(bucket.counts)) {
      bucket.ratios[key] = ratio(bucket.counts[key], bucket.messageCount);
    }
  }
}

function buildFacts(state) {
  const stats = buildStats(state);
  const toolcraftSummary = buildToolcraft(state, stats);
  const outcomeTotals = buildOutcomes(state, stats);
  const projectAssets = inspectProjectAssets(state.cwd);
  const projectProfile = classifyProject(stats, outcomeTotals, projectAssets);
  const confidence = computeConfidence(state, stats);
  const dominantLanguage = detectLanguage(state.humanMessages);

  return {
    schemaVersion: "facts-2.0",
    generatedAt: new Date().toISOString(),
    source: {
      codexHome: CODEX_HOME,
      selectionMode: state.selectionMode
    },
    project: {
      cwd: state.cwd,
      displayName: displayNameFromCwd(state.cwd),
      sessionCount: state.sessions.length,
      firstActiveAt: minDate(state.sessions.map((session) => session.timestamp)),
      lastActiveAt: maxDate(state.sessions.map((session) => session.updatedAt || session.timestamp)),
      sessions: state.sessions.map((session) => ({
        id: session.id,
        threadName: session.threadName,
        timestamp: session.timestamp,
        updatedAt: session.updatedAt,
        source: session.source,
        humanMessages: session.humanMessages,
        toolCalls: session.toolCalls,
        edits: session.edits,
        completedTurns: session.completedTurns,
        abortedTurns: session.abortedTurns
      }))
    },
    projectProfile,
    projectAssets,
    stats,
    toolcraftSummary,
    outcomeTotals,
    signalsByPosition: state.signals,
    confidenceLevel: confidence.level,
    signalDensity: confidence.signalDensity,
    outcomeDensity: confidence.outcomeDensity,
    dominantLanguage,
    keyMessages: state.humanMessages
      .filter((message) => message.features.filePath || message.features.expectedBehavior || message.features.errorLog || message.features.asksVerify || message.features.correction)
      .slice(0, 12)
      .map((message) => ({
        timestamp: message.timestamp,
        text: clip(message.text, 220),
        features: Object.keys(message.features).filter((key) => message.features[key])
      })),
    sampleExchanges: buildSampleExchanges(state),
    sessionFlows: state.sessions.slice(-12).map((session) => ({
      id: session.id,
      threadName: session.threadName,
      humanMessages: session.humanMessages,
      toolCalls: session.toolCalls,
      edits: session.edits,
      proofCommands: session.proofCommands,
      completedTurns: session.completedTurns,
      abortedTurns: session.abortedTurns
    }))
  };
}

function buildStats(state) {
  const humanMessages = state.humanMessages.length;
  const userText = state.humanMessages.map((message) => message.text).join("\n");
  return {
    sessions: state.sessions.length,
    humanMessages,
    assistantMessages: state.assistantMessages.length,
    agentMessages: state.agentMessages.length,
    totalToolCalls: state.toolCalls.length,
    shellCommandCount: state.shellCommands.length,
    patchEventCount: state.patchEvents.length,
    turnStarts: state.turnStarts,
    turnCompletes: state.turnCompletes,
    turnAborts: state.turnAborts,
    contextCompactions: state.contextCompactions,
    errors: state.errors,
    imageCalls: state.imageCalls,
    webSearchCalls: state.webSearchCalls,
    mcpCalls: state.mcpCalls,
    browserCalls: state.browserCalls,
    planCalls: state.planCalls,
    subagentCalls: state.subagentCalls,
    averageHumanMessageLength: humanMessages ? Math.round(userText.length / humanMessages) : 0,
    sources: [...state.sources],
    models: [...state.models]
  };
}

function buildToolcraft(state, stats) {
  const byTool = countBy(state.toolCalls, (call) => call.name);
  const byCategory = countBy(state.toolCalls, (call) => call.category);
  const commandSuccesses = state.shellCommands.filter((command) => command.exitCode === 0).length;
  const commandFailures = state.shellCommands.filter((command) => typeof command.exitCode === "number" && command.exitCode !== 0).length;
  return {
    totalToolCalls: stats.totalToolCalls,
    byTool: topCounts(byTool, 18),
    topTools: topCounts(byTool, 10),
    byCategory: topCounts(byCategory, 12),
    commandSuccesses,
    commandFailures,
    commandSuccessRate: ratio(commandSuccesses, commandSuccesses + commandFailures),
    dynamicTools: [...state.dynamicTools].sort().slice(0, 24),
    planModeEntries: state.planCalls,
    planUpdates: state.planCalls,
    subagentCalls: state.subagentCalls,
    webSearchCalls: state.webSearchCalls,
    imageCalls: state.imageCalls,
    mcpCalls: state.mcpCalls,
    browserCalls: state.browserCalls
  };
}

function buildOutcomes(state, stats) {
  const proofCommands = state.shellCommands.filter((command) => command.proof).length;
  const successfulPatches = state.patchEvents.filter((event) => event.success).length;
  const fileEditCount = state.patchEvents.reduce((sum, event) => sum + Math.max(1, event.files.length), 0);
  return {
    fileEditCount,
    distinctFilesTouched: state.filesTouched.size,
    successfulPatches,
    proofCommands,
    proofCommandRatio: ratio(proofCommands, Math.max(1, stats.turnCompletes + stats.turnAborts)),
    cleanEndRatio: ratio(stats.turnCompletes, stats.turnCompletes + stats.turnAborts),
    editsPerHumanMsg: ratio(fileEditCount, stats.humanMessages),
    toolsPerHumanMsg: ratio(stats.totalToolCalls, stats.humanMessages),
    filesPerHumanMsg: ratio(state.filesTouched.size, stats.humanMessages),
    abortRatio: ratio(stats.turnAborts, stats.turnCompletes + stats.turnAborts)
  };
}

function inspectProjectAssets(cwd) {
  const resolved = fileExists(cwd);
  const has = (relativePath) => resolved && fileExists(path.join(cwd, relativePath));
  const entries = resolved ? safeReaddir(cwd) : [];
  const hasPackageJson = has("package.json");
  const hasPyproject = has("pyproject.toml");
  const hasCargoToml = has("Cargo.toml");
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
    hasManifest: hasPackageJson || hasPyproject || hasCargoToml,
    hasReadme: entries.some((entry) => /^readme\.(md|txt)$/i.test(entry)),
    hasTestsDir: entries.some((entry) => /^(test|tests|__tests__|spec)$/i.test(entry)),
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

function classifyProject(stats, outcomes, assets) {
  let type = "one_shot";
  let rationale = "Few sessions or messages; judged with lighter engineering expectations.";
  if (stats.sessions >= 5 || stats.contextCompactions >= 2 || stats.humanMessages >= 30) {
    type = "long_running";
    rationale = "Multiple sessions or compactions indicate a sustained collaboration.";
  } else if (outcomes.fileEditCount >= 4 || outcomes.distinctFilesTouched >= 3) {
    type = "feature_build";
    rationale = "File edits and touched files indicate implementation work.";
  } else if (outcomes.fileEditCount === 0 && stats.humanMessages >= 4) {
    type = "learning";
    rationale = "Conversation-heavy session with little file editing looks exploratory.";
  }
  const profile = rubric.profiles[type];
  const naDimensions = [...(profile.naDimensions || [])];
  if (!assets.cwdResolved && !naDimensions.includes("architecture")) naDimensions.push("architecture");
  return {
    type,
    label: profile.label,
    rationale,
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

function buildSampleExchanges(state) {
  return state.humanMessages.slice(0, 8).map((message) => ({
    user: clip(message.text, 220),
    timestamp: message.timestamp,
    features: Object.keys(message.features).filter((key) => message.features[key])
  }));
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
