[中文版](./METHODOLOGY_zh.md)

# Codex Radar — Methodology

> Codex Radar is not focused on code output. It focuses on *how you collaborate with Codex as a platform* — your communication, your engineering setup, and your actual outcomes.
>
> This document is the public scoring specification. Every number in your report traces back to a formula here, and every formula reads from signals the parser extracts from your real Codex sessions.

---

## Design principles

1. **Evidence first.** Every score traces back to concrete, countable session signals.
2. **Reproducible inputs, transparent rubric.** The parser is deterministic — same sessions, same facts. Your Codex model then scores against a public rubric (formula baseline + cited adjustment), so every number traces to a formula and real evidence.
3. **Privacy is non-negotiable.** Session data stays local. No cloud, no separate API key, no telemetry — the analysis runs in your own Codex session.
4. **N/A is honest.** When a dimension genuinely can't be evaluated, it shows N/A — never a faked 50.
5. **Profile-aware fairness.** Different project types deserve different category weights.
6. **Transparency.** The rubric and the formulas are in the repo. Change them and the next run reflects your standards.

---

## How it works

```
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
~/.codex/session_index.jsonl
         │
         ▼
 [list-codex-projects.mjs]   ← Groups sessions by cwd, matches your current directory.
         │
         ▼
 [parse-codex-project.mjs]   ← Deterministic. Extracts countable signals into
         │ facts.json           facts.json. No scoring here.
         ▼
 [ your Codex model ]        ← Reads facts + rubric.json. Scores 9 dimensions
         │ report.json          (formula baseline + ±15 evidence adjustment) and
         │                      writes the diagnosis + suggestions.
         ▼
 [render-report.mjs]         ← Pure transform. report.json → single-file HTML.
         │
         ▼
 ~/.codex-radar/reports/<project>-<ts>.html
```

Four stages. The deterministic parser produces the facts; your Codex model turns facts + rubric into the scored report; the renderer makes the HTML. The judge is the same Codex model you're already working with.

The plugin itself makes no network calls and needs no separate API key — the scoring runs inside your own Codex session, and reports stay on your machine.

---

## What the parser reads

`parse-codex-project.mjs` walks each session's JSONL and counts genuine Codex record types:

| Record / payload type | Used for |
| --- | --- |
| `session_meta` | cwd, session id, model provider, source |
| `user_message` | message classification (the communication signals) |
| `agent_message`, `task_complete.last_agent_message` | user-visible agent output, completion |
| `function_call`, `custom_tool_call` | tool usage by category |
| `exec_command_end` | shell command text + exit code + proof detection |
| `patch_apply_end` | `apply_patch` edits, distinct files touched |
| `web_search_call`, `image_generation_call`, `view_image_tool_call` | research / visual tool usage |
| `mcp_tool_call_end` | MCP server usage |
| `collab_agent_spawn_end` | subagent spawns |
| `update_plan` (function call) | plan updates |
| `task_started` / `task_complete` / `turn_aborted` | turn completion vs abort (Tempo, Completion) |
| `compacted` / `context_compacted` | context pressure |
| `error` | error events |

Each user message is also feature-classified (bilingual EN/中文 keyword matching) into: explicit goal, expected behavior, constraints, file path, error log, asks-for-plan, asks-for-verification, correction, confirmation, and code/structured data.

---

## Position-aware signals

Before counting, user messages are bucketed by position, and each communication dimension reads from its own bucket:

| Bucket | Definition | Feeds |
| --- | --- | --- |
| `directing` | every user message | Lock-On, Steering |
| `opening` | first 2 messages of a session | Scene Setting |
| `correcting` | messages flagged as a correction | Steering |
| `confirming` | messages flagged as a confirmation | Steering |
| `continuing` | "continue / 继续 / next" messages | (context) |

---

## Three categories, nine dimensions

| Category | Dimension | Measures |
| --- | --- | --- |
| **Communication** | Lock-On 瞄准力 | Whether directives give Codex a concrete target (goal, expected behavior, file paths, constraints) |
| | Scene Setting 铺场力 | How much useful context the opening messages provide |
| | Steering 校准力 | Quality of course-correction and verification requests during the session |
| **Engineering** | Toolcraft 工具调度 | Deliberate use of shell, patching, plan, MCP, search, image, and subagents + command success rate |
| | Architecture 工程脚手架 | Durable project context: `AGENTS.md`, `.codex`/`.agents`, git, manifests, README, tests |
| | Tempo 推进节奏 | Steady progress without excessive aborts, compactions, errors, or tool churn |
| **Outcome** | Efficiency 产出效率 | Useful output per human message and per tool call |
| | Proof Check 验证意识 | Tests, builds, lint, screenshots, renders, and explicit verification |
| | Completion 闭环完成 | Whether turns finish cleanly rather than being left mid-turn |

---

## Scoring formulas

Each dimension has a **baseline formula** that the model computes from the facts and clamps to [0, 100]; it then applies confidence scaling and a bounded ±15 evidence-cited adjustment (see below). Ratios (e.g. `directing.filePath`) are the share of messages in that bucket carrying the signal; `commandSuccessRate` is exit-code-0 commands over all commands with an exit code.

