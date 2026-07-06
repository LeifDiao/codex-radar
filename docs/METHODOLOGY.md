[中文版](./METHODOLOGY_zh.md)

# Codex Radar — Methodology (v2.1)

> Codex Radar is not focused on code output. It focuses on *how you collaborate with Codex as a platform* — your communication, your engineering setup, and your actual outcomes.
>
> This document is the public scoring specification. Every number in your report traces back to a formula here, and every formula reads from signals the parser extracts from your real Codex sessions.

---

## Design principles

1. **Evidence first.** Every score traces back to concrete, countable session signals; every diagnosis claim cites an id-addressable evidence atom.
2. **The parser computes, the model interprets.** All formula baselines are computed deterministically **in code** (`facts.computedBaselines`). Your Codex model only applies a bounded, evidence-cited adjustment and writes the prose. Same sessions → same baselines, every time.
3. **Privacy is non-negotiable.** Session data stays local. No cloud, no separate API key, no telemetry — the analysis runs in your own Codex session.
4. **N/A is honest.** When a dimension genuinely can't be evaluated, it shows N/A — never a faked 50.
5. **Profile-aware fairness.** Different project types deserve different category weights — and automation pipelines are not judged as conversations.
6. **Transparency.** The rubric and the formulas are in the repo. Change them and the next run reflects your standards.

---

## How it works

```
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
~/.codex/session_index.jsonl
         │
         ▼
 [list-codex-projects.mjs]   ← Incremental meta cache; groups sessions by cwd,
         │                      folds automation-noise subfolders, shows the
         │                      interactive / automation / subagent mix.
         ▼
 [compute-baseline.mjs]      ← (cached, 7-day TTL) distribution of YOUR typical
         │                      per-session metrics — the self-baseline anchor.
         ▼
 [parse-codex-project.mjs]   ← Deterministic. Classifies each session
         │ facts.json           (interactive / automation / subagent — subagent
         │                      threads are excluded and summarized separately),
         │                      joins tool calls to their outputs by call_id,
         │                      extracts signals, evidence atoms, workflow
         │                      episodes, critical incidents, AND computes the
         │                      9 formula baselines (computedBaselines).
         ▼
 [ your Codex model ]        ← Reads facts + rubric.json. Applies a bounded,
         │ report.json          confidence-capped adjustment per dimension,
         │                      writes observations, diagnosis, and typed
         │                      suggestions instantiated from recipes.
         ▼
 [render-report.mjs]         ← Validates the report schema, appends to
         │                      ~/.codex-radar/history.jsonl, injects trend +
         │                      delta vs the previous run, renders HTML.
         ▼
 ~/.codex-radar/reports/<project>-<ts>.html
```

The plugin itself makes no network calls and needs no separate API key — the scoring runs inside your own Codex session, and reports stay on your machine.

---

## Session kinds

Every session is classified from its `session_meta` before anything is counted:

| Kind | Detection | Treatment |
| --- | --- | --- |
| `interactive` | `source` is `cli` / `vscode` / desktop | Fully counted |
| `automation` | `source == "exec"` (non-interactive `codex exec` runs) | Counted, but drives the `automation` profile when dominant |
| `subagent` | `thread_source == "subagent"` or a subagent `source` object | **Excluded from all stats** — its "user messages" are agent-authored. Summarized separately as orchestration evidence (`subagentActivity`). |

---

## What the parser reads

`parse-codex-project.mjs` walks each session's JSONL and handles both rollout generations:

