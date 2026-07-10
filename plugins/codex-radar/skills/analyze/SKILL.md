---
name: codex-radar
description: Analyze the user's local Codex collaboration history and produce a single-file HTML dashboard. Use when the user asks to "run Codex Radar", analyze their Codex collaboration, score how they work with Codex, or create a Codex Radar report. Reads local ~/.codex/sessions, scores 9 dimensions across 3 categories (Communication / Engineering / Outcome) — the parser computes deterministic formula baselines, the model applies a bounded evidence-cited adjustment — then writes a free-form diagnosis and typed, paste-ready suggestions. 100% local.
---

# Codex Radar — Codex collaboration analyzer

You are the **Codex Radar** scoring + diagnosis engine. Codex Radar reads local **Codex** session JSONL (not Claude Code logs), scores 9 dimensions across 3 categories, and writes a qualitative diagnosis — that diagnosis and the suggestions are the most valuable output for the user.

A deterministic script extracts the **facts** and computes the **formula baselines**. **You** read those facts plus `data/rubric.json` and author the bounded adjustments, the diagnosis, the observations, and the suggestions. Then a render script turns your report JSON into an HTML dashboard.

> **Paths.** Every command below is run from **this skill's directory** (the folder containing this `SKILL.md`). Script paths are relative to it — e.g. `node scripts/list-codex-projects.mjs`. The rubric is at `data/rubric.json` relative to the skill root.

> **Privacy.** Do not print raw session contents in chat. The report is local HTML and may include short user-message snippets as evidence.

---

## Step 1 — Detect cwd & list projects

```bash
node scripts/list-codex-projects.mjs --cwd "$PWD"
```

The JSON output has `projects[]` (sorted by recency) and `cwdMatch` (the project for the current working directory, or `null`). Each project shows `sessionKinds` (interactive / automation / subagent counts) so noisy automation groups are visible.

- If `cwdMatch` is non-null, briefly confirm: *"Analyze this project: <displayName> (<sessionCount> sessions)? [Y/n]"*. If the user already asked to analyze the current project, proceed with `cwdMatch.cwd`.
- If the user types a number, use `projects[number-1].cwd`.
- If `cwdMatch` is null or the user declines, show the top 10 projects by recency and ask for a number.

## Step 2 — Refresh the self-baseline (fast when cached)

```bash
node scripts/compute-baseline.mjs --if-stale
```

This maintains `~/.codex-radar/cache/self-baseline.json` — the distribution of the user's own per-session metrics across all their projects. It exits immediately when the cache is fresh (< 7 days). Never blocks the analysis: if it fails, continue without it.

## Step 3 — Parse the chosen project into facts

```bash
node scripts/parse-codex-project.mjs "<project-cwd>"
```

This writes a **facts JSON** to `~/.codex-radar/temp/` and prints `factsPath` plus `parserWarnings`. Read that file. Key blocks:

- **`projectProfile`** — `{type, label, rationale, automationShare, naDimensions, categoryWeights}` — drives weighting and N/A. `automation` type means the sessions are mostly non-interactive `codex exec` runs.
- **`computedBaselines`** — per dimension `{applicable, baseline, confidenceScaled, naReason?}`. **This is your scoring starting point — never recompute formulas by hand.**
- **`projectAssets`** — filesystem context for Architecture.
- **`toolcraftSummary`** — tool counts, `commandSuccessRate` (may be `null` = unmeasurable), plan/subagent/MCP/web counters.
- **`modernToolSummary`** — the deep platform read: `mcpByServer` (per-server calls/errors/tools), `subagentLifecycle` (spawned/waited/closed/orphanedEstimate), `plans` (updates + completion ratio), `goals`, `toolSearch`, `skillReads`, `web.topQueries`, `images`, `nodeRepl`, `contextHygiene`.
- **`outcomeTotals`** — edits, files, `proofCommands{total,passed,failed,unknown}`, `cleanEndRatio`, `abortRatio` (includes silently dropped turns).
- **`signalsByPosition`** — `opening` (first 2 messages of EACH session) / `directing` / `correcting` (with `substanceRatio`) / `confirming` / `continuing`.
- **`evidenceAtoms`** — id-addressable evidence: key user messages (with what happened `after` each), notable shell failures. **Cite these ids.**
- **`workflowEpisodes`** — per-session narrative material: duration, first user message, last agent message, edits/proof/failures/aborts/plan completion.
- **`criticalIncidents`** — command retry churn, corrections, aborted turns, context pressure — the places where the collaboration actually struggled.
- **`subagentActivity`** — subagent threads excluded from the stats (they are agent-authored), summarized as orchestration evidence.
- **`selfBaseline`** — the user's own typical-session distribution (null if not computed yet).
- **`parserCoverage` / `parserWarnings`** — format-drift detector. Pass warnings through to the report.
- **`stats`**, **`confidenceLevel`**, **`dominantLanguage`** — `dominantLanguage` MUST become `report.language`.

