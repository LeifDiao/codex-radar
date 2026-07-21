# Codex Radar

> **一款 Codex 插件，读取本地 Codex 会话记录，评估你和 Codex 协作的质量。** 从「沟通力 / 工程力 / 成效」三个层面、9 个维度分析：确定性脚本提取事实、计算全部分数、校验报告契约并渲染单文件 HTML；当前 Codex 会话只负责有界证据微调和定性诊断。

🌏 [English](./README_en.md) · 📖 [方法论](./docs/METHODOLOGY_zh.md) · 🖥 [在线预览](https://lemomo-ai.github.io/codex-radar/) · ⚖️ [协议](./LICENSE)

> **English summary:** A Codex plugin that analyzes local Codex session history across 9 dimensions. Deterministic scripts calculate and validate every score; the active Codex session writes bounded evidence adjustments and the qualitative diagnosis. Full English docs → [README_en.md](./README_en.md)

<img width="1466" height="1088" alt="Codex Radar 报告：协作等级、分类分数、九维雷达图与重点结论" src="https://github.com/user-attachments/assets/41cc593c-e546-4222-829f-c96fe87960a8" />

---

## 核心特性

**🎯 评估你真实的 Codex 会话记录，不靠人工题库。** Codex Radar 直接解析 Codex 已经写好的 JSONL —— 兼容新旧两代落盘格式：每条 prompt、每条 shell 命令和它的退出码、每次 `apply_patch` 编辑、每次 plan 更新，以及 MCP / 搜索 / 子代理调用。子代理线程会被剔除（那些"用户消息"是 agent 写的），`codex exec` 批量运行按自动化画像评判，不会冒充你的对话水平。

**💬 模型写诊断，脚本管数学。** 解析器计算全部公式基线，模型只写按置信度封顶的证据微调和定性内容；严格 finalizer 校验证据 ID、微调上限、建议 payload 和双语字段，再计算最终分、分类分和总分。

**📋 建议是类型化干预，不是空话。** 话术改写、工作流 playbook、可直接落盘的 setup 文件（包括自动生成的 `AGENTS.md` 草稿）、工具接入方案、完成定义仪式 —— 每条都基于引用的证据，每条都带一个 `verifyBy` 指标，下次报告可以核对它有没有生效。

**⚖️ 按项目类型公平加权。** 3 条消息修完的 bug、50 个 session 的功能开发、200 次运行的生图流水线，不会用同一把尺子。Codex Radar 自动归类（一次性 / 功能开发 / 长期 / 学习 / **自动化**），按类别套用不同权重。当某个信号确实无法评估时，维度标记为 **N/A**，绝不假装给一个 50 分。

**🛠 专门评估你怎么用平台，不只是怎么说话。** 命令成功率、plan 步骤完成度、MCP 按服务器统计与错误率、子代理编排闭环（spawn 了几个、真正 close 了几个）、网页研究、skills、上下文卫生。验证必须是真正跑过的 —— `echo 验证` 不算，而跑挂了但你做出反应的测试有加分。

**📈 每次运行都记得上一次。** 报告在本地留档 —— 第二次运行起显示分数趋势和各维度 delta（"较上次：验证意识 +9"），和每条建议的 `verifyBy` 形成闭环。

**🔒 本地产物与明确的隐私模式。** 插件脚本不发网络请求、无需单独 API key。标准模式自动脱敏常见凭证；严格模式不保留消息/命令片段、thread 标题、搜索词及会话开场/收尾文本。facts、analysis、报告和缓存以私有权限写入 `~/.codex-radar/`。模型解释仍发生在当前 Codex 会话中，并遵循该会话的数据处理设置。

> **English highlights:**
> - **🎯 Reads your real Codex sessions** — prompts, shell exit codes, `apply_patch` edits, plan updates, MCP / search / image / subagent calls
> - **💬 The model writes the diagnosis; scripts own the math** — deterministic baselines, bounded adjustments, strict finalization
> - **📋 Every suggestion is a paste-ready prompt** with its expected impact
> - **⚖️ Project-type-aware weighting** — N/A instead of a faked 50 when a signal can't be evaluated
> - **🛠 Evaluates platform leverage** (shell / patch / plan / MCP / search / image / subagents + AGENTS.md scaffolding)
> - **🔒 Local-first artifacts, credential redaction, and strict minimized-evidence mode**
>
> Full English version → [README_en.md](./README_en.md)

---

## 报告里有什么

让 Codex 运行这个插件，你会得到一个单文件 HTML dashboard，按「教练报告」的层级排版 —— 结论在最前，证据一点即达：

**结论** —— S 到 D 的总评等级配一句话 insight、你被评判所用的项目画像、一张真实的九维雷达图，第二次运行起还有分数趋势。

**重点评价** —— 核心诊断以大字引言呈现，配两张高亮卡：你的**最强信号**和**首要瓶颈**，各自钉在一个维度上，点击即跳到评分依据。完整协作画像与跨类别模式解读折叠在下方。

**重点建议** —— 最该先做的那一条被聚焦展示，附引用证据、可直接复制的 prompt 和供下次报告核对的 `verifyBy` 指标；其余类型化建议（话术改写 / 工作流 playbook / setup 文件 / 工具接入 / 验证仪式）收成单行折叠列表；项目缺 AGENTS.md 时还会附一份由会话史生成的草稿。

**评分明细** —— 三大类别分块，每类 0-100 分，下挂 3 个维度：

| 类别 | 维度 |
| --- | --- |
| **沟通力** | Lock-On 瞄准力 · Scene Setting 铺场力 · Steering 校准力 |
| **工程力** | Toolcraft 工具调度 · Architecture 工程脚手架 · Tempo 推进节奏 |
| **成效** | Efficiency 产出效率 · Proof Check 验证意识 · Completion 闭环完成 |

每个维度行都可展开：公式基线、有界的证据微调、评分理由，以及较上次运行的 delta。

**附录** —— 默认折叠：卡壳点（命令重试空转、纠偏、被中断的回合）、近期会话下钻、被引用的证据原子，以及平台指标 —— 工具类别、MCP 按服务器统计、子代理编排闭环、plan 完成度、上下文卫生、项目资产、命令成功率。

---

## 安装

**第一步** —— 添加插件市场（这个仓库本身就是一个 Codex marketplace）：

```bash
codex plugin marketplace add lemomo-ai/codex-radar
```

**第二步** —— 安装插件：

```bash
codex plugin add codex-radar@codex-radar-marketplace
```

**本地安装：**

```bash
git clone https://github.com/lemomo-ai/codex-radar.git ~/codex-radar
codex plugin marketplace add ~/codex-radar
codex plugin add codex-radar@codex-radar-marketplace
```

安装后请**开一个新 thread**，让 Codex 加载新的 skill。

---

## 使用

Codex Radar 通过自然语言触发，没有需要记的斜杠命令。在新 thread 里说：

```text
Run Codex Radar on this project
```

1. Codex Radar 在本地会话记录里检测你的当前工作目录，问你是不是分析这个项目。
2. 确认即用，或者从「最近项目」列表里选。
3. 解析确定性事实并生成精简、带不可信数据边界的 model input。
4. Codex 撰写定性分析；finalizer 严格校验并计算全部分数。
5. Dashboard 写入 `~/.codex-radar/reports/`，并打印路径。

像 *"Analyze my Codex collaboration"* 或 *"Create a Codex Radar report"* 这样的起手 prompt 同样有效。

---

## 环境要求

- **Codex CLI** —— 支持插件版本
- **Node.js 18+**
- 不用 `npm install`、不用编译、不用服务

---

## 隐私

Codex Radar 尽量减少暴露，并将生成产物保留在本地：

- 插件脚本不发网络请求、无需单独 API key，也不发送插件遥测
- `~/.codex/sessions`、`~/.codex/archived_sessions`、`~/.codex/session_index.jsonl` 只读访问
- 标准模式会在证据落盘前脱敏常见 API key、token、密码、JWT 和私钥
- 严格模式会省略消息/命令片段、thread 标题、搜索词及会话开场/收尾文本
- 报告和临时 JSON 使用私有文件权限，超过 7 天的临时分析文件会被清理
- 项目资产检测只判断 `AGENTS.md`、`.git`、测试目录等文件是否存在，从不读取它们的内容
- 报告可能包含你自己 prompt 的短片段作为证据 —— 除非你主动分享，否则请把 HTML 当作私有文件
- 定性解释由当前 Codex 会话完成，其数据处理遵循你的 Codex 配置与账号/工作区策略

需要完全不保留 prompt、thread 标题或搜索词片段时，通过 skill 使用 `strict` 隐私模式。

---

## 评分原理

**五层受控架构：**

1. **事实 + 基线** —— `parse-codex-project.mjs` 给会话分类（交互式 / 自动化 / 子代理），跨两代落盘格式按 `call_id` 把工具调用与输出 join 起来，提取可计数信号和一层可按 id 引用的证据（原子 / 会话叙事 / 关键事件），并**用代码算出全部 9 个公式基线**。确定性：同一输入 → 同一份事实、同一组基线。
2. **模型输入** —— `prepare-model-input.mjs` 自行加载 rubric、用代码判断建议配方是否触发，并生成精简 model input 与私有 `analysis-1` 模板。
3. **定性解释** —— 当前 Codex 会话只读取精简输入，撰写证据微调、诊断、观察和类型化建议；会话内容被明确视为不可信引用数据。
4. **确定性收口** —— `finalize-report.mjs` 校验双语字段、证据 ID、微调上限、建议 payload、优先级顺序和 AGENTS.md 条件，然后计算全部最终分并组装 report schema 3.0。
5. **渲染** —— `render-report.mjs` 再次校验分数一致性，追加本地历史，注入趋势与 delta，产出自包含 HTML。

分析跑在你自己的 Codex 会话里 —— 插件本身不发任何网络请求，也不需要额外的 API key。

👉 [完整方法论](./docs/METHODOLOGY_zh.md)

---

## 评分规则全公开

维度定义、画像权重、微调规则和建议配方位于 [`plugins/codex-radar/data/rubric.json`](./plugins/codex-radar/data/rubric.json)，9 个可执行公式的唯一来源是 [`scoring.mjs`](./plugins/codex-radar/skills/analyze/scripts/scoring.mjs)：

- 9 个维度的定义（中英）、微调指南、按维度的建议配方
- 5 种项目画像（含 `automation` 自动化）+ 各自的类别权重表
- 按置信度封顶的微调上限 + 等级阈值（S / A / B / C / D）

想让评分更贴合团队习惯？修改 rubric 和 `scoring.mjs`，然后跑 `node --test tests/*.test.mjs` —— 契约测试会覆盖 facts → model input → final report → HTML 的完整链路。

---

## 项目结构

这个仓库本身就是一个 Codex 插件市场。

```text
codex-radar/
├── .agents/plugins/marketplace.json      # Codex marketplace 清单
├── .github/workflows/test.yml            # CI：语法检查 + fixture 测试
├── docs/
│   ├── index.html                        # GitHub Pages 落地页
│   ├── METHODOLOGY.md / METHODOLOGY_zh.md # 评分规范（中英）
├── tests/                                # fixture 回归测试套件（node --test）
└── plugins/
    └── codex-radar/
        ├── .codex-plugin/plugin.json      # 插件清单
        ├── data/rubric.json               # 9 维定义、建议配方、画像权重
        ├── viewer/template.html           # 单文件 dashboard 外壳
        └── skills/analyze/
            ├── SKILL.md                    # 编排：检测 → 解析 → 定性分析 → 确定性收口
            └── scripts/
                ├── lib.mjs                 # 共享工具 + 增量 meta 缓存
                ├── signals.mjs             # 消息分类器、proof/退出码提取
                ├── list-codex-projects.mjs # 项目列表：类型构成 + 噪声折叠
                ├── compute-baseline.mjs     # 会话指标分布（自我基准，缓存）
                ├── parse-codex-project.mjs  # 事实 + 脱敏证据
                ├── scoring.mjs              # 9 个基线公式的唯一来源
                ├── recipe-triggers.mjs      # 确定性建议配方谓词
                ├── prepare-model-input.mjs  # 精简模型输入 + analysis 模板
                ├── report-contract.mjs      # analysis/report 严格校验
                ├── finalize-report.mjs      # 确定性算分与报告组装
                └── render-report.mjs        # 历史/delta → 单文件 HTML
```

零运行时依赖。

---

## 协议

Codex Radar 采用 **CC BY-NC 4.0** 协议授权：

- ✅ **免费** 用于个人、教育、研究等任何非商业场景
- ✅ **允许** fork、修改、分享 —— 请注明原作者和原仓库出处，并标注是否做了修改
- ❌ **商业用途**（打包进付费产品、营利组织超出员工个人评估范围、付费 SaaS 托管、基于评分卖报告/分析等）需要单独的商业授权

**商业授权咨询：** **leifdiao@gmail.com**

完整协议条款请见 [LICENSE](./LICENSE)。

---

*为关心 AI 协作质量的人而做。*
