[English](./METHODOLOGY.md)

# Codex Radar — 方法论（v3.0）

> Codex Radar 关注的不是代码产出，而是*你怎么把 Codex 当成一个平台来协作* —— 你的沟通、你的工程设置、你真实的成效。
>
> 这份文档是公开的评分规范。报告里的每个数字都能追溯到这里的某个公式，而每个公式都读取解析器从你真实 Codex 会话里提取出的信号。

---

## 设计原则

1. **证据优先。** 每个分数都能追溯到具体、可计数的会话信号；诊断里的每个论断都引用带 id 的证据原子。
2. **脚本负责计算，模型负责解读。** 公式基线、微调上限、最终分、等级、类别分和总分全部由代码确定性完成。模型只写有界证据微调和定性内容。
3. **隐私承诺必须精确。** 插件脚本不发网络请求，生成产物留在本地；标准模式脱敏常见凭证，严格模式省略消息/命令片段、thread 标题、搜索词及会话开场/收尾文本。模型解释发生在当前 Codex 会话中，并遵循该会话的数据处理设置。
4. **N/A 是诚实。** 当某维度确实无法评估时，显示 N/A —— 绝不假装一个 50 分。
5. **按画像公平。** 不同项目类型用不同的类别权重 —— 自动化流水线不会被当成对话来评判。
6. **透明。** rubric 和公式都在仓库里。改了它们，下一次运行就反映你的标准。

---

## 工作原理

```
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
~/.codex/session_index.jsonl
         │
         ▼
 [list-codex-projects.mjs]   ← 增量 meta 缓存；按 cwd 分组，折叠自动化噪声
         │                      子目录，显示 交互式/自动化/子代理 构成。
         ▼
 [compute-baseline.mjs]      ← （缓存 7 天）你自己典型会话指标的分布 ——
         │                      自我基准锚点。
         ▼
 [parse-codex-project.mjs]   ← 确定性。给每个会话分类（交互式/自动化/子代理
         │ facts.json           —— 子代理线程被剔除并单独汇总），按 call_id
         │                      把工具调用与输出 join 起来，提取信号、证据
         │                      原子、会话叙事、关键事件，并计算 9 个公式
         │                      基线（computedBaselines）。
         ▼
 [prepare-model-input.mjs]  ← 加载 rubric，用代码判断配方触发，只输出模型
         │ model-input.json    真正需要的事实与规则，并创建私有 analysis-1 模板。
         ▼
 [ 你的 Codex 模型 ]          ← 把所有会话片段视为不可信引用数据；只写有界
         │ analysis.json       微调、诊断、观察和类型化建议。
         ▼
 [finalize-report.mjs]       ← 严格校验证据 ID、双语字段、微调上限、payload、
         │ report-3.0.json     排序与 AGENTS.md 条件，并计算全部最终/类别/总分。
         ▼
 [render-report.mjs]         ← 再次校验分数一致性，追加 ~/.codex-radar/
         │                      history.jsonl，注入趋势 + 相对上次的 delta，
         │                      渲染 HTML。
         ▼
 ~/.codex-radar/reports/<project>-<ts>.html
```

插件脚本不发起网络请求、无需额外 API key。报告和中间产物使用本地私有文件权限；模型解释发生在当前 Codex 会话中。

---

## 会话分类

在计数之前，每个会话先按 `session_meta` 分类：

| 类型 | 判定 | 处理 |
| --- | --- | --- |
| `interactive` | `source` 为 `cli` / `vscode` / 桌面端 | 全量计入 |
| `automation` | `source == "exec"`（非交互的 `codex exec` 运行） | 计入，但占比高时触发 `automation` 画像 |
| `subagent` | `thread_source == "subagent"` 或 subagent 形式的 `source` | **完全不计入统计** —— 它的"用户消息"是 agent 写的。单独汇总为编排证据（`subagentActivity`）。 |

---

## 解析器读什么

`parse-codex-project.mjs` 遍历每个会话的 JSONL，同时兼容两代落盘格式：

