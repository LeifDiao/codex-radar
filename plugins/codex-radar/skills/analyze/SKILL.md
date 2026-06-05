---
name: codex-radar
description: Analyze the user's local Codex collaboration history and produce a single-file HTML dashboard. Use when the user asks to "run Codex Radar", analyze their Codex collaboration, score how they work with Codex, or create a Codex Radar report. Reads local ~/.codex/sessions, scores 9 dimensions across 3 categories (Communication / Engineering / Outcome) using a deterministic baseline formula plus a bounded evidence-based adjustment, then writes a free-form diagnosis and paste-ready prompt rewrites. 100% local.
---

# Codex Radar — Codex collaboration analyzer

You are the **Codex Radar** scoring + diagnosis engine. Codex Radar reads local **Codex** session JSONL (not Claude Code logs), scores 9 dimensions across 3 categories, and writes a qualitative diagnosis — that diagnosis is the most valuable output for the user.

A deterministic script extracts the **facts**. **You** read those facts plus `data/rubric.json` and author the scores, the diagnosis, and the suggestions. Then a render script turns your report JSON into an HTML dashboard.

> **Paths.** Every command below is run from **this skill's directory** (the folder containing this `SKILL.md`). Script paths are relative to it — e.g. `node scripts/list-codex-projects.mjs`. The rubric is at `data/rubric.json` relative to the skill root.

> **Privacy.** Do not print raw session contents in chat. The report is local HTML and may include short user-message snippets as evidence.

---

## Step 1 — Detect cwd & list projects

```bash
node scripts/list-codex-projects.mjs --cwd "$PWD"
```

The JSON output has `projects[]` (sorted by recency) and `cwdMatch` (the project for the current working directory, or `null`).

- If `cwdMatch` is non-null, briefly confirm: *"Analyze this project: <displayName> (<sessionCount> sessions)? [Y/n]"*. If the user already asked to analyze the current project, proceed with `cwdMatch.cwd`.
- If the user types a number, use `projects[number-1].cwd`.
- If `cwdMatch` is null or the user declines, show the top 10 projects by recency and ask for a number.

## Step 2 — Parse the chosen project into facts

```bash
node scripts/parse-codex-project.mjs "<project-cwd>"
```

This writes a **facts JSON** to `~/.codex-radar/temp/` and prints `factsPath`. Read that file. Key blocks:

- **`projectProfile`** — `{type, label, rationale, naDimensions, categoryWeights}` — drives weighting and N/A.
- **`projectAssets`** — `{cwdResolved, hasAgentsMd, hasCodexDir, hasAgentsDir, hasGit, hasManifest, hasReadme, hasTestsDir, rootEntryCount}` — fuel for Architecture.
- **`toolcraftSummary`** — `{totalToolCalls, byCategory, topTools, commandSuccessRate, planUpdates, subagentCalls, mcpCalls, webSearchCalls, imageCalls, browserCalls}` — fuel for Toolcraft.
- **`outcomeTotals`** — `{fileEditCount, distinctFilesTouched, proofCommands, cleanEndRatio, editsPerHumanMsg, toolsPerHumanMsg, filesPerHumanMsg, abortRatio}` — fuel for Efficiency / Proof Check / Completion / Tempo.
- **`signalsByPosition`** — `opening / directing / correcting / confirming / continuing`, each with `.ratios.{explicitGoal, expectedBehavior, constraints, filePath, errorLog, asksVerify, correction, confirmation, codeOrData}`.
- **`stats`** — global counts (`humanMessages`, `averageHumanMessageLength`, `turnCompletes`, `turnAborts`, `contextCompactions`, `errors`, `agentMessages`, ...).
- **`keyMessages`, `sampleExchanges`, `sessionFlows`** — evidence for adjustments and diagnosis.
- **`confidenceLevel`** (low/medium/high), **`signalDensity`**, **`outcomeDensity`** — justify confidence scaling.
- **`dominantLanguage`** — `'zh'` or `'en'`; this MUST become `report.language`.

Tell the user: `"Analyzing <N> sessions (<profileLabel>)..."`.

## Step 3 — Read the rubric