| Record / payload type | Used for |
| --- | --- |
| `session_meta` | cwd, session kind, model provider, source |
| `user_message` | message classification (the communication signals) |
| `agent_message`, `task_complete.last_agent_message` | agent output count / closing narrative (deduplicated) |
| `function_call` + `function_call_output` **joined by `call_id`** | **modern shell commands** — command text from `arguments`, exit code from the output (`Process exited with code N` or structured `exit_code`) |
| `exec_command_end` | legacy shell commands — merged with the join above by `call_id`, never double-counted |
| `custom_tool_call` (`apply_patch`) | patch fallback (files parsed from the patch text when `patch_apply_end` is absent) |
| `patch_apply_end` | edits, distinct files touched |
| `update_plan` (function call) | plan updates + per-plan step completion |
| `spawn_agent` / `wait_agent` / `close_agent` | subagent orchestration lifecycle |
| `mcp_tool_call_end` | MCP usage per server / per tool, error rate |
| `web_search_call`, `image_generation_call`, `view_image` | research / visual usage |
| `tool_search_call`, `create/update/get_goal`, `thread_goal_updated` | platform-fluency signals |
| `task_started` / `task_complete` / `turn_aborted` | turn completion; **silently dropped turns** (started but never finished) count against closure |
| `compacted` / `context_compacted`, `token_count` | context pressure and peak context usage |
| `error` / `stream_error` | error events |
| anything else | counted by the **format-drift detector** (`parserCoverage`) — if unknown events exceed 10%, the report warns that the Codex format may have drifted |

Shell commands that touch `~/.codex/skills/*/SKILL.md` are also recorded as skill usage.

---

## Position-aware signals

User messages are bucketed by position, and each communication dimension reads from its own bucket:

| Bucket | Definition | Feeds |
| --- | --- | --- |
| `directing` | every user message | Lock-On, Steering |
| `opening` | **first 2 messages of EACH session** | Scene Setting |
| `correcting` | messages flagged as a correction (with a `substanceRatio`: how many corrections carry a path / error / code) | Steering |
| `confirming` | messages flagged as a confirmation | Steering |
| `continuing` | "continue / 继续 / next" messages | (context) |

Message features (bilingual EN/中文, precision-tuned with a labeled regression test set): explicit goal, expected behavior, constraints, file path, error log, asks-for-plan, asks-for-verification, correction, confirmation, code/structured data.

---

## Three categories, nine dimensions

| Category | Dimension | Measures |
| --- | --- | --- |
| **Communication** | Lock-On 瞄准力 | Whether directives give Codex a concrete target (goal, expected behavior, file paths, constraints) |
| | Scene Setting 铺场力 | How much useful context each session's opening messages provide |
| | Steering 校准力 | Quality of course-correction (do corrections show, not just tell?) and verification requests |
| **Engineering** | Toolcraft 工具调度 | Deliberate use of shell, patching, plan, MCP, search, and subagents + command success rate + orchestration quality |
| | Architecture 工程脚手架 | Durable project context: `AGENTS.md`, `.codex`/`.agents`, git, manifests, README, tests |
| | Tempo 推进节奏 | Steady progress without excessive aborts, compactions, errors, retry churn, or tool churn |
| **Outcome** | Efficiency 产出效率 | Useful output per human message and per tool call |
| | Proof Check 验证意识 | Verification that actually ran — and passed |
| | Completion 闭环完成 | Whether turns finish cleanly rather than being aborted or silently dropped |

---

## Scoring formulas

The parser computes each baseline, clamps to [0, 100], applies confidence scaling, and publishes the result as `facts.computedBaselines`. Ratios (e.g. `directing.filePath`) are the share of messages in that bucket carrying the signal.