```text
Lock-On       = 35 + goal·20 + expected·18 + filePath·18 + constraints·10 + errorLog·8
                   − max(0, 90 − avgMsgLen)·0.08
Scene Setting = 30 + opening.expected·22 + opening.constraints·16 + opening.filePath·16
                   + opening.codeOrData·14 + clamp(avgMsgLen/7, 0, 12)
Steering      = 38 + asksVerify·20 + correction·16 + confirmation·10 + errorLog·8 − abortRatio·12
Toolcraft     = 30 + min(20, #toolCategories·4) + commandSuccessRate·18
                   + min(12, planUpdates·3) + min(10, web+browser+mcp) + min(10, subagents·3)
Architecture  = 25 + (AGENTS.md?20) + (.codex|.agents?12) + (git?12) + (manifest?12)
                   + (README?8) + (tests?8) + min(8, rootEntries/8)
Tempo         = 72 − abortRatio·28 − min(14, compactions·3) − min(12, errors·3)
                   + min(10, cleanEndRatio·10) − max(0, toolsPerMsg − 10)·2
Efficiency    = 35 + min(24, editsPerMsg·18) + min(16, filesPerMsg·18)
                   + commandSuccessRate·12 + cleanEndRatio·10 − max(0, toolsPerMsg − 12)·2
Proof Check   = 28 + min(34, proofCommands·8) + asksVerify·18 + (tests?8) + min(12, browser+image)
Completion    = 45 + cleanEndRatio·35 + min(10, agentMsgs/turnsCompleted·3)
                   − abortRatio·18 − min(8, errors·2)
```

**Proof commands** are detected by pattern: `npm/pnpm/yarn/bun (test|build|check|lint|typecheck)`, `pytest / ruff / mypy / cargo test|check / go test / swift test / xcodebuild / playwright / vitest / jest / tsc`, and `screenshot / render / validate / doctor / 检查 / 验证`.

**Category score** = average of the *applicable* dimensions in that category.
**Overall score** = profile-weighted sum of category scores, renormalized over the categories that have a score.

| Grade | S | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| Threshold | ≥ 85 | ≥ 70 | ≥ 55 | ≥ 40 | ≥ 0 |

**Confidence scaling + adjustment.** After the baseline, the model shrinks low-confidence scores toward 50 (×0.75 low, ×0.9 medium, ×1.0 high), then applies a bounded **±15 adjustment** that must cite specific evidence from your real messages (`keyMessages` / `sampleExchanges` / `sessionFlows`). No evidence → no adjustment.

---

## Project profile (the fairness engine)

Every project is auto-classified, and the classification picks the category weights:

| Profile | Detection | comm / eng / out |
| --- | --- | --- |
| `long-running` | ≥ 5 sessions, OR ≥ 2 compactions, OR ≥ 30 messages | 0.30 / 0.40 / 0.30 |
| `feature-build` | ≥ 4 file edits, OR ≥ 3 distinct files touched | 0.34 / 0.33 / 0.33 |
| `learning` | 0 file edits AND ≥ 4 messages | 0.70 / 0.30 / 0.00 |
| `one-shot` | everything else (few messages, little editing) | 0.50 / 0.10 / 0.40 |

**N/A handling:** Architecture is marked N/A when the recorded project directory can't be resolved on the current machine — filesystem inspection isn't possible without it. Some dimensions are also N/A by project type: `one-shot` drops Architecture, Tempo, and Completion; `learning` drops Efficiency and Completion (closure/efficiency semantics don't apply there). The category score then averages only the applicable dimensions, and the overall weight renormalizes.

The profile is shown next to the overall grade, so a "B" on a one-shot fix isn't read as a "B" on a long-running build.

---

## Diagnosis and suggestions

Both are written by your Codex model from the scored dimensions and the facts:

- **Insight** — one vivid bilingual hero line (a coach's wake-up call, often a tension like strong-X-but-weak-Y).
- **Diagnosis** — a free-form collaboration profile (120-180 words), a core read (strongest strength + most critical bottleneck, with evidence and the bottleneck's concrete cost), and a cross-dimension reading. Observable behavior, not personality archetypes.
- **Suggestions** — MINIMUM 5, up to 7 paste-ready prompt rewrites, each tagged with its dimension and an expected-impact band. For high scorers, level-up moves replace corrective ones.

Every claim must cite evidence from your real session — `keyMessages`, `sampleExchanges`, `sessionFlows`, or the tool/outcome totals. Bilingual parity throughout (en/zh).

---

## What we don't measure

- **Code quality** — that's what linters, tests, and reviewers are for
- **Language / framework competence** — not our lane
- **Absolute productivity** — we can't tell you if you shipped more this week
- **Security posture** — separate discipline

We measure **collaboration behavior + engineering setup + outcome density**, not the final shipped artifact.

---

## Known limitations

1. **Keyword signals are bilingual (EN + 中文).** Other languages will under-score on the verbal dimensions.
2. **Invisible verification.** Reviewing a diff in your editor before saying "ok" looks the same as blind-accepting — we see the conversation, not your screen.
3. **Architecture needs filesystem access.** Run the analysis on a different machine than where the project lives and Architecture is N/A.
4. **Profile classification is heuristic.** A 4-session prototype may be read as `feature-build`. Re-run after more sessions if the type shifts.
5. **The rubric is opinionated.** We define strong collaboration as goal-directed + tool-fluent + verification-heavy + closure-oriented. Tune `rubric.json` and the formulas if your team disagrees.

---

## How to change the scoring

- **Dimension definitions, profile weights, grade thresholds** → `plugins/codex-radar/data/rubric.json`
- **The formulas themselves** → each dimension's `baselineFormula` in `plugins/codex-radar/data/rubric.json` (the parser extracts facts only; your Codex model computes the formulas)
- **Profile classification** → `classifyProject()` in the same file
- **Proof-command patterns** → `isProofCommand()` in the same file

No build step — the parser re-reads the rubric on every run.

---

*Codex Radar is open source. The methodology stays transparent so teams can understand the scoring logic and adapt it to their workflow.*