Read `data/rubric.json` (relative to the skill root). It is the scoring constitution: 9 dimension definitions, baseline formulas, applicability rules, grade thresholds, profile weights, confidence scaling, and the diagnosis / suggestion specs.

---

## Step 4 — Score each of the 9 dimensions

For each dimension in `dimensionOrder`:

**4a. Applicability.** A dimension is **N/A** if `projectProfile.naDimensions` includes its id, OR its `applicabilityRule` fires (e.g. `architecture` is N/A when `projectAssets.cwdResolved === false`). For N/A: `score: null, grade: null, applicable: false`, and write a one-line `reasoning` explaining why.

**4b. Baseline.** Plug the facts values into the dimension's `baselineFormula`, clamp to [0, 100]. The communication dimensions read their `primaryPosition` bucket (`directing` / `opening` / `correcting` / `confirming`); engineering/outcome read `toolcraftSummary` / `projectAssets` / `outcomeTotals` / `stats`. If a primary position bucket has `messageCount: 0`, note it in `reasoning`.

**4c. Confidence scaling.** Apply per `scoring.confidenceScaling` using `confidenceLevel`: low → `50 + (baseline-50)*0.75`; medium → `50 + (baseline-50)*0.9`; high → unchanged.

**4d. Evidence adjustment (±15 max).** Read `keyMessages`, `sampleExchanges`, `sessionFlows`, `toolcraftSummary`. Adjust within ±15 using the dimension's `adjustmentGuide`. **Cite specific evidence** in `reasoning`. No evidence → adjustment 0. `finalScore = clamp(adjusted + adjustment, 0, 100)`.

**4e. Per-dimension output:**

```jsonc
{
  "id": "lock_on",
  "category": "communication",
  "name": {"en": "Lock-On", "zh": "瞄准力"},
  "description": {"en": "...", "zh": "..."},   // from rubric
  "applicable": true,
  "score": 76,
  "grade": "A",
  "reasoning": {"en": "Plain-language description of the user's real behavior. Do NOT expose formula internals.", "zh": "用人话描述用户的真实行为模式，不要暴露公式内部指标。"},
  "evidence": ["Pasted a full error message with file path in one message", "..."]
}
```

Grades from `rubric.grades`: S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, D ≥ 0.

## Step 5 — Category and overall scores

- **Category score** = average of the **applicable** dimensions in that category, rounded.
- **Overall score** = weighted sum of category scores using `projectProfile.categoryWeights`, renormalized over categories that have a score, rounded.
- **Overall grade** = look up the overall score in `rubric.grades`.

## Step 6 — Diagnosis layer (the core value)

Per `rubric.diagnosis`, produce three bilingual pieces, each grounded in real facts:

- **`collaborationProfile`** (120-180 words) — how this user works with Codex. Observable behavior, not personality.
- **`coreDiagnosis`** (60-100 words) — the single strongest strength and the single most critical bottleneck, with evidence + the bottleneck's concrete cost.
- **`crossDimensionReading`** (1-2 sentences) — how the scores combine (e.g. "high Lock-On + low Proof Check = you trust Codex's execution but not its judgment").

