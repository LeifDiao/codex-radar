#!/usr/bin/env node
// list-codex-projects.mjs — group local Codex sessions into projects.
// v2.1: incremental meta cache (fast on 10k+ session files), sessionKind
// breakdown per project, and child-directory folding so batch-automation
// subfolders don't drown the list.
import os from "node:os";
import path from "node:path";
import {
  allSessionFiles,
  CODEX_HOME,
  displayNameFromCwd,
  isSameOrChild,
  loadSessionMetasCached,
  loadThreadIndex,
  normalizePath,
  statSafe
} from "./lib.mjs";
import { sessionKindFromMeta } from "./signals.mjs";

function parseArgs(argv) {
  const args = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--cwd") {
      args.cwd = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const currentCwd = normalizePath(args.cwd);
const threadIndex = loadThreadIndex();
const files = await allSessionFiles();
const metaMap = await loadSessionMetasCached(files);
const grouped = new Map();

for (const [file, meta] of metaMap) {
  if (!meta?.cwd) continue;
  const cwd = normalizePath(meta.cwd);
  const stat = statSafe(file);
  const indexed = meta.id ? threadIndex.get(meta.id) : null;
  const updatedAt = indexed?.updated_at || stat?.mtime?.toISOString() || meta.timestamp;
  const kind = sessionKindFromMeta(meta);
  const entry = grouped.get(cwd) || {
    cwd,
    displayName: displayNameFromCwd(cwd),
    sessionCount: 0,
    sessionKinds: { interactive: 0, automation: 0, subagent: 0 },
    lastModified: updatedAt,
    threadNames: [],
    sampleSessionIds: []
  };
  entry.sessionCount += 1;
  entry.sessionKinds[kind] = (entry.sessionKinds[kind] || 0) + 1;
  if (meta.id && entry.sampleSessionIds.length < 3) entry.sampleSessionIds.push(meta.id);
  if (indexed?.thread_name && entry.threadNames.length < 5) {
    entry.threadNames.push(indexed.thread_name);
  }
  if (new Date(updatedAt) > new Date(entry.lastModified)) {
    entry.lastModified = updatedAt;
  }
  grouped.set(cwd, entry);
}

// --- fold child directories under their nearest ancestor project ---
const home = os.homedir();
const allCwds = new Set(grouped.keys());
function nearestAncestor(cwd) {
  let current = path.dirname(cwd);
  while (current && current !== home && current !== path.dirname(current)) {
    if (allCwds.has(current)) return current;
    current = path.dirname(current);
  }
  return null;
}

// Only fold noise: small, automation-dominant children (batch runs writing
// into subfolders). Real projects — interactive or sizable — stay top-level.
function isFoldable(project) {
  if (project.sessionCount > 30) return false;
  const nonInteractive = (project.sessionKinds.automation || 0) + (project.sessionKinds.subagent || 0);
  return nonInteractive / project.sessionCount >= 0.8;
}

const roots = new Map();
for (const project of grouped.values()) {
  const ancestor = isFoldable(project) ? nearestAncestor(project.cwd) : null;
  if (ancestor) {
    const rootProject = grouped.get(ancestor);
    rootProject.children = rootProject.children || [];
    rootProject.children.push(project);
  } else {
    roots.set(project.cwd, project);
  }
}
// A child may itself have children folded into it before being folded — flatten one level at a time.
function aggregate(project) {
  const summary = {
    cwd: project.cwd,
    displayName: project.displayName,
    sessionCount: project.sessionCount,
    sessionKinds: { ...project.sessionKinds },
    lastModified: project.lastModified,
    threadNames: project.threadNames,
    sampleSessionIds: project.sampleSessionIds,
    childProjectCount: 0,
    childSessionCount: 0
  };
  const stack = [...(project.children || [])];
  while (stack.length) {
    const child = stack.pop();
    summary.childProjectCount += 1;
    summary.childSessionCount += child.sessionCount;
    for (const [kind, count] of Object.entries(child.sessionKinds)) {
      summary.sessionKinds[kind] = (summary.sessionKinds[kind] || 0) + count;
    }
    if (new Date(child.lastModified) > new Date(summary.lastModified)) {
      summary.lastModified = child.lastModified;
    }
    stack.push(...(child.children || []));
  }
  return summary;
}

const projects = [...roots.values()]
  .map(aggregate)
  .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
  .map((project, index) => ({ index: index + 1, ...project }));

// --- cwd match runs over ALL project cwds (children included) ---
const flat = [...grouped.values()];
const matches = flat
  .map((project) => {
    if (project.cwd === currentCwd) return { project, rank: 0, matchType: "exact" };
    if (isSameOrChild(project.cwd, currentCwd)) {
      return { project, rank: 1 + path.relative(project.cwd, currentCwd).split(path.sep).length, matchType: "ancestor" };
    }
    if (isSameOrChild(currentCwd, project.cwd)) {
      return { project, rank: 50 + path.relative(currentCwd, project.cwd).split(path.sep).length, matchType: "child" };
    }
    return null;
  })
  .filter(Boolean)
  .sort((a, b) => a.rank - b.rank || new Date(b.project.lastModified) - new Date(a.project.lastModified));

const cwdMatch = matches[0]
  ? {
      cwd: matches[0].project.cwd,
      displayName: matches[0].project.displayName,
      sessionCount: matches[0].project.sessionCount,
      sessionKinds: matches[0].project.sessionKinds,
      lastModified: matches[0].project.lastModified,
      matchType: matches[0].matchType
    }
  : null;

console.log(JSON.stringify({
  codexHome: CODEX_HOME,
  sessionFileCount: files.length,
  count: projects.length,
  flatCount: flat.length,
  cwd: currentCwd,
  cwdMatch,
  projects
}, null, 2));