```text
Lock-On       = 35 + goal·20 + expected·18 + filePath·18 + constraints·10 + errorLog·8
                   − max(0, 90 − avgMsgLen)·0.08
Scene Setting = 30 + opening.expected·22 + opening.constraints·16 + opening.filePath·16
                   + opening.codeOrData·14 + clamp(avgMsgLen/7, 0, 12)
Steering      = 38 + asksVerify·20 + correctionSubstance·16 + min(10, confirmShare·30)
                   + errorLog·8 − abortRatio·12
Toolcraft     = 30 + min(20, #toolCategories·4) + cmdSuccessRate·18
                   + min(12, planUpdates·3) + min(10, web+browser+mcp) + min(10, subagents·3)
Architecture  = 25 + (AGENTS.md?20) + (.codex|.agents?12) + (git?12) + (manifest?12)
                   + (README?8) + (tests?8) + min(8, rootEntries/8)
Tempo         = 72 − abortRatio·28 − min(14, compactions·3) − min(12, errors·3)
                   + min(10, cleanEndRatio·10) − max(0, toolsPerMsg − 10)·2
Efficiency    = 35 + min(24, editsPerMsg·18) + min(16, filesPerMsg·18)
                   + cmdSuccessRate·12 + cleanEndRatio·10 − max(0, toolsPerMsg − 12)·2
Proof Check   = 28 + min(34, proofPassed·8 + proofFailed·4 + proofUnknown·2)
                   + asksVerify·18 + (tests?8) + min(12, browser + viewImage)
Completion    = 45 + cleanEndRatio·35 + min(10, agentMsgs/turnsCompleted·3)
                   − abortRatio·18 − min(8, errors·2)
```

Semantics that matter:

- **`cmdSuccessRate`** is exit-code-0 commands over commands with a *readable* exit code. When no command carries one, it is **neutral (0.5)**, never a punitive 0, and the report says so.
- **`correctionSubstance`** = share of correction messages that carry a file path, error log, or code — corrections that *show*, not just *tell*. Neutral (0.5) when there are no corrections.
- **`abortRatio` / `cleanEndRatio`** are over **started turns**, and silently dropped turns (started, never completed, never explicitly aborted) count as failures to close.
- **Proof commands** are real verification runners only: `npm/pnpm/yarn/bun test|build|lint|typecheck`, `pytest / ruff / mypy / cargo test / go test / vitest / jest / playwright / tsc / eslint / node --test / make test`, etc. `echo 验证` is not proof; generating an image is not proof (viewing/screenshotting one is inspection and counts in the small browser bonus). A **failed test run earns partial credit** — running proof and reacting to red is verification culture.

**Category score** = average of the *applicable* dimensions in that category.
**Overall score** = profile-weighted sum of category scores, renormalized over the categories that have a score.

| Grade | S | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| Threshold | ≥ 85 | ≥ 70 | ≥ 55 | ≥ 40 | ≥ 0 |

**Confidence scaling and the bounded adjustment.** The parser shrinks low-confidence baselines toward 50 (×0.75 low, ×0.9 medium). The model then applies an adjustment that must cite specific evidence atoms / episodes / incidents — and its cap also depends on confidence: **±5 (low), ±10 (medium), ±15 (high)**. Thin data earns less discretionary movement. No evidence → no adjustment.

---

## Project profile (the fairness engine)

Every project is auto-classified, and the classification picks the category weights:

