#!/usr/bin/env node
import path from "node:path";
import {
  allSessionFiles,
  CODEX_HOME,
  displayNameFromCwd,
  isSameOrChild,
  loadThreadIndex,
  normalizePath,
  readSessionMeta,
  statSafe
} from "./lib.mjs";

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
const grouped = new Map();

for (const file of files) {
  const meta = await readSessionMeta(file);
  if (!meta?.cwd) continue;
  const cwd = normalizePath(meta.cwd);
  const stat = statSafe(file);
  const indexed = meta.id ? threadIndex.get(meta.id) : null;
  const updatedAt = indexed?.updated_at || stat?.mtime?.toISOString() || meta.timestamp;
  const entry = grouped.get(cwd) || {
    cwd,
    displayName: displayNameFromCwd(cwd),
    sessionCount: 0,
    lastModified: updatedAt,
    threadNames: [],
    sessions: []
  };
  entry.sessionCount += 1;
  entry.sessions.push({
    id: meta.id,
    file,
    timestamp: meta.timestamp,
    updatedAt,
    threadName: indexed?.thread_name || null,
    source: meta.source || meta.originator || null,
    modelProvider: meta.model_provider || null
  });
  if (indexed?.thread_name && entry.threadNames.length < 5) {
    entry.threadNames.push(indexed.thread_name);
  }
  if (new Date(updatedAt) > new Date(entry.lastModified)) {
    entry.lastModified = updatedAt;
  }
  grouped.set(cwd, entry);
}

const projects = [...grouped.values()]
  .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
  .map((project, index) => ({
    index: index + 1,
    cwd: project.cwd,
    displayName: project.displayName,
    sessionCount: project.sessionCount,
    lastModified: project.lastModified,
    threadNames: project.threadNames,
    sampleSessionIds: project.sessions.slice(-3).map((session) => session.id).filter(Boolean)
  }));

const matches = projects
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
  ? { ...matches[0].project, matchType: matches[0].matchType }
  : null;

console.log(JSON.stringify({
  codexHome: CODEX_HOME,
  sessionFileCount: files.length,
  count: projects.length,
  cwd: currentCwd,
  cwdMatch,
  projects
}, null, 2));
