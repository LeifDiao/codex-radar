#!/usr/bin/env node
// render-report.mjs — generate single-file HTML report and open it in browser
// Usage: node render-report.mjs <report-json-path> [--no-open]
// Output (stdout): absolute path to generated HTML file

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { RADAR_HOME } from './lib.mjs';

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
const templatePath = path.join(pluginRoot, 'viewer', 'template.html');

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

// Sanitize: escape </script> inside the JSON so it can't break out of the <script> tag
const safeJson = JSON.stringify(report).replace(/<\/script/gi, '<\\/script');

const html = template.replace('{{REPORT_DATA}}', safeJson);

// Output path — honor CODEX_RADAR_HOME (via lib's RADAR_HOME) like the parser does
const reportsDir = path.join(RADAR_HOME, 'reports');
const tempDir = path.join(RADAR_HOME, 'temp');
fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

function slugify(s) {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'report';
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

const slug = slugify(report.project);
const outName = `${slug}-${timestamp()}.html`;
const outPath = path.join(reportsDir, outName);

fs.writeFileSync(outPath, html, 'utf-8');

// Open in browser (cross-platform)
function openFile(filePath) {
  const p = process.platform;
  // Escape double-quotes in path
  const safe = filePath.replace(/"/g, '\\"');
  try {
    if (p === 'darwin') {
      execSync(`open "${safe}"`, { stdio: 'ignore' });
    } else if (p === 'win32') {
      execSync(`start "" "${safe}"`, { stdio: 'ignore', shell: true });
    } else {
      execSync(`xdg-open "${safe}"`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

let opened = false;
if (!noOpen) opened = openFile(outPath);

// Fallback: tell user to open manually if auto-open failed
if (!noOpen && !opened) {
  process.stderr.write(`[codex-radar] Couldn't auto-open browser. Open manually:\n  ${outPath}\n`);
}

process.stdout.write(outPath + '\n');