| Profile | Detection | comm / eng / out | N/A dimensions |
| --- | --- | --- | --- |
| `automation` | ≥ 60% of sessions are `codex exec` runs | 0.25 / 0.35 / 0.40 | Steering (single-turn runs can't be course-corrected) |
| `learning` | 0 file edits, ≥ 4 messages, no proof runs | 0.70 / 0.30 / 0.00 | Efficiency, Completion |
| `long-running` | ≥ 5 sessions, OR ≥ 2 compactions, OR ≥ 30 messages | 0.30 / 0.40 / 0.30 | — |
| `feature-build` | ≥ 4 file edits, OR ≥ 3 distinct files touched | 0.34 / 0.33 / 0.33 | — |
| `one-shot` | everything else | 0.50 / 0.10 / 0.40 | Architecture, Tempo, Completion |

Architecture is additionally N/A when the recorded project directory can't be resolved on the current machine. The profile — and the automation share — are shown next to the overall grade.

---

## Evidence pipeline

The model never sees raw sessions; it sees a curated, id-addressable evidence layer:

- **`evidenceAtoms`** — key user messages sampled across three time windows (prioritizing corrections, error pastes, verification asks, code-bearing messages), plus notable shell failures. Each atom records what happened **after** it (tool calls, edits, proof runs, failed commands) so cause and effect stay attached.
- **`workflowEpisodes`** — one narrative row per session: duration, opening message, closing agent message, edits, proof passed/failed, failed commands, aborts, plan completion, corrections.
- **`criticalIncidents`** — command retry churn (same command failing repeatedly), corrections, aborted turns, context pressure: the places where the collaboration actually struggled.
- **`selfBaseline`** — the distribution (p25/median/p75) of your own per-session metrics across all projects, segmented interactive vs automation, so reports can say "half the proof density of your median session".

Diagnosis claims and suggestions must reference these ids (`evidenceRefs`), and the report renders them as clickable drill-downs.

---

## Observations, then suggestions

Suggestion generation is two-pass:

1. **Observations (8-12)** — single-sentence, evidence-cited behavior patterns. This forces the model to look before prescribing.
2. **Suggestions (5-7)** — typed interventions, instantiated from per-dimension **recipes** (trigger conditions in `rubric.json`) before any free-form invention:

| Type | Payload |
| --- | --- |
| `prompt_rewrite` | a pastable prompt |
| `workflow_habit` | a 3-5 step playbook |
| `setup_action` | file content or a shell command ready to paste (e.g. a generated `AGENTS.md` draft) |
| `tool_adoption` | how to wire an unused capability + its first concrete use |
| `verification_loop` | a definition-of-done clause |

Every suggestion carries `evidenceRefs`, a `verifyBy` (which facts metric should move on the next run), and must survive the **anti-generic rule**: if it still makes sense after deleting every project-specific noun, it gets rewritten.

When a project has ≥3 sessions, a resolvable directory, and no `AGENTS.md`, the report also includes a complete **AGENTS.md draft** generated from the observed commands, conventions, and pitfalls.

---

## Trend and delta

Every render appends a score summary to `~/.codex-radar/history.jsonl`. From the second run on, the report shows a score trend and per-dimension deltas ("since last run: Proof Check +9") — which closes the loop with each suggestion's `verifyBy`.

---

## What we don't measure

- **Code quality** — that's what linters, tests, and reviewers are for
- **Language / framework competence** — not our lane
- **Absolute productivity** — we can't tell you if you shipped more this week
- **Security posture** — separate discipline

We measure **collaboration behavior + engineering setup + outcome density**, not the final shipped artifact.

---

## Known limitations

1. **Keyword signals are bilingual (EN + 中文).** Other languages will under-score on the verbal dimensions. The classifiers ship with a labeled regression test set — improve them and the tests keep you honest.
2. **Invisible verification.** Reviewing a diff in your editor before saying "ok" looks the same as blind-accepting — we see the conversation, not your screen.
3. **Architecture needs filesystem access.** Run the analysis on a different machine than where the project lives and Architecture is N/A.
4. **Profile classification is heuristic.** Re-run after more sessions if the type shifts.
5. **Format drift happens.** Codex CLI's rollout format changes across versions. The parser handles both known generations and ships a drift detector that warns loudly instead of silently under-counting — but a future format may still need a plugin update.
6. **The rubric is opinionated.** We define strong collaboration as goal-directed + tool-fluent + verification-heavy + closure-oriented. Tune `rubric.json` if your team disagrees.

---

## How to change the scoring

- **Dimension definitions, adjustment caps, profile weights, grade thresholds, suggestion recipes** → `plugins/codex-radar/data/rubric.json`
- **The executable formulas** → `computeBaselines()` in `plugins/codex-radar/skills/analyze/scripts/parse-codex-project.mjs` (keep the rubric's formula text in sync — the tests cover the parser side)
- **Message classifiers / proof patterns / tool categories** → `plugins/codex-radar/skills/analyze/scripts/signals.mjs` (with `tests/classifier.test.mjs` as the regression harness)
- **Profile classification** → `classifyProject()` in `parse-codex-project.mjs`

Run `node --test tests/*.test.mjs` after changes — the fixture suite covers both rollout formats, subagent exclusion, and the render pipeline.

---

*Codex Radar is open source. The methodology stays transparent so teams can understand the scoring logic and adapt it to their workflow.*