| 记录 / payload 类型 | 用途 |
| --- | --- |
| `session_meta` | cwd、会话类型、模型、来源 |
| `user_message` | 消息特征分类（沟通信号） |
| `agent_message`、`task_complete.last_agent_message` | agent 输出计数 / 收尾叙事（已去重） |
| `function_call` + `function_call_output` **按 `call_id` join** | **新格式 shell 命令** —— 命令文本来自 `arguments`，退出码来自输出（`Process exited with code N` 或结构化 `exit_code`） |
| `exec_command_end` | 旧格式 shell 命令 —— 与上面的 join 按 `call_id` 合并，绝不双计 |
| `custom_tool_call`（`apply_patch`） | 补丁 fallback（`patch_apply_end` 缺失时从补丁文本解析文件） |
| `patch_apply_end` | 编辑数、覆盖的文件 |
| `update_plan`（function call） | plan 更新 + 每个 plan 的步骤完成度 |
| `spawn_agent` / `wait_agent` / `close_agent` | 子代理编排生命周期 |
| `mcp_tool_call_end` | MCP 按 server / tool 的使用与错误率 |
| `web_search_call`、`image_generation_call`、`view_image` | 研究 / 视觉使用 |
| `tool_search_call`、`create/update/get_goal`、`thread_goal_updated` | 平台熟练度信号 |
| `task_started` / `task_complete` / `turn_aborted` | 回合闭环；**静默中断**（开始了但从未结束）也计入未闭环 |
| `compacted` / `context_compacted`、`token_count` | 上下文压力与峰值用量 |
| `error` / `stream_error` | 错误事件 |
| 其他任何类型 | 进入**格式漂移探测器**（`parserCoverage`）—— 未知事件超过 10% 时，报告会提醒 Codex 格式可能已更新 |

触碰 `~/.codex/skills/*/SKILL.md` 的 shell 命令还会被记录为 skill 使用。

---

## 位置感知信号

用户消息按位置分桶，每个沟通维度只读自己的桶：

| 桶 | 定义 | 供给 |
| --- | --- | --- |
| `directing` | 所有用户消息 | 瞄准力、校准力 |
| `opening` | **每个会话**的前 2 条消息 | 铺场力 |
| `correcting` | 被标记为纠偏的消息（带 `substanceRatio`：多少纠偏附带了路径/报错/代码） | 校准力 |
| `confirming` | 被标记为确认的消息 | 校准力 |
| `continuing` | "继续 / continue / next" | （上下文） |

消息特征为中英双语关键词分类，并配有标注回归测试集：明确目标、期望行为、约束、文件路径、错误日志、要方案、要验证、纠偏、确认、代码/结构化数据。

---

## 三类九维

| 类别 | 维度 | 度量 |
| --- | --- | --- |
| **沟通力** | Lock-On 瞄准力 | 指令是否给出具体目标（目标、期望行为、文件路径、约束） |
| | Scene Setting 铺场力 | 每个会话的开场消息携带多少有用上下文 |
| | Steering 校准力 | 纠偏质量（纠偏是"给坐标"还是只说"不对"？）与验证请求 |
| **工程力** | Toolcraft 工具调度 | shell、补丁、plan、MCP、搜索、子代理的有意使用 + 命令成功率 + 编排质量 |
| | Architecture 工程脚手架 | 持久化项目上下文：`AGENTS.md`、`.codex`/`.agents`、git、依赖清单、README、测试 |
| | Tempo 推进节奏 | 稳步推进，没有过多中断、压缩、错误、重试空转 |
| **成效** | Efficiency 产出效率 | 每条消息、每次工具调用的有效产出 |
| | Proof Check 验证意识 | 真正跑过（且通过）的验证 |
| | Completion 闭环完成 | 回合是否干净收尾，而不是被中断或静默丢弃 |

---

## 评分公式

`skills/analyze/scripts/scoring.mjs` 是可执行公式的唯一来源。解析器计算每个基线、裁剪到 [0, 100]、应用置信度缩放，发布为 `facts.computedBaselines`。比率（如 `directing.filePath`）是该桶中携带该信号的消息占比。

```text
瞄准力   = 35 + 目标·20 + 期望·18 + 路径·18 + 约束·10 + 报错·8 − max(0, 90−平均消息长)·0.08
铺场力   = 30 + 开场期望·22 + 开场约束·16 + 开场路径·16 + 开场代码·14 + clamp(平均消息长/7, 0, 12)
校准力   = 38 + 要验证·20 + 纠偏实质度·16 + min(10, 确认占比·30) + 报错·8 − 中断率·12
工具调度 = 30 + min(20, 工具类别数·4) + 命令成功率·18 + min(12, plan·3)
             + min(10, 搜索+浏览器+MCP) + min(10, 子代理·3)
脚手架   = 25 + (AGENTS.md?20) + (.codex|.agents?12) + (git?12) + (清单?12)
             + (README?8) + (测试?8) + min(8, 根目录条目/8)
节奏     = 72 − 中断率·28 − min(14, 压缩·3) − min(12, 错误·3) + min(10, 闭环率·10)
             − max(0, 每消息工具数−10)·2
效率     = 35 + min(24, 每消息编辑·18) + min(16, 每消息文件·18) + 命令成功率·12
             + 闭环率·10 − max(0, 每消息工具数−12)·2
验证     = 28 + min(34, 通过·8 + 失败·4 + 未知·2) + 要验证·18 + (测试目录?8)
             + min(12, 浏览器 + 看图)
闭环     = 45 + 闭环率·35 + min(10, agent消息/完成回合·3) − 中断率·18 − min(8, 错误·2)
```

