# Codex Radar

> **A Codex plugin that reads local Codex session history and diagnoses how well you collaborate with the agent.** 9 dimensions across 3 categories — Communication, Engineering, Outcome. Deterministic scripts extract facts, calculate every score, enforce the report contract, and render a single-file HTML dashboard; your active Codex session contributes only bounded evidence adjustments and the qualitative diagnosis.

🌏 [中文版](./README_zh.md) · 📖 [Methodology](./docs/METHODOLOGY.md) · 🖥 [Live preview](https://lemomo-ai.github.io/codex-radar/) · ⚖️ [License](./LICENSE)

> **中文简介：** 一款 Codex 插件，读取本地 Codex 会话记录，从「沟通力 / 工程力 / 成效」三个层面、9 个维度评估协作质量。确定性脚本负责事实提取、全部分数计算、报告契约校验与 HTML 渲染；当前 Codex 会话只负责有界证据微调和定性诊断。完整中文文档 → [README_zh.md](./README_zh.md)

<img width="1466" height="1088" alt="Codex Radar dashboard with collaboration grade, category scores, radar chart, and key findings" src="https://github.com/user-attachments/assets/41cc593c-e546-4222-829f-c96fe87960a8" />

---

## Key features

**🎯 Reads your actual Codex sessions, not synthetic prompts.** Codex Radar parses the real JSONL your agent already writes — every prompt you sent, every shell command and its exit code (both old and new rollout formats), every `apply_patch` edit, every plan update, MCP / web-search / subagent call. Subagent threads are excluded (their "user messages" are agent-authored) and `codex exec` batch runs are judged as an automation profile, not as conversation.

**💬 Your Codex writes the coaching note; scripts own the math.** A deterministic parser computes every formula baseline, a compact model-input step selects fired suggestion recipes, and a strict finalizer clamps evidence adjustments, calculates all final/category/overall scores, validates evidence references, and assembles the report. The model never hand-calculates grades.

**📋 Suggestions are typed interventions, not platitudes.** Prompt rewrites, workflow playbooks, paste-ready setup files (including a generated `AGENTS.md` draft), tool-adoption moves, and definition-of-done rituals — each grounded in cited evidence, each with a `verifyBy` metric your next report can check.

**⚖️ Project-type-aware weighting.** A 3-message fix isn't judged on the same scale as a 50-session feature build — or a 200-run image pipeline. Codex Radar auto-classifies each project (`one-shot` / `feature-build` / `long-running` / `learning` / `automation`) and applies different category weights. When a signal genuinely can't be evaluated, the dimension is marked **N/A** instead of faked.

**🛠 Scores how you drive the platform, not just how you talk.** Command success rate, plan-step completion, per-server MCP usage and error rates, subagent orchestration lifecycle (spawned vs actually closed), web research, skills, context hygiene. Proof means verification that actually ran — `echo 验证` doesn't count, and a failed test run you reacted to earns credit.

**📈 Every run remembers the last one.** Reports keep a local history — the second run shows score trends and per-dimension deltas ("since last run: Proof Check +9"), closing the loop with each suggestion's `verifyBy`.

**🔒 Local-first artifacts with explicit privacy controls.** Bundled scripts make no network calls and require no separate API key. Standard mode redacts common credentials; strict mode omits message/command snippets, thread titles, web-search queries, and episode opening/closing text. Facts, analysis JSON, reports, and caches are written with private permissions under `~/.codex-radar/`. Model interpretation still occurs inside your active Codex session and follows its configured data handling.

> **中文要点：**
> - **🎯 评估你真实的 Codex 会话记录**：兼容新旧两代落盘格式；子代理线程被剔除（那些"用户消息"是 agent 写的）；`codex exec` 批量运行按自动化画像评判
> - **💬 模型写诊断，脚本管数学**：解析器计算全部公式基线，finalizer 封顶微调并计算最终分、分类分和总分，同时严格验证证据引用与报告结构
> - **📋 建议是类型化干预**：话术改写 / 工作流 playbook / 可落盘的 setup 文件（含自动生成的 AGENTS.md 草稿）/ 工具接入 / 完成定义仪式，每条带 `verifyBy` 指标供下次报告核对
> - **⚖️ 按项目类型公平加权**：一次性 / 功能开发 / 长期 / 学习 / **自动化** 各用不同权重；无法评估的维度标记 N/A，绝不假装给 50 分
> - **🛠 专门评估你怎么用平台**：命令成功率、plan 步骤完成度、MCP 按服务器统计与错误率、子代理编排闭环（spawn 了几个、close 了几个）、skills、上下文卫生；`echo 验证` 不算验证
> - **📈 每次运行都记得上一次**：本地历史 → 第二次起显示趋势与各维度 delta（"较上次：验证意识 +9"）
> - **🔒 本地优先与隐私模式**：插件脚本不发网络请求、无需单独 API key；标准模式自动脱敏，严格模式不保留消息/命令片段、thread 标题、搜索词及会话开场/收尾文本；模型分析仍发生在当前 Codex 会话中
>
> 完整中文版 → [README_zh.md](./README_zh.md)

---

## What the report includes

Ask Codex to run the plugin and you get a single-file HTML dashboard laid out like a coaching report — verdict first, evidence one click away:

**Verdict** — your S–D grade with a one-line insight, the project profile you're being judged on, a real 9-dimension radar chart, and (from the second run) the score trend.

**Key Reads** — the core diagnosis as a pull-quote, plus two headline cards: your **strongest signal** and your **main bottleneck**, each pinned to a dimension and clickable through to its scoring rationale. The full collaboration profile and the cross-category pattern read sit one fold below.

**Action Plan** — the one suggestion to act on first is spotlighted with its cited evidence, a copy-ready prompt, and a `verifyBy` metric your next report can check; the remaining typed suggestions (prompt rewrites, workflow playbooks, setup files, tool adoptions, verification rituals) collapse to one-line rows — plus a generated `AGENTS.md` draft when your project lacks one.

**Scorecard** — three category blocks, each scoring 0-100 with its 3 dimensions:

| Category | Dimensions |
| --- | --- |
| **Communication** | Lock-On 瞄准力 · Scene Setting 铺场力 · Steering 校准力 |
| **Engineering** | Toolcraft 工具调度 · Architecture 工程脚手架 · Tempo 推进节奏 |
| **Outcome** | Efficiency 产出效率 · Proof Check 验证意识 · Completion 闭环完成 |

Every dimension row expands into its formula baseline, the bounded evidence-cited adjustment, the reasoning, and per-dimension deltas since the last run.

**Appendix** — collapsed by default: friction points (retry churn, corrections, aborted turns), a drill-down of recent sessions, the cited evidence atoms, and platform metrics — tool categories, per-server MCP usage, subagent orchestration lifecycle, plan completion, context hygiene, project assets, command success rate.

---

## Install

**Step 1** — Add the marketplace (this repo is itself a Codex marketplace):

```bash
codex plugin marketplace add lemomo-ai/codex-radar
```

**Step 2** — Install the plugin:

```bash
codex plugin add codex-radar@codex-radar-marketplace
```

**Alternative (local checkout):**

```bash
git clone https://github.com/lemomo-ai/codex-radar.git ~/codex-radar
codex plugin marketplace add ~/codex-radar
codex plugin add codex-radar@codex-radar-marketplace
```

Start a **new thread** after installing so Codex picks up the new skill.

---

## Use

Codex Radar runs through natural language — there's no slash command to memorize. In a new thread, ask:

```text
Run Codex Radar on this project
```

1. Codex Radar detects your current working directory in local session history and asks whether to analyze it.
2. Confirm, or pick from the recent-projects list.
3. It parses deterministic facts and prepares a compact, untrusted-data-bounded model input.
4. Codex writes the qualitative analysis; the finalizer validates it and computes every score.
5. The dashboard is written to `~/.codex-radar/reports/` and the path is printed.

Starter prompts like *"Analyze my Codex collaboration"* or *"Create a Codex Radar report"* work too.

---

## Requirements

- **Codex CLI** with plugin support
- **Node.js 18+**
- No `npm install`, no build step, no server

---

## Privacy

Codex Radar minimizes exposure and keeps generated artifacts local:

- Bundled scripts make no network calls, use no separate API key, and emit no plugin telemetry
- `~/.codex/sessions`, `~/.codex/archived_sessions`, and `~/.codex/session_index.jsonl` are read-only
- Standard mode redacts common API keys, tokens, passwords, JWTs, and private keys before evidence is written
- Strict mode omits message/command snippets, thread titles, web-search queries, and episode opening/closing text
- Reports and temporary JSON use private file permissions; temporary analysis artifacts older than 7 days are cleaned up
- Project-asset detection only checks whether files like `AGENTS.md`, `.git`, or a tests folder exist — it never reads their contents
- Reports may include short snippets of your own prompts as evidence — treat the HTML as private unless you intentionally share it
- The qualitative interpretation is performed by your active Codex session; its data handling is governed by your Codex configuration and account/workspace policy

Use `--privacy strict` through the skill when prompt, thread-title, or search-query excerpts must not be retained.

---

## How scoring works

**Five controlled layers:**

1. **Facts + baselines** — `parse-codex-project.mjs` classifies sessions (interactive / automation / subagent), joins tool calls to their outputs across both rollout formats, extracts countable signals plus an id-addressable evidence layer (atoms, episodes, incidents), and **computes all 9 formula baselines in code**. Deterministic: same input → same facts, same baselines.
2. **Model input** — `prepare-model-input.mjs` loads the rubric, evaluates every recipe trigger in code, strips irrelevant rubric detail, and creates a private `analysis-1` template.
3. **Interpretation** — the active Codex session reads only the compact model input and writes evidence adjustments, diagnosis, observations, and typed suggestions. Session content is explicitly treated as untrusted quoted data.
4. **Finalize** — `finalize-report.mjs` validates bilingual fields, evidence IDs, adjustment caps, suggestion payloads, priority ordering, and AGENTS.md conditions; it then calculates every final score and assembles report schema 3.0.
5. **Render** — `render-report.mjs` revalidates score consistency, appends local history, injects trend + delta, and produces a self-contained HTML file.

The bundled scripts make no network calls and need no separate API key. Interpretation runs inside your active Codex session.

👉 [Read the full Methodology](./docs/METHODOLOGY.md)

---

## Transparent rubric

Dimension definitions, profile weights, adjustment rules, and suggestion recipes live in [`plugins/codex-radar/data/rubric.json`](./plugins/codex-radar/data/rubric.json). The single executable formula source is [`scoring.mjs`](./plugins/codex-radar/skills/analyze/scripts/scoring.mjs):

- 9 dimension definitions (English + 中文), adjustment guides, and per-dimension suggestion recipes
- 5 project profiles (including `automation`) with per-profile category weight tables
- Confidence-based adjustment caps and grade thresholds (S / A / B / C / D)

Want scoring to match your team's standards? Edit the rubric and `scoring.mjs`, then run `node --test tests/*.test.mjs`; contract tests cover the complete facts → model input → final report → HTML workflow.

---

## Repository layout

This repo is itself a Codex plugin marketplace.

```text
codex-radar/
├── .agents/plugins/marketplace.json      # Codex marketplace manifest
├── .github/workflows/test.yml            # CI: syntax checks + fixture tests
├── docs/
│   ├── index.html                        # GitHub Pages landing page
│   ├── METHODOLOGY.md / METHODOLOGY_zh.md # scoring spec (EN + 中文)
├── tests/                                # fixture-based regression suite (node --test)
└── plugins/
    └── codex-radar/
        ├── .codex-plugin/plugin.json      # plugin manifest
        ├── data/rubric.json               # 9-dim definitions, recipes, profile weights
        ├── viewer/template.html           # the single-file dashboard shell
        └── skills/analyze/
            ├── SKILL.md                    # orchestration: detect → parse → adjust → render
            └── scripts/
                ├── lib.mjs                 # shared helpers + incremental meta cache
                ├── signals.mjs             # message classifiers, proof/exit-code extractors
                ├── list-codex-projects.mjs # project list: kinds breakdown + noise folding
                ├── compute-baseline.mjs     # per-session metric distributions (cached)
                ├── parse-codex-project.mjs  # facts + redacted evidence
                ├── scoring.mjs              # single source for 9 baseline formulas
                ├── recipe-triggers.mjs      # deterministic suggestion recipe predicates
                ├── prepare-model-input.mjs  # compact model input + analysis template
                ├── report-contract.mjs      # analysis/report validation
                ├── finalize-report.mjs      # deterministic score/report assembly
                └── render-report.mjs        # history/delta → single-file HTML
```

Zero runtime dependencies.

---

## License

Codex Radar is released under **CC BY-NC 4.0**:

- ✅ **Free** for personal, educational, research, and any non-commercial use
- ✅ **Forking, modifying, sharing** is welcomed — please attribute the original repo and indicate any changes
- ❌ **Commercial use** (bundling into paid products, internal use beyond individual scope in for-profit companies, paid SaaS hosting, selling reports/analyses based on the scoring) requires a separate license

**For commercial licensing**, contact: **leifdiao@gmail.com**

See [LICENSE](./LICENSE) for the full terms.

---

*Built for people who care about the quality of AI collaboration.*