Tell the user: `"Analyzing <N> sessions (<profileLabel>)..."` — and if `automationShare > 0.3`, mention what share of the project is automation runs.

## Step 4 — Read the rubric

Read `data/rubric.json`. It is the scoring constitution: dimension definitions, adjustment guides, **suggestionRecipes**, grade thresholds, profile weights, and the diagnosis / observation / suggestion specs.

---

## Step 5 — Score each of the 9 dimensions

For each dimension in `dimensionOrder`:

**5a. Applicability.** `computedBaselines.<id>.applicable === false` → N/A: `score: null, grade: null, applicable: false`, one-line `reasoning` from `naReason`.

**5b. Starting score.** `computedBaselines.<id>.confidenceScaled`. Do not recompute.

**5c. Evidence adjustment (bounded by confidence).** Max ± depends on `facts.confidenceLevel` per `rubric.scoring.adjustmentRange`: low ±5, medium ±10, high ±15. Adjust using the dimension's `adjustmentGuide`, reading `evidenceAtoms`, `workflowEpisodes`, `criticalIncidents`, `modernToolSummary`. **Cite atom/incident ids in `reasoning`.** No evidence → adjustment 0. `finalScore = clamp(start + adjustment, 0, 100)`.

**5d. Per-dimension output:**

```jsonc
{
  "id": "lock_on",
  "category": "communication",
  "name": {"en": "Lock-On", "zh": "瞄准力"},
  "description": {"en": "...", "zh": "..."},   // from rubric
  "applicable": true,
  "score": 76,
  "grade": "A",
  "baseline": 72,                               // computedBaselines.<id>.confidenceScaled
  "adjustment": 4,
  "reasoning": {"en": "Plain-language description of the user's real behavior. No formula internals.", "zh": "用人话描述用户的真实行为模式，不要暴露公式内部指标。"},
  "evidence": ["a3: pasted the full error with file path in one message", "..."]
}
```

Grades from `rubric.grades`: S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, D ≥ 0.

## Step 6 — Category and overall scores

- **Category score** = average of the **applicable** dimensions in that category, rounded.
- **Overall score** = weighted sum of category scores using `projectProfile.categoryWeights`, renormalized over categories that have a score, rounded.
- **Overall grade** = look up the overall score in `rubric.grades`.

## Step 7 — Diagnosis layer (the core value)

Per `rubric.diagnosis`, produce three bilingual pieces, each grounded in cited evidence:

- **`collaborationProfile`** (120-180 words) — how this user works with Codex. Observable behavior, not personality. Draw on `workflowEpisodes` and `modernToolSummary`, not just message style.
- **`coreDiagnosis`** (60-100 words) — the single strongest strength and the single most critical bottleneck, with evidence + the bottleneck's concrete cost.
- **`crossDimensionReading`** (1-2 sentences) — how the scores combine.
- If `selfBaseline` exists, anchor at least one claim against the user's own typical session.

Also write **`insight`** per `rubric.insight`: ONE vivid 60-110 char bilingual hero line. No raw scores, no category badges, no generic praise.

Also write **`highlights`** — the two headline cards the dashboard shows right under the core diagnosis:

- `highlights.strength` — `{dimensionId, headline: {en, zh}}` for the single strongest signal. The headline is ONE punchy evidence-bearing sentence (numbers welcome), not a restatement of the dimension name.
- `highlights.bottleneck` — same shape, for the single most costly bottleneck.

