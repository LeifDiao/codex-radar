[English](./METHODOLOGY.md)

# Codex Radar — 方法论

> Codex Radar 关注的不是代码产出，而是*你怎么把 Codex 当成一个平台来协作* —— 你的沟通、你的工程设置、你真实的成效。
>
> 这份文档是公开的评分规范。报告里的每个数字都能追溯到这里的某个公式，而每个公式都读取解析器从你真实 Codex 会话里提取出的信号。

---

## 设计原则

1. **证据优先。** 每个分数都能追溯到具体、可计数的会话信号。
2. **可复现的输入，透明的 rubric。** 解析器是确定性的 —— 同样的会话，同样的事实。然后由你的 Codex 模型对照公开 rubric 打分（公式基线 + 引用证据的微调），所以每个数字都能追溯到一个公式和真实证据。
3. **隐私不可妥协。** 会话数据留在本地。无云端、无额外 API key、无遥测 —— 分析跑在你自己的 Codex 会话里。
4. **N/A 是诚实。** 当某维度确实无法评估时，显示 N/A —— 绝不假装一个 50 分。
5. **按画像公平。** 不同项目类型应当用不同的类别权重。
6. **透明。** rubric 和公式都在仓库里。改了它们，下一次运行就反映你的标准。

---

## 工作原理

```
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
~/.codex/session_index.jsonl
         │
         ▼
 [list-codex-projects.mjs]   ← 按 cwd 分组会话，匹配你的当前目录。
         │
         ▼
 [parse-codex-project.mjs]   ← 确定性。把可计数的信号提取成
         │ facts.json           facts.json。这里不评分。
         ▼
 [ 你的 Codex 模型 ]          ← 读取 facts + rubric.json。给 9 个维度打分
         │ report.json          （公式基线 + ±15 证据微调），并撰写诊断 + 建议。
         ▼
 [render-report.mjs]         ← 纯转换。report.json → 单文件 HTML。
         │
         ▼
 ~/.codex-radar/reports/<project>-<ts>.html
```

四个阶段。确定性解析器产出事实；你的 Codex 模型把事实 + rubric 变成打好分的报告；渲染器生成 HTML。下判断的，就是你正在用的那个 Codex 模型。

插件本身不发任何网络请求，也不需要额外的 API key —— 评分跑在你自己的 Codex 会话里，报告留在你的机器上。

---

## 解析器读取什么

`parse-codex-project.mjs` 遍历每个会话的 JSONL，统计真实的 Codex 记录类型：

| 记录 / payload 类型 | 用于 |
| --- | --- |
| `session_meta` | cwd、会话 id、模型提供方、来源 |
| `user_message` | 消息分类（沟通类信号） |
| `agent_message`、`task_complete.last_agent_message` | 用户可见的 agent 输出、完成情况 |
| `function_call`、`custom_tool_call` | 按类别统计工具调用 |
| `exec_command_end` | shell 命令文本 + 退出码 + 验证检测 |
| `patch_apply_end` | `apply_patch` 编辑、触及的不同文件 |
| `web_search_call`、`image_generation_call`、`view_image_tool_call` | 搜索 / 视觉工具使用 |
| `mcp_tool_call_end` | MCP 服务使用 |
| `collab_agent_spawn_end` | 子代理生成 |
| `update_plan`（function call） | plan 更新 |
| `task_started` / `task_complete` / `turn_aborted` | 回合完成 vs 中断（Tempo、Completion） |
| `compacted` / `context_compacted` | 上下文压力 |
| `error` | 错误事件 |

每条用户消息还会被特征分类（中英双语关键词匹配）成：明确目标、期望行为、约束、文件路径、错误日志、要求出方案、要求验证、纠正、确认、代码/结构化数据。

---

## 位置感知信号

在计数之前，用户消息按位置分桶，每个沟通维度只读取自己的桶：