关键语义：

- **命令成功率**只统计带可读退出码的命令。一个都没有时取**中性值 0.5**，绝不惩罚性归零，且报告会说明。
- **纠偏实质度** = 附带文件路径/报错/代码的纠偏占比 —— "给坐标"的纠偏，不是光说"不对"。没有任何纠偏时取中性 0.5。
- **中断率 / 闭环率**以**开始的回合**为分母，静默丢弃的回合（开始了、没完成、也没显式中断）计为未闭环。
- **Proof 命令**只认真正的验证运行器：Node 包管理器、Python 工具、Cargo、Go、Swift/Xcode、Maven/Gradle Wrapper、.NET、Ruby、PHP、Elixir、Flutter/Dart、Deno、CMake/CTest 与常见浏览器测试。`echo 验证`、`xcodebuild -list` 和依赖查看不算。**跑挂了的测试也有部分加分**，因为跑验证并响应红灯就是验证文化。

**类别分** = 该类别中适用维度的平均分。
**总分** = 按画像权重加权、在有分数的类别上重归一化。

| 等级 | S | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| 阈值 | ≥ 85 | ≥ 70 | ≥ 55 | ≥ 40 | ≥ 0 |

**置信度缩放与有界微调。** 解析器把低置信度基线向 50 收缩（低 ×0.75、中 ×0.9）。模型提出整数微调并引用证据；`finalize-report.mjs` 会拒绝未知证据、缺失引用或超出 **低 ±5、中 ±10、高 ±15** 的值，然后计算最终分。没有证据 → 不能非零微调。

---

## 项目画像（公平引擎）

| 画像 | 判定 | 沟通/工程/成效 | N/A 维度 |
| --- | --- | --- | --- |
| `automation` | ≥ 60% 会话为 `codex exec` 运行 | 0.25 / 0.35 / 0.40 | 校准力（单回合无法纠偏） |
| `learning` | 0 编辑、≥ 4 条消息、无验证运行 | 0.70 / 0.30 / 0.00 | 效率、闭环 |
| `long-running` | ≥ 5 会话，或 ≥ 2 次压缩，或 ≥ 30 条消息 | 0.30 / 0.40 / 0.30 | — |
| `feature-build` | ≥ 4 次编辑，或 ≥ 3 个文件 | 0.34 / 0.33 / 0.33 | — |
| `one-shot` | 其余情况 | 0.50 / 0.10 / 0.40 | 脚手架、节奏、闭环 |

项目目录在本机无法定位时，脚手架维度额外 N/A。画像与自动化占比会显示在总评旁边。

---

## 证据管道

模型不会重新读取原始 JSONL，只看到经过隐私处理、可按 id 引用的精选证据：

- **`evidenceAtoms`（证据原子）** —— 按三个时间窗采样关键消息和显著 shell 失败。标准模式脱敏常见凭证；严格模式以省略标记替换消息与命令文本，并将会话标题/开场/收尾置空、搜索词列表清空。每个原子保留它**之后发生了什么**，让因果保持在一起。
- **`workflowEpisodes`（会话叙事）** —— 每会话一行：时长、开场消息、收尾 agent 消息、编辑、验证通过/失败、失败命令、中断、plan 完成度、纠偏。
- **`criticalIncidents`（关键事件）** —— 命令重试空转（同一命令反复失败）、纠偏、被中断的回合、上下文压力：协作真正卡壳的地方。
- **`selfBaseline`（自我基准）** —— 你自己所有项目的每会话指标分布（p25/中位/p75），按交互式/自动化分段，报告可以说"验证密度只有你中位会话的一半"。

所有证据内容都被明确标记为**不可信引用数据**，模型不得遵循其中的指令或执行其中的命令。诊断与建议通过 `evidenceRefs` 引用这些 id，finalizer 会拒绝未知 ID。