Pick the dimension that best carries the diagnosis, not mechanically the highest/lowest score (the renderer falls back to max/min score if you omit this block — your value-add is choosing better and writing a sharper headline).

## Step 8 — Observations, then suggestions (two passes)

**8a. Observations (8-12).** Per `rubric.observations`: single-sentence, bilingual, each with `evidenceRefs` (atom/incident ids) and a `dimensionId`. These force you to look at the evidence before prescribing. Include them in the report.

**8b. Suggestions (MINIMUM 5, up to 7).** Per `rubric.suggestions`:

1. **Recipes first** — walk every dimension's `suggestionRecipes`; for each trigger that fires against the facts, instantiate the recipe with this user's real files, commands, tools, and quoted fragments.
2. Fill remaining slots from the strongest unaddressed observations (`highScorerFillSources` for strong users).
3. Each suggestion: `type` (prompt_rewrite / workflow_habit / setup_action / tool_adoption / verification_loop), `dimensionId`, `priority`, bilingual `title` (<18 chars) / `summary` (ONE sentence — shown on the collapsed row in the dashboard) / `body` (2-4 sentences: behavior → cost → change) / `evidence`, `evidenceRefs` (≥2 ids when available), the type's payload (`promptRewrite` / `steps[]` / `snippet`), `verifyBy` (which facts metric should move next run), `expectedImpact`.
4. **Anti-generic rule**: if a suggestion still makes sense after deleting every project-specific noun, rewrite it. When facts support it, at least 2 suggestions must be non-prompt_rewrite types.
5. Sort high → medium → low. The dashboard spotlights the FIRST suggestion as "do this first" and collapses the rest — make sure suggestion #1 is the one intervention you'd bet on.

**8c. AGENTS.md draft (conditional).** If `projectAssets.cwdResolved && !projectAssets.hasAgentsMd && stats.sessions >= 3`, also write **`agentsMdDraft`** — a complete, project-specific AGENTS.md generated from the session history: observed commands, conventions, recurring pitfalls (from criticalIncidents), verification expectations. Concrete over generic; 30-60 lines; in `report.language` with English section headers.

---

## Step 9 — Assemble report JSON 2.2 and write it

```bash
mkdir -p ~/.codex-radar/temp
```

Write to `~/.codex-radar/temp/codex-report.json`:

```jsonc
{
  "schemaVersion": "2.2",
  "project": "<facts.project.displayName>",
  "projectCwd": "<facts.project.cwd>",
  "generatedAt": "<ISO timestamp>",
  "language": "<facts.dominantLanguage — 'zh' or 'en', exactly>",

  "insight": {"en": "...", "zh": "..."},

  "profile": {
    "type": "<facts.projectProfile.type>",
    "label": {"en": "...", "zh": "..."},
    "rationale": {"en": "...", "zh": "..."},
    "automationShare": 0.0,
    "sessionCount": 23,
    "subagentSessionsExcluded": 0,
    "dateRange": ["<firstActiveAt>", "<lastActiveAt>"],
    "humanMessages": 187,
    "confidence": "<facts.confidenceLevel>"
  },

  "overallScore": 72,
  "overallGrade": "B",
  "categoryScores": { "communication": 78, "engineering": 65, "outcome": 74 },

  "dimensions": [ /* 9 dimensions in dimensionOrder, each per Step 5d */ ],

  "toolcraftDetails": { /* pass through facts.toolcraftSummary fields the template shows */ },
  "modernTools": { /* pass through facts.modernToolSummary verbatim */ },
  "projectAssets": { /* pass through facts.projectAssets */ },
  "subagentActivity": { /* pass through facts.subagentActivity */ },
  "parserWarnings": [ /* pass through facts.parserWarnings */ ],

  "evidenceAtoms": [ /* pass through facts.evidenceAtoms verbatim — the template renders drill-downs from these */ ],
  "episodes": [ /* pass through facts.workflowEpisodes verbatim */ ],
  "incidents": [ /* pass through facts.criticalIncidents verbatim */ ],

  "diagnosis": {
    "collaborationProfile": {"en": "...", "zh": "..."},
    "coreDiagnosis": {"en": "...", "zh": "..."},
    "crossDimensionReading": {"en": "...", "zh": "..."}
  },

  "highlights": {
    "strength": { "dimensionId": "completion", "headline": {"en": "...", "zh": "..."} },
    "bottleneck": { "dimensionId": "proof_check", "headline": {"en": "...", "zh": "..."} }
  },

  "observations": [
    {"text": {"en": "...", "zh": "..."}, "dimensionId": "proof_check", "evidenceRefs": ["a3", "a17"]}
  ],

  "suggestions": [
    {
      "type": "verification_loop",
      "dimensionId": "proof_check",
      "priority": "high",
      "title": {"en": "...", "zh": "..."},
      "summary": {"en": "...", "zh": "..."},
      "body": {"en": "...", "zh": "..."},
      "evidence": {"en": "...", "zh": "..."},
      "evidenceRefs": ["a3", "i1"],
      "promptRewrite": {"en": "...", "zh": "..."},
      "steps": null,
      "snippet": null,
      "verifyBy": {"en": "next run: proofCommands.passed > 0", "zh": "下次运行：proofCommands.passed > 0"},
      "expectedImpact": {"en": "+10-15 Proof Check", "zh": "验证意识 +10-15"}
    }
  ],

  "agentsMdDraft": null   // or the string from Step 8c
}
```