| 桶 | 定义 | 服务于 |
| --- | --- | --- |
| `directing` | 所有用户消息 | Lock-On、Steering |
| `opening` | 会话的前 2 条消息 | Scene Setting |
| `correcting` | 被标记为纠正的消息 | Steering |
| `confirming` | 被标记为确认的消息 | Steering |
| `continuing` | "继续 / continue / next" 类消息 | （上下文） |

---

## 三大类、九个维度

| 类别 | 维度 | 衡量什么 |
| --- | --- | --- |
| **沟通力** | Lock-On 瞄准力 | 指令是否给了 Codex 具体目标（目标、期望行为、文件路径、约束） |
| | Scene Setting 铺场力 | 开场消息提供了多少有用上下文 |
| | Steering 校准力 | 过程中纠偏和验证请求的质量 |
| **工程力** | Toolcraft 工具调度 | 对 shell、补丁、plan、MCP、搜索、图像、子代理的有意使用 + 命令成功率 |
| | Architecture 工程脚手架 | 持久化的项目上下文：`AGENTS.md`、`.codex`/`.agents`、git、依赖清单、README、测试 |
| | Tempo 推进节奏 | 是否稳步推进，没有过多中断、压缩、错误或工具空转 |
| **成效** | Efficiency 产出效率 | 每条人类消息、每次工具调用产出的有效工作 |
| | Proof Check 验证意识 | 测试、构建、lint、截图、渲染和显式验证 |
| | Completion 闭环完成 | 回合是否干净收尾，而不是停在半途 |

---

## 评分公式

每个维度都有一个**基线公式**，由模型从事实里算出并夹到 [0, 100]；随后模型再做置信度缩放和有界的 ±15 引用证据微调（见下）。比率（如 `directing.filePath`）是该桶中携带该信号的消息占比；`commandSuccessRate` 是退出码为 0 的命令占所有带退出码命令的比例。

```text
Lock-On       = 35 + 目标·20 + 期望·18 + 文件路径·18 + 约束·10 + 错误日志·8
                   − max(0, 90 − 平均消息长度)·0.08
Scene Setting = 30 + opening.期望·22 + opening.约束·16 + opening.文件路径·16
                   + opening.代码数据·14 + clamp(平均消息长度/7, 0, 12)
Steering      = 38 + 要求验证·20 + 纠正·16 + 确认·10 + 错误日志·8 − 中断率·12
Toolcraft     = 30 + min(20, 工具类别数·4) + 命令成功率·18
                   + min(12, plan更新·3) + min(10, 搜索+浏览+mcp) + min(10, 子代理·3)
Architecture  = 25 + (AGENTS.md?20) + (.codex|.agents?12) + (git?12) + (依赖清单?12)
                   + (README?8) + (测试?8) + min(8, 根目录条目/8)
Tempo         = 72 − 中断率·28 − min(14, 压缩·3) − min(12, 错误·3)
                   + min(10, 干净收尾率·10) − max(0, 每条消息工具数 − 10)·2
Efficiency    = 35 + min(24, 每条消息编辑·18) + min(16, 每条消息文件·18)
                   + 命令成功率·12 + 干净收尾率·10 − max(0, 每条消息工具数 − 12)·2
Proof Check   = 28 + min(34, 验证命令·8) + 要求验证·18 + (测试?8) + min(12, 浏览+图像)
Completion    = 45 + 干净收尾率·35 + min(10, agent消息/完成回合·3)
                   − 中断率·18 − min(8, 错误·2)
```

**验证命令**按模式识别：`npm/pnpm/yarn/bun (test|build|check|lint|typecheck)`、`pytest / ruff / mypy / cargo test|check / go test / swift test / xcodebuild / playwright / vitest / jest / tsc`，以及 `screenshot / render / validate / doctor / 检查 / 验证`。

**类别分** = 该类别中*可用*维度的均值。
**总分** = 按画像权重的类别加权和，并在有分数的类别上重新归一化。

| 等级 | S | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| 阈值 | ≥ 85 | ≥ 70 | ≥ 55 | ≥ 40 | ≥ 0 |