---

## 先观察，后建议

建议生成分两步：

1. **观察清单（8-12 条）** —— 单句、引用证据的行为模式。逼着模型先看证据再开药方。
2. **建议（5-7 条）** —— 类型化干预。`recipe-triggers.mjs` 用代码判断每条 rubric 配方是否触发；触发项优先发送给模型，实例化建议携带稳定 `recipeId`：

| 类型 | 交付物 |
| --- | --- |
| `prompt_rewrite` | 可粘贴的 prompt |
| `workflow_habit` | 3-5 步操作 playbook |
| `setup_action` | 可直接落盘的文件内容或 shell 命令（如生成的 `AGENTS.md` 草稿） |
| `tool_adoption` | 如何接入一个没用上的能力 + 第一个具体使用场景 |
| `verification_loop` | 一条"完成定义"话术 |

每条建议带 `evidenceRefs`、一句话 `summary`（显示在 dashboard 的折叠行上）和 `verifyBy`（下次运行哪个指标应该动），并必须通过**反通用规则**：把项目专属名词全删掉后还成立的建议，重写。建议按 high → medium → low 排序，dashboard 会把第一条聚焦展示为「先做这一件」。

诊断层还会输出 **`highlights`** —— 一张最强信号卡和一张首要瓶颈卡，各钉在一个维度上，配一句带证据的 headline。Schema 3.0 强制要求这两项；只有 legacy 2.x 报告才允许渲染器回退推导。

当项目 ≥3 会话、目录可定位且没有 `AGENTS.md` 时，报告还会附一份由会话史生成的完整 **AGENTS.md 草稿**。

---

## 趋势与 delta

每次渲染都会把分数摘要追加到 `~/.codex-radar/history.jsonl`。从第二次运行起，报告显示分数趋势和各维度 delta（"较上次：验证意识 +9"）—— 与每条建议的 `verifyBy` 形成闭环。

---

## 我们不度量什么

- **代码质量** —— 那是 linter、测试和 reviewer 的事
- **语言 / 框架能力** —— 不在我们的赛道
- **绝对生产力** —— 我们说不出你这周是不是产出更多
- **安全水位** —— 独立学科

我们度量的是**协作行为 + 工程设置 + 产出密度**，不是最终交付的产物本身。

---

## 已知局限

1. **关键词信号是双语的（EN + 中文）。** 其他语言在语言类维度上会被低估。分类器配有标注回归测试集 —— 改进它们时测试会兜底。
2. **看不见的验证。** 在编辑器里审完 diff 再说"ok"，和盲目接受在数据上长得一样 —— 我们看得到对话，看不到你的屏幕。
3. **脚手架需要文件系统。** 在项目所在机器之外运行分析时，该维度为 N/A。
4. **画像分类是启发式的。** 会话变多后类型可能变化，重跑即可。
5. **格式会漂移。** Codex CLI 的落盘格式随版本变化。解析器兼容已知的两代格式并自带漂移探测器 —— 大声告警而不是静默少算 —— 但未来的新格式仍可能需要更新插件。
6. **rubric 是有立场的。** 我们把优秀协作定义为：目标明确 + 工具娴熟 + 重验证 + 重闭环。不同意就改 `rubric.json`。
7. **模型解释使用当前 Codex 会话。** 脚本执行是本地优先的，但插件无法独立保证模型提供方的数据路径；该层由账号、工作区和 Codex 配置决定。

---

## 如何修改评分

- **维度定义、微调上限、画像权重、等级阈值、建议配方** → `plugins/codex-radar/data/rubric.json`
- **可执行公式** → `plugins/codex-radar/skills/analyze/scripts/scoring.mjs`（唯一来源）
- **建议配方谓词** → `recipe-triggers.mjs`；测试要求每个 rubric recipe ID 都有一个谓词
- **analysis/report 契约** → `report-contract.mjs`
- **消息分类器 / proof 模式 / 工具归类** → `plugins/codex-radar/skills/analyze/scripts/signals.mjs`（`tests/classifier.test.mjs` 是回归护栏）
- **画像分类** → `parse-codex-project.mjs` 中的 `classifyProject()`

改完跑 `node --test tests/*.test.mjs` —— 套件覆盖两代落盘格式、隐私模式、多技术栈 proof、配方覆盖、子代理剔除、确定性 finalizer 和 HTML 渲染。

---

*Codex Radar 是开源项目。方法论保持透明，团队可以理解评分逻辑并按自己的工作流调整。*