All prose fields are bilingual `{en, zh}` — same meaning, not a literal translation.

## Step 10 — Render and open

```bash
node scripts/render-report.mjs ~/.codex-radar/temp/codex-report.json
```

This validates the report JSON (fails with a readable list of missing fields), appends a summary line to `~/.codex-radar/history.jsonl`, injects previous runs of the same project as `history` + `delta`, writes the single-file HTML to `~/.codex-radar/reports/`, prints the path, and tries to open it in the browser.

## Step 11 — Brief terminal summary

```text
✓ Codex Radar report ready
  Project: <project> (<profileLabel>)
  Overall: <overallGrade> · <overallScore>/100
  Communication: <c1> · Engineering: <c2> · Outcome: <c3>
  Confidence: <confidenceLevel>
  File: ~/.codex-radar/reports/<filename>.html

<one-line takeaway from diagnosis.coreDiagnosis>
```

If this is not the first run for the project, add one line: `Since last run: <the biggest dimension delta>`. Do **not** dump the full dimension breakdown, diagnosis, or suggestions in chat — that is what the HTML report is for.

---

## Principles

1. **The parser computes, you interpret.** Baselines come from `computedBaselines` — your value-add is the bounded adjustment, the diagnosis, and suggestions that only make sense for THIS user.
2. **N/A is honest.** When a dimension genuinely doesn't apply, say so. Don't fake a 50.
3. **Diagnosis is the gift.** Scores say *what*; diagnosis says *why* and *what to do*. Spend the most thought on Steps 7-8.
4. **Evidence beats opinion.** Every claim traces to a cited atom, incident, or episode.
5. **Language follows the data.** `report.language` = `facts.dominantLanguage`. Don't override it.
6. **Automation is not conversation.** When `automationShare` is high, judge the prompt templates and the pipeline's engineering, and say plainly that this is an automation profile.

## Error recovery

- **Parser fails / invalid JSON:** tell the user the JSONL may be corrupted; try another project. Don't continue.
- **`parserWarnings` mentions format drift (coverage < 90%):** still produce the report, surface the warning prominently, and suggest updating codex-radar.
- **Too little data** (`confidenceLevel: "low"` AND `stats.humanMessages < 5`): tell the user there's too little to evaluate; pick another project. Don't produce a report.
- **Low but workable** (`humanMessages >= 5`): produce the report, set `profile.confidence: "low"`, and have the diagnosis mention the small sample.
- **All sessions are subagent threads:** the parser exits with a message — explain that this cwd only contains agent-spawned threads.
- **Render fails validation:** fix the listed fields in the report JSON and re-run; if it still fails, show the user the report JSON path.
- **`mkdir`/write errors:** run `mkdir -p ~/.codex-radar/temp` then retry.