**置信度缩放 + 微调。** 算出基线后，模型会把低置信度的分数往 50 收（低 ×0.75、中 ×0.9、高 ×1.0），再做一个有界的 **±15 微调**，且必须引用你真实消息里的具体证据（`keyMessages` / `sampleExchanges` / `sessionFlows`）。没有证据就不微调。

---

## 项目画像（公平引擎）

每个项目自动归类，分类决定类别权重：

| 画像 | 判定 | comm / eng / out |
| --- | --- | --- |
| `long-running` 长期 | ≥ 5 个会话，或 ≥ 2 次压缩，或 ≥ 30 条消息 | 0.30 / 0.40 / 0.30 |
| `feature-build` 功能开发 | ≥ 4 次文件编辑，或触及 ≥ 3 个不同文件 | 0.34 / 0.33 / 0.33 |
| `learning` 学习探索 | 0 次文件编辑 且 ≥ 4 条消息 | 0.70 / 0.30 / 0.00 |
| `one-shot` 一次性 | 其余情况（消息少、编辑少） | 0.50 / 0.10 / 0.40 |

**N/A 处理：** 当记录的项目目录在本机无法定位时，Architecture 标记为 N/A —— 没有目录就无法做文件系统检查。部分维度还会按项目类型置为 N/A：`one-shot` 不计 Architecture、Tempo、Completion；`learning` 不计 Efficiency、Completion（这些项目类型不适用收尾/效率语义）。此时类别分只对可用维度取均值，总分权重重新归一化。

画像会显示在总评等级旁边，这样一次性修复拿到的 "B" 不会被当成长期项目的 "B"。

---

## 诊断与建议

两者都由你的 Codex 模型，根据已评分的维度和事实**撰写**：

- **Insight** —— 一句生动的双语主标题（教练式的当头棒喝，常是「强 X 但弱 Y」这种张力）。
- **诊断** —— 一段自由格式的协作画像（120-180 字）、一段核心解读（最强项 + 最关键瓶颈，附证据和瓶颈的具体代价），以及一段维度交叉解读。是可观察的行为，不是人格标签。
- **建议** —— 最少 5 条、最多 7 条可粘贴的改写 prompt，每条标注所属维度和预期影响区间。对高分用户，用进阶动作替代纠错。

每条结论都必须引用你真实会话里的证据 —— `keyMessages`、`sampleExchanges`、`sessionFlows`，或工具/产出的汇总数据。全程中英对齐。

---

## 我们不衡量什么

- **代码质量** —— 那是 linter、测试和 reviewer 的活
- **语言 / 框架熟练度** —— 不在我们的范围
- **绝对生产力** —— 我们说不出你这周是不是产出更多
- **安全态势** —— 那是另一门学科

我们衡量的是**协作行为 + 工程设置 + 产出密度**，不是最终交付的成品。

---

## 已知局限

1. **关键词信号是中英双语的。** 其他语言在语言类维度上会被低估。
2. **看不见的验证。** 在编辑器里看完 diff 再说 "ok"，看起来和盲目接受一样 —— 我们看到的是对话，不是你的屏幕。
3. **Architecture 需要文件系统访问。** 在和项目所在机器不同的机器上分析，Architecture 会变成 N/A。
4. **画像分类是启发式的。** 4 个会话的原型可能被读成 `feature-build`。类型变了就在更多会话后重跑。
5. **rubric 是有立场的。** 我们把强协作定义为目标明确 + 工具熟练 + 重验证 + 重收尾。如果团队不认同，就去调 `rubric.json` 和公式。

---

## 如何修改评分

- **维度定义、画像权重、等级阈值** → `plugins/codex-radar/data/rubric.json`
- **公式本身** → `plugins/codex-radar/data/rubric.json` 中每个维度的 `baselineFormula`（解析器只提取事实，公式由你的 Codex 模型计算）
- **画像分类** → 同一文件里的 `classifyProject()`
- **验证命令模式** → 同一文件里的 `isProofCommand()`

无需编译 —— 解析器每次运行都会重新读取 rubric。

---

*Codex Radar 开源。方法论保持透明，方便团队理解评分逻辑并按自己的工作流调整。*
