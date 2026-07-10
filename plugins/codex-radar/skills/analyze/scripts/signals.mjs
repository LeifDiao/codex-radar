// signals.mjs — pure signal-detection functions shared by the parser and tests.
// Everything here is deterministic: same input, same output.

// ---------------------------------------------------------------------------
// Message feature classification (bilingual EN + 中文)
// ---------------------------------------------------------------------------

const RE_EXPLICIT_GOAL = /(帮我|请|做一?个|生成|实现|修复|修一下|分析|检查|排查|创建|新建|写一?个|改一下|重构|优化|翻译|整理|部署|build|make|create|fix|add|implement|refactor|analyze|write|update|generate|deploy|debug|investigate)/i;
const RE_EXPECTED_BEHAVIOR = /(应该|希望|期望|需要|要求|保持|确保|要能|得能|must|should|expect|want it to|need it to|needs to|make sure|ensure|so that)/i;
const RE_CONSTRAINTS = /(不要|不能|不许|不得|禁止|必须|避免|保持不变|别动|只能|仅限|do not|don't|must not|mustn't|never|avoid|without (changing|touching|breaking)|only (change|modify|touch)|keep .* (unchanged|as is))/i;
const RE_FILE_PATH = /(?:^|[\s`"'(])(?:~?\.{0,2}\/)?[\w@./:一-龥-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|md|json|jsonl|html|css|scss|swift|kt|java|go|rs|sh|zsh|yaml|yml|toml|xml|sql|csv|txt|vue|svelte|php|rb|ipynb)(?:[`"')\s:,.]|$)/i;
const RE_ERROR_LOG = /(error|exception|traceback|stack trace|failed|failure|报错|错误|异常|失败|crash|崩溃|panic|ENOENT|EACCES|undefined is not|cannot read|segfault|exit code [1-9])/i;
const RE_ASKS_PLAN = /(先.{0,6}(方案|计划|规划|思路|分析|看看|调研)|出个方案|列个?(步骤|计划|清单)|make a plan|plan (this|it|first)|step[- ]by[- ]step plan|what('s| is) (the|your) (approach|plan)|how (would|should) (you|we) (approach|do))/i;
const RE_ASKS_VERIFY = /(跑一下.{0,10}(测试|test|build|lint)|运行.{0,8}(测试|test)|测试一下|验证一下|自测|确认(一下)?(没问题|能用|可用|是否|正常)|检查(一下)?(是否|有没有|能不能)|run (the )?tests?|run (the )?build|verify (that|it|this)|make sure it (works|passes|builds)|check (that|if) it (works|passes|runs)|截图(看看|确认|给我)|(show|send) me a screenshot|double[- ]check)/i;
const RE_CORRECTION = /(^(不|别|停|等等|no[,.\s]|stop|wait)\b|不对|错了|搞错|理解错|不是这个|不是让你|不是这样|改成|改为|改回|换成|重来|重新(来|做|写)|回退|撤销|revert|undo|that'?s (not|wrong)|not what i|wrong file|wrong place|instead of that|actually,? no|redo)/i;
// NB: \b does not work after CJK characters — use an explicit boundary lookahead.
const RE_CONFIRM_WORD = /^(ok(ay)?|yes|yep|y|sure|lgtm|go ahead|proceed|嗯+|好的|好滴|好|对的|对|可以|行|继续|明白|收到|没问题|👍)(?=$|[\s，。,.!！~？?、])/i;

export function classifyMessage(text) {
  const raw = String(text || "");
  const trimmed = raw.trim();
  const has = (regex) => regex.test(trimmed);
  const confirmation = RE_CONFIRM_WORD.test(trimmed)
    && (trimmed.length <= 20 || /^[\p{L}\p{N}👍]+[\s，。,.!！~]*$/u.test(trimmed));
  return {
    explicitGoal: trimmed.length >= 6 && !confirmation && has(RE_EXPLICIT_GOAL),
    expectedBehavior: has(RE_EXPECTED_BEHAVIOR),
    constraints: has(RE_CONSTRAINTS),
    filePath: has(RE_FILE_PATH),
    errorLog: has(RE_ERROR_LOG),
    asksPlan: has(RE_ASKS_PLAN),
    asksVerify: has(RE_ASKS_VERIFY),
    correction: has(RE_CORRECTION),
    confirmation,
    codeOrData: raw.includes("```")
      || /^\s*[{[][\s\S]*[}\]]\s*$/.test(trimmed)
      || /(^|\n)\s{4,}\S+.*\n\s{4,}\S+/.test(raw)
  };
}

// ---------------------------------------------------------------------------
// Proof-command detection.
// A proof command must be a real verification runner — bare words like
// `echo 验证` or a creative render never count.
// ---------------------------------------------------------------------------

const PROOF_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|check|lint|typecheck|e2e|coverage)\b/i,
  /\bnode\s+--test\b/i,
  /\b(?:uv|poetry|pipenv)\s+run\s+(?:pytest|ruff|mypy|flake8|tox)\b/i,
  /\b(pytest|ruff|mypy|flake8|tox|coverage\s+run)\b/i,
  /\bcargo\s+(test|check|clippy|build)\b/i,
  /\bgo\s+(test|vet|build)\b/i,
  /\bswift\s+(test|build)\b/i,
  /\bxcodebuild\b[\s\S]*\b(test|build|archive|analyze)\b/i,
  /\b(vitest|jest|playwright|cypress|mocha|ava)\b/i,
  /\btsc\b(?!\S)/i,
  /\b(eslint|stylelint|prettier\s+--check|biome\s+(check|lint))\b/i,
  /\bmake\s+(test|check|lint|build)\b/i,
  /(?:^|\s)(?:\.\/)?mvnw?\s+(test|verify|check|package)\b/i,
  /(?:^|\s)(?:\.\/)?gradlew?\s+(test|check|build|lint)\b/i,
  /\bpython3?\s+-m\s+(pytest|unittest)\b/i,
  /\bdotnet\s+(test|build)\b/i,
  /\b(?:bundle\s+exec\s+)?rspec\b/i,
  /\b(?:bundle\s+exec\s+)?rake\s+(test|spec)\b/i,
  /\b(?:vendor\/bin\/)?phpunit\b/i,
  /\bcomposer\s+(test|check|lint|analyse|analyze)\b/i,
  /\bmix\s+(test|compile|format\s+--check-formatted)\b/i,
  /\bflutter\s+(test|analyze|build)\b/i,
  /\bdart\s+(test|analyze)\b/i,
  /\bdeno\s+(test|check|lint)\b/i,
  /\b(ctest|ninja\s+(test|check)|cmake\s+--build)\b/i
];

export function isProofCommand(command) {
  const text = String(command || "");
  return PROOF_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Tool categorization
// ---------------------------------------------------------------------------

export function categorizeTool(name, payload) {
  const normalized = String(name || "").toLowerCase();
  if (["exec_command", "write_stdin", "shell", "local_shell"].includes(normalized)) return "shell";
  if (normalized.includes("patch") || normalized === "apply_patch" || normalized === "write" || normalized === "edit") return "editing";
  if (normalized.includes("plan")) return "planning";
  if (normalized.includes("goal")) return "goals";
  if (normalized.includes("web") || normalized.includes("search") || normalized.includes("openai_doc") || normalized.includes("fetch")) return "research";
  if (normalized.includes("image") || normalized === "view_image") return "visual";
  if (normalized.includes("browser") || normalized.includes("screenshot")) return "browser";
  if (normalized.includes("mcp") || normalized === "js") return "mcp";
  if (normalized.includes("agent") || normalized.includes("collab")) return "multi-agent";
  if (payload?.namespace) return String(payload.namespace);
  return "other";
}

// ---------------------------------------------------------------------------
// Shell command reconstruction from the modern rollout format
// (function_call name=exec_command + function_call_output joined by call_id).
// ---------------------------------------------------------------------------

export function parseExecArguments(argsText) {
  try {
    const parsed = JSON.parse(String(argsText || ""));
    const cmd = parsed.cmd ?? parsed.command ?? "";
    const command = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
    return { command, workdir: parsed.workdir || parsed.cwd || null };
  } catch {
    return { command: "", workdir: null };
  }
}

const EXIT_CODE_PATTERNS = [
  /Process exited with code (-?\d+)/i,
  /exited with (?:status|code)[ :]+(-?\d+)/i,
  /exit code[ :]+(-?\d+)/i,
  /command failed with exit code (-?\d+)/i
];

// Returns { exitCode: number|null, recognized: boolean }.
// recognized=false means the output format carried no exit information at all.
export function extractExitCode(output) {
  if (output && typeof output === "object") {
    const structured = output.metadata?.exit_code ?? output.exit_code;
    if (typeof structured === "number") return { exitCode: structured, recognized: true };
    if (typeof output.output === "string") return extractExitCode(output.output);
    return { exitCode: null, recognized: false };
  }
  const text = String(output || "");
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        const structured = parsed.metadata?.exit_code ?? parsed.exit_code;
        if (typeof structured === "number") return { exitCode: structured, recognized: true };
        if (typeof parsed.output === "string") return extractExitCode(parsed.output);
      }
    } catch { /* fall through to regex */ }
  }
  for (const pattern of EXIT_CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { exitCode: Number(match[1]), recognized: true };
  }
  return { exitCode: null, recognized: false };
}

// ---------------------------------------------------------------------------
// Session kind from session_meta
// ---------------------------------------------------------------------------

export function sessionKindFromMeta(meta) {
  if (!meta) return "interactive";
  if (meta.thread_source === "subagent") return "subagent";
  const source = meta.source;
  if (source && typeof source === "object" && source.subagent) return "subagent";
  if (source === "exec") return "automation";
  return "interactive";
}

// ---------------------------------------------------------------------------
// apply_patch fallback: extract touched files from the patch text itself
// (used when patch_apply_end is not persisted).
// ---------------------------------------------------------------------------

export function filesFromPatchText(patchText) {
  const files = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  const text = String(patchText || "");
  while ((match = re.exec(text)) !== null) files.push(match[1].trim());
  return files;
}

// Detect Codex skill usage from shell commands that read a SKILL.md.
export function skillNameFromCommand(command) {
  const match = String(command || "").match(/(?:skills|\.system)\/([\w.-]+)\/SKILL\.md/i);
  return match ? match[1] : null;
}

// Normalize a shell command for retry-churn grouping: collapse whitespace,
// strip volatile bits like timestamps in file names.
export function normalizeCommand(command) {
  return String(command || "").replace(/\s+/g, " ").trim().slice(0, 200);
}
