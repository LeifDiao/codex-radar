#!/usr/bin/env node
// render-report.mjs — validate report JSON, inject history/delta, generate the
// single-file HTML report, and open it in the browser.
// Usage: node render-report.mjs <report-json-path> [--no-open]
// Output (stdout): absolute path to generated HTML file

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  appendFilePrivate,
  ensurePrivateDir,
  loadRubric,
  RADAR_HOME,
  writeFilePrivate
} from './lib.mjs';
import { validateFinalReport } from './report-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const reportJsonPath = args.find(a => !a.startsWith('--'));

if (!reportJsonPath) {
  console.error('Usage: render-report.mjs <report-json-path> [--no-open]');
  process.exit(1);
}
if (!fs.existsSync(reportJsonPath)) {
  console.error(`Report JSON not found: ${reportJsonPath}`);
  process.exit(1);
}

// Resolve template path
// This script lives at: <plugin-root>/skills/analyze/scripts/render-report.mjs
// Template lives at:    <plugin-root>/viewer/template.html
const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const skillDir = path.resolve(__dirname, '..');
const templatePath = path.join(pluginRoot, 'viewer', 'template.html');
const rubric = loadRubric(skillDir);

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

const template = fs.readFileSync(templatePath, 'utf-8');

let report;
try {
  const raw = fs.readFileSync(reportJsonPath, 'utf-8');
  report = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid report JSON: ${e.message}`);
  process.exit(1);
}

const { errors, warnings } = validateFinalReport(report, rubric);

if (errors.length) {
  console.error('Report JSON failed validation:');
  for (const message of errors) console.error(`  ✗ ${message}`);
  console.error(`\nFix these fields in ${reportJsonPath} and re-run.`);
  process.exit(1);
}
report.schemaWarnings = [...new Set(warnings)];

// ---------------------------------------------------------------------------
// History: previous runs of the same project → trend + delta
// ---------------------------------------------------------------------------

const historyPath = path.join(RADAR_HOME, 'history.jsonl');

function loadHistory() {
  try {
    return fs.readFileSync(historyPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(entry => {
        if (!entry) return false;
        if (report.projectCwd && entry.projectCwd) return entry.projectCwd === report.projectCwd;
        return entry.project === report.project;
      });
  } catch {
    return [];
  }
}

const previousRuns = loadHistory();
report.history = previousRuns.slice(-8).map(entry => ({
  generatedAt: entry.generatedAt,
  overallScore: entry.overallScore,
  overallGrade: entry.overallGrade,
  categoryScores: entry.categoryScores,
  dimensions: entry.dimensions
}));

const lastRun = previousRuns[previousRuns.length - 1];
if (lastRun) {
  const dimensionDeltas = {};
  for (const dim of report.dimensions) {
    const previous = lastRun.dimensions?.[dim.id];
    if (typeof previous === 'number' && typeof dim.score === 'number') {
      dimensionDeltas[dim.id] = dim.score - previous;
    }
  }
  report.delta = {
    since: lastRun.generatedAt,
    overall: typeof lastRun.overallScore === 'number' ? report.overallScore - lastRun.overallScore : null,
    categories: Object.fromEntries(
      Object.entries(report.categoryScores || {}).map(([key, value]) => [
        key,
        typeof lastRun.categoryScores?.[key] === 'number' && typeof value === 'number'
          ? value - lastRun.categoryScores[key]
          : null
      ])
    ),
    dimensions: dimensionDeltas
  };
} else {
  report.delta = null;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

// Sanitize: escape </script> inside the JSON so it can't break out of the <script> tag
const safeJson = JSON.stringify(report).replace(/<\/script/gi, '<\\/script');

const html = template.replace('{{REPORT_DATA}}', safeJson);

const reportsDir = path.join(RADAR_HOME, 'reports');
const tempDir = path.join(RADAR_HOME, 'temp');
ensurePrivateDir(reportsDir);
ensurePrivateDir(tempDir);

function slugify(s) {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'report';
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const padMs = n => String(n).padStart(3, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) + '-' +
    padMs(d.getMilliseconds())
  );
}

const slug = slugify(report.project);
const outBase = `${slug}-${timestamp()}`;
let outName = `${outBase}.html`;
let outPath = path.join(reportsDir, outName);
let collision = 1;
while (fs.existsSync(outPath)) {
  outName = `${outBase}-${collision}.html`;
  outPath = path.join(reportsDir, outName);
  collision += 1;
}

writeFilePrivate(outPath, html);

// Append this run to history AFTER a successful write.
try {
  const historyEntry = {
    generatedAt: report.generatedAt || new Date().toISOString(),
    project: report.project,
    projectCwd: report.projectCwd || null,
    profileType: report.profile?.type || null,
    overallScore: report.overallScore,
    overallGrade: report.overallGrade,
    categoryScores: report.categoryScores,
    dimensions: Object.fromEntries(
      report.dimensions.map(dim => [dim.id, typeof dim.score === 'number' ? dim.score : null])
    ),
    reportFile: outName
  };
  appendFilePrivate(historyPath, JSON.stringify(historyEntry) + '\n');
} catch (e) {
  process.stderr.write(`[codex-radar] Could not append to history: ${e.message}\n`);
}

// Open in browser (cross-platform)
function openFile(filePath) {
  const p = process.platform;
  try {
    if (p === 'darwin') {
      execFileSync('open', [filePath], { stdio: 'ignore' });
    } else if (p === 'win32') {
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '', filePath], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [filePath], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

let opened = false;
if (!noOpen) opened = openFile(outPath);

if (!noOpen && !opened) {
  process.stderr.write(`[codex-radar] Couldn't auto-open browser. Open manually:\n  ${outPath}\n`);
}
if (warnings.length) {
  process.stderr.write(`[codex-radar] ${warnings.length} schema warning(s) — shown in the report banner.\n`);
}

process.stdout.write(outPath + '\n');
