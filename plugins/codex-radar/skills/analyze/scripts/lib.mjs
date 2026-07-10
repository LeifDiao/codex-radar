import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const RADAR_HOME = process.env.CODEX_RADAR_HOME || path.join(os.homedir(), ".codex-radar");
export const SESSION_ROOTS = [
  path.join(CODEX_HOME, "sessions"),
  path.join(CODEX_HOME, "archived_sessions")
];

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Some filesystems do not expose POSIX permissions.
  }
}

export function writeFilePrivate(filePath, data) {
  ensurePrivateDir(path.dirname(filePath));
  fs.writeFileSync(filePath, data, { encoding: "utf8", mode: 0o600 });
  makeFilePrivate(filePath);
}

export function makeFilePrivate(filePath) {
  try {
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch {
    // Some filesystems do not expose POSIX permissions.
    return false;
  }
}

export function appendFilePrivate(filePath, data) {
  ensurePrivateDir(path.dirname(filePath));
  fs.appendFileSync(filePath, data, { encoding: "utf8", mode: 0o600 });
  makeFilePrivate(filePath);
}

export function cleanupOldFiles(dir, {
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
  prefixes = []
} = {}) {
  const now = Date.now();
  let removed = 0;
  for (const name of safeReadDir(dir)) {
    if (prefixes.length && !prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const filePath = path.join(dir, name);
    const stat = statSafe(filePath);
    if (!stat?.isFile() || now - stat.mtimeMs <= maxAgeMs) continue;
    try {
      fs.unlinkSync(filePath);
      removed += 1;
    } catch {
      // Retention cleanup is best-effort.
    }
  }
  return removed;
}

export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export async function walkJsonl(root) {
  const out = [];
  if (!fileExists(root)) return out;
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkJsonl(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath);
    }
  }
  return out;
}

export async function allSessionFiles() {
  const groups = await Promise.all(SESSION_ROOTS.map((root) => walkJsonl(root)));
  return [...new Set(groups.flat())].sort();
}

export async function eachJsonLine(filePath, onRecord) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let index = 0;
  for await (const line of rl) {
    if (!line) continue;
    const record = parseJsonLine(line);
    if (record) await onRecord(record, index);
    index += 1;
  }
}

export function parseJsonLine(line) {
  if (line.length > 2_000_000) {
    const topType = line.match(/"type":"([^"]+)"/)?.[1] || "unknown";
    const payloadType = line.match(/"payload":\{"type":"([^"]+)"/)?.[1];
    const timestamp = line.match(/"timestamp":"([^"]+)"/)?.[1];
    const callId = line.match(/"call_id":"([^"]+)"/)?.[1] || line.match(/"id":"([^"]+)"/)?.[1];
    const name = line.match(/"name":"([^"]+)"/)?.[1];
    return {
      timestamp,
      type: topType,
      payload: {
        type: payloadType,
        call_id: callId,
        name,
        oversized: true
      }
    };
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export async function readSessionMeta(filePath) {
  let meta = null;
  await eachJsonLine(filePath, (record) => {
    if (record.type === "session_meta") {
      meta = record.payload || {};
      throw new StopReading();
    }
  }).catch((error) => {
    if (!(error instanceof StopReading)) throw error;
  });
  return meta;
}

class StopReading extends Error {}

// ---------------------------------------------------------------------------
// Incremental session_meta cache. Reading the first line of 10k+ JSONL files
// on every run is the dominant cost of listing projects — cache the slim meta
// keyed by (mtimeMs, size) and only re-read files that changed.
// ---------------------------------------------------------------------------

const META_CACHE_PATH = () => path.join(RADAR_HOME, "cache", "session-meta.json");

function slimMeta(meta) {
  if (!meta) return null;
  return {
    id: meta.id || meta.session_id || null,
    cwd: meta.cwd || null,
    timestamp: meta.timestamp || null,
    source: typeof meta.source === "string" ? meta.source : (meta.source ? { subagent: true } : null),
    thread_source: meta.thread_source || null,
    originator: meta.originator || null,
    model_provider: meta.model_provider || null
  };
}

export async function loadSessionMetasCached(files) {
  let cache = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(META_CACHE_PATH(), "utf8"));
    if (parsed?.schemaVersion === "meta-cache-1") cache = parsed.entries || {};
  } catch { /* cold cache */ }

  const result = new Map();
  const nextCache = {};
  let dirty = false;
  for (const file of files) {
    const stat = statSafe(file);
    if (!stat) continue;
    const cached = cache[file];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      nextCache[file] = cached;
      if (cached.meta) result.set(file, cached.meta);
      continue;
    }
    const meta = slimMeta(await readSessionMeta(file));
    nextCache[file] = { mtimeMs: stat.mtimeMs, size: stat.size, meta };
    if (meta) result.set(file, meta);
    dirty = true;
  }
  if (dirty || Object.keys(cache).length !== Object.keys(nextCache).length) {
    try {
      writeFilePrivate(
        META_CACHE_PATH(),
        JSON.stringify({ schemaVersion: "meta-cache-1", entries: nextCache })
      );
    } catch { /* cache write failure is non-fatal */ }
  }
  return result;
}

export function loadThreadIndex() {
  const indexPath = path.join(CODEX_HOME, "session_index.jsonl");
  const index = new Map();
  if (!fileExists(indexPath)) return index;
  const lines = fs.readFileSync(indexPath, "utf8").split(/\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.id) index.set(record.id, record);
    } catch {
      // Ignore corrupt index lines.
    }
  }
  return index;
}

export function normalizePath(inputPath) {
  if (!inputPath) return "";
  return path.resolve(inputPath.replace(/^~(?=$|\/)/, os.homedir()));
}

export function isSameOrChild(parent, child) {
  const resolvedParent = normalizePath(parent);
  const resolvedChild = normalizePath(child);
  if (!resolvedParent || !resolvedChild) return false;
  if (resolvedParent === resolvedChild) return true;
  const rel = path.relative(resolvedParent, resolvedChild);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function displayNameFromCwd(cwd) {
  if (!cwd) return "Unknown";
  const name = path.basename(cwd);
  return name || cwd;
}

export function clip(text, max = 160) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function redactSensitiveText(value) {
  let text = String(value || "");
  text = text.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
    "[REDACTED PRIVATE KEY]"
  );
  text = text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED OPENAI KEY]");
  text = text.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[REDACTED GITHUB TOKEN]");
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED GITHUB TOKEN]");
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS ACCESS KEY]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [REDACTED]");
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]");
  text = text.replace(
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*["']?)([^"'\s,;]+)/gi,
    "$1[REDACTED]"
  );
  return text;
}

export function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string") parts.push(item.text);
    else if (typeof item.output_text === "string") parts.push(item.output_text);
  }
  return parts.join("\n");
}

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

export function round(value) {
  return Math.round(clamp(Number.isFinite(value) ? value : 0));
}

export function gradeFor(score, thresholds) {
  if (score === null || score === undefined) return null;
  for (const grade of ["S", "A", "B", "C", "D"]) {
    if (score >= thresholds[grade]) return grade;
  }
  return "D";
}

export function loadRubric(skillDir) {
  const rubricPath = path.resolve(skillDir, "../../data/rubric.json");
  return JSON.parse(fs.readFileSync(rubricPath, "utf8"));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function slugify(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "project";
}

export function countBy(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function topCounts(counts, limit = 12) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