Also write **`insight`** per `rubric.insight`: ONE vivid 60-110 char bilingual hero line (a coach's wake-up call, often a tension). No raw scores, no category badges, no generic praise.

## Step 7 — Suggestions (MINIMUM 5, up to 7)

Per `rubric.suggestions`. Each has `dimensionId, priority, title{en,zh}, body{en,zh}, evidence{en,zh}, promptRewrite{en,zh}, expectedImpact{en,zh}`. Every `promptRewrite` is a concrete pastable string. Sort high → medium → low. Even for high-scoring users, generate 5 (level-up moves from the rubric's `highScorerFillSources`).

---

## Step 8 — Assemble report JSON 2.0 and write it

Create the temp dir, then write the report with your file-writing tool:

```bash
mkdir -p ~/.codex-radar/temp
```

Write to `~/.codex-radar/temp/codex-report.json`:

```jsonc
{
  "schemaVersion": "2.0",
  "project": "<facts.project.displayName>",
  "generatedAt": "<ISO timestamp>",
  "language": "<facts.dominantLanguage — 'zh' or 'en', exactly>",

  "insight": {"en": "...", "zh": "..."},

  "profile": {
    "type": "<facts.projectProfile.type>",
    "label": {"en": "...", "zh": "..."},          // from facts.projectProfile.label
    "rationale": {"en": "...", "zh": "..."},        // explain the classification
    "sessionCount": 23,
    "dateRange": ["<facts.project.firstActiveAt>", "<facts.project.lastActiveAt>"],
    "humanMessages": 187,
    "confidence": "<facts.confidenceLevel>"
  },

  "overallScore": 72,
  "overallGrade": "B",
  "categoryScores": { "communication": 78, "engineering": 65, "outcome": 74 },

  "dimensions": [ /* 9 dimensions in dimensionOrder, each per Step 4e */ ],

  "toolcraftDetails": {
    // pass through from facts.toolcraftSummary
    "totalToolCalls": 0,
    "byCategory": [{"name": "shell", "count": 0}],
    "topTools": [{"name": "exec_command", "count": 0}],
    "subagentCalls": 0,
    "planUpdates": 0,
    "mcpCalls": 0,
    "webSearchCalls": 0,
    "imageCalls": 0,
    "browserCalls": 0,
    "commandSuccessRate": 0.0
  },

  "projectAssets": {
    // pass through from facts.projectAssets
    "cwdResolved": true,
    "hasAgentsMd": false,
    "hasCodexDir": false,
    "hasAgentsDir": false,
    "hasGit": true,
    "hasManifest": true,
    "hasReadme": true,
    "hasTestsDir": false,
    "rootEntryCount": 0
  },

  "diagnosis": {
    "collaborationProfile": {"en": "...", "zh": "..."},
    "coreDiagnosis": {"en": "...", "zh": "..."},
    "crossDimensionReading": {"en": "...", "zh": "..."}
  },

  "suggestions": [ /* 5-7 items per Step 7 */ ]
}
```

`name`, `description`, `reasoning`, `insight`, `profile.label/rationale`, `diagnosis.*`, and every suggestion field are bilingual `{en, zh}`. Bilingual parity — same meaning, not a literal translation.

## Step 9 — Render and open

```bash
node scripts/render-report.mjs ~/.codex-radar/temp/codex-report.json
```

This writes the single-file HTML to `~/.codex-radar/reports/`, prints the path, and tries to open it in the browser.

## Step 10 — Brief terminal summary

```text
✓ Codex Radar report ready
  Project: <project> (<profileLabel>)
  Overall: <overallGrade> · <overallScore>/100
  Communication: <c1> · Engineering: <c2> · Outcome: <c3>
  Confidence: <confidenceLevel>
  File: ~/.codex-radar/reports/<filename>.html

<one-line takeaway from diagnosis.coreDiagnosis>
```

Do **not** dump the full dimension breakdown, diagnosis, or suggestions in chat — that is what the HTML report is for.

---

## Principles

1. **Formula is the anchor, adjustment is the tuning.** Baseline ensures reproducibility; the bounded ±15 adjustment adds sensitivity. No evidence → no adjustment.
2. **N/A is honest.** When a dimension genuinely doesn't apply (e.g. unresolved cwd → Architecture), say so. Don't fake a 50.
3. **Diagnosis is the gift.** Scores say *what*; diagnosis says *why* and *what to do*. Spend the most thought here.
4. **Evidence beats opinion.** Every claim in reasoning / evidence / diagnosis traces to specific facts.
5. **Language follows the data.** `report.language` = `facts.dominantLanguage`. Don't override it.

## Error recovery

- **Parser fails / invalid JSON:** tell the user the JSONL may be corrupted; try another project. Don't continue.
- **Too little data** (`confidenceLevel: "low"` AND `stats.humanMessages < 5`): tell the user there's too little to evaluate; pick another project. Don't produce a report.
- **Low but workable** (`humanMessages >= 5`): produce the report, set `profile.confidence: "low"`, and have the diagnosis mention the small sample.
- **Render fails:** show the user the report JSON path so they can open it manually.
- **`mkdir`/write errors:** run `mkdir -p ~/.codex-radar/temp` then retry.
