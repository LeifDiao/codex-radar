# Codex Radar — 独立评审与迭代计划

> 评审日期：2026-07-06。方法：通读全部源码（parser / rubric / SKILL / renderer）＋ 在本机 11,363 个真实 Codex 会话文件上做分层抽样验证 ＋ 实际跑通 pipeline 复现问题 ＋ Codex 独立交叉评审。
> 所有 P0 结论都在真实数据上复现过，不是推测。

> **✅ 实施状态（2026-07-07）：M1–M4 已全部落地并通过验收。**
> 28/28 fixture 测试全绿（`node --test tests/*.test.mjs`）；「Lemo Story」实测 shellCommandCount 0→1978、成功率 0.954、正确识别为 automation 画像；「early-education」全链路（parse → 报告 → 渲染）产出真实报告，41 spawn/9 未回收、重试空转 ×5、proof=0 等诊断素材全部可用。插件版本 bump 至 1.1.0，文档（README ×2 / METHODOLOGY ×2 / PRIVACY）已同步。
> 「留作设计讨论」清单中已顺手实施：低置信度收紧微调幅度（M1-1.8）、oversized 行保留 name 字段；仍开放：N/A 改降权、Architecture 实质性检查、profile 多标签。

---

## 一、总评

架构方向是对的：**确定性解析器出 facts → 模型对照公开 rubric 打分写诊断 → 纯渲染**，三段分离、全本地、rubric 透明，这个骨架值得保留。

但当前版本有两类根本问题：

1. **解析层已经和新版 Codex 的落盘格式脱节**（2026-06 起），导致 Engineering / Outcome 两大类的核心信号（shell 命令、退出码、proof 命令）在新会话上**全部为零**。模型拿着空数据打分，报告必然失真。
2. **"建议浅"不是 prompt 没写好，而是结构性的**：喂给模型的证据太薄（12 条同一时刻的消息截断片段）、建议 schema 把所有建议压成"改写一句 prompt"、正文限制 1-2 句话。模型没有原材料、也没有输出空间，写不深是必然结果。

---

## 二、问题清单（按严重程度）

### P0 — 正确性：新版 Codex 上数据失真

#### P0-1 `exec_command_end` 事件在新版 Codex 中已不再落盘 ⚠️ 最严重

- **现象**：分层抽样 627 个会话，`function_call(exec_command)` 出现 3,290 次，但 `exec_command_end` 只有 475 次；按月切分后确认是版本漂移——2026-04 两者 1:1，**2026-06 起 `exec_command_end` 归零**。
- **实测后果**（项目「Lemo Story」，195 会话，2026-06-29）：2,013 次 shell 调用，但 facts 里 `shellCommandCount: 0`、`commandSuccessRate: 0`、`proofCommands: 0`。Proof Check 基线只剩 `28 + asksVerify×18`，Toolcraft 丢掉 18 分权重项，Efficiency 丢 12 分权重项。
- **修法**：以 `function_call` / `function_call_output` 按 `call_id` join 为**主路径**：
  - 命令文本从 `function_call.arguments` 解析（JSON，`{"cmd": "...", "workdir": "..."}`）；
  - 退出码从 `function_call_output.output` 文本用正则恢复（实测格式为 `Process exited with code N`）；
  - 保留 `exec_command_end` 作为旧版本 fallback（同一 call_id 去重，避免双计）。
- **文件**：`parse-codex-project.mjs`（新增 pending-call join 逻辑）。

#### P0-2 `opening` 信号桶是"全项目前 2 条消息"，不是"每会话前 2 条"

- **代码**：`addHumanMessage` 里 `message.index` 是跨会话全局累加的（`state.humanMessages.length`），`if (message.index < 2)` 只会命中整个项目最早的 2 条消息。
- **实测**：195 会话的项目，`signalsByPosition.opening.messageCount === 2`。Scene Setting（铺场力）整个维度实际上只看了 2 条消息。
- **修法**：per-session 消息序号（在 `parseSession` 里维护 `session.humanMessages` 已有计数，用它判断 `< 2`）。

#### P0-3 子代理会话与 `codex exec` 自动化会话污染项目统计

- **现象**：`session_meta` 带有 `thread_source: "subagent"`、`source: {subagent: {...}}`、`parent_thread_id` 的子代理会话（以及 guardian 审计会话）与父项目共享 cwd，被当成普通会话计入。这些会话的 `user_message` 是**agent 写的 prompt**，不是用户说的话——直接污染全部沟通力维度。
- **连带问题**：`codex exec` 批量自动化（如生图流水线）195 个单消息会话被判成「长期项目 · 高置信度」，`cleanEndRatio = 1`、`turnAborts = 0` 让 Completion/Tempo 虚高。抽样最近 3000 个会话，`source: "exec"` 占 2,979 个。
- **修法**：
  - 解析时按 `thread_source` / `source` / `originator` 给会话打 `sessionKind`（interactive / exec-automation / subagent）；
  - **子代理会话默认不计入沟通力与 outcome 统计**，但作为父项目「多代理编排」的证据单独汇总（spawn 了几个、什么 role、是否有 wait/close 闭环）；
  - exec 自动化会话单列一档 profile（如 `automation`），不与交互式协作混在一起打分，报告里明示"本项目 X% 为自动化运行"。
- **文件**：`parse-codex-project.mjs`、`rubric.json`（profiles 增加 automation）、`list-codex-projects.mjs`（列表也应显示会话构成）。

#### P0-4 计数 bug 若干

| bug | 位置 | 影响 |
| --- | --- | --- |
| `collab_agent_spawn_end` 分支先 `subagentCalls += 1`，随后 `addToolCall("spawn_agent")` 内部再 `+= 1` → 每个事件双计；若同一 spawn 的 `function_call` 也落盘则三计 | `parse-codex-project.mjs` | Toolcraft 子代理加分虚高 |
| `agent_message` 事件与 `task_complete.last_agent_message` 都 push 进 `agentMessages` → 每个完成回合重复一条（实测 1391 = 1196 + 195） | 同上 | Completion 公式的 `agentMsgs/turnCompletes` 虚高 |
| `view_image_tool_call` 在新版数据中不存在（实际是 `function_call: view_image`），`browserCalls` 永远为 0；`image_generation_end`、`web_search_end`、`tool_search_call` 等新事件类型未识别 | 同上 | Proof Check 的 browser/image 加分项失效 |
| 分类与计数两套逻辑不一致：`categorizeTool()` 按名字归类（byCategory 能看到 research/browser 工具），但公式用的 `webSearchCalls/browserCalls/mcpCalls` 等专用计数器只在少数 event-type 分支里递增 → byCategory 与公式输入互相矛盾 | 同上 | 公式系统性低估高级工具使用；应在 `addToolCall()` 统一维护 per-category 计数器 |
| 静默中断未计：`task_started - task_complete - turn_aborted` 的差值（会话中途死掉/被关）没有进 abortRatio | 同上 | Tempo/Completion 偏乐观 |
| MCP 只数次数，`mcp_tool_call_end.invocation.server/tool`、`result.Ok/Err`、`duration` 全部丢弃 | 同上 | 场景覆盖缺口，见 P2 |

#### P0-5 基线公式由模型"心算"，违背自己的确定性承诺

README/METHODOLOGY 承诺 "formula baseline 确定性可复现"，但公式实际是让 Codex 模型读 rubric 字符串后手算——LLM 算术随时可能悄悄出错，同一份 facts 两次跑分可能不同。

- **修法**：把 9 条 baselineFormula 实现进解析器（或一个极小的公式求值器），facts 里直接输出 `computedBaselines`，模型只负责 ±15 证据微调 + 全部文字内容。rubric.json 中的公式文本保留为文档，加一个测试断言代码实现与文本一致。
- **收益**：真正可复现 + SKILL prompt 显著变短 + 模型注意力全部留给诊断和建议（正好服务痛点 #1）。

---

### P1 — 建议深度（你的核心痛点）

"建议浅"的四个根因，对应四组措施：

#### 根因 1：证据饥饿 —— 模型只拿到 ~2KB 最早期的碎片

实测：`keyMessages` 12 条全部来自**同一秒**（最早会话的开头），`sampleExchanges` 就是最早 8 条消息，各截断 220 字符。失败现场、纠偏过程、后期演化全都不在模型视野里。

**措施 A：证据管道 v2（`parse-codex-project.mjs`）**

统一的数据形态（Codex 交叉评审与我方案收敛后的命名）：facts 新增 **`evidenceAtoms[]`**（每条带 `id/sessionId/timestamp/role/snippet/features/toolCallsAfter/editsAfter/proofAfter`）和 **`workflowEpisodes[]`**（每会话一条 `goal → plan → tool/edit → verify → close/abort` 的叙事链）。建议必须通过 `evidenceRefs[]` 引用 atom id——证据从"一段描述文字"变成可点击、可核验的引用。

1. **关键事件（critical incidents）抽取**——这是最大的杠杆。围绕"出事的地方"采样证据链：
   - 连续失败的 shell 命令簇（同一命令重试 ≥2 次）→ 记录命令文本、退出码、前后的用户消息；
   - 纠偏消息（correction）→ 带上它纠的是什么（前一条 agent 动作摘要）；
   - `turn_aborted` / 静默中断 → 中断前用户在做什么；
   - 上下文压缩事件前后的行为变化。
2. **时间分层采样**：keyMessages 从"前 12 条命中"改为跨时间窗口分层采样（早期/中期/近期各取若干，优先 correction、errorLog、长消息、含代码块的消息），上限提到 ~30 条、单条 400 字符。
3. **会话叙事摘要**：`sessionFlows` 从纯计数升级为每会话一行叙事素材：thread name＋首条用户消息（截断）＋持续时长（首尾 timestamp 差，目前完全没有时长概念）＋编辑数/proof 数/失败命令数＋最后一条 agent 消息（截断，反映收尾质量）。
4. **失败证据直给**：`failedCommands[]`（命令文本+退出码+重复次数 top 10）、`retryChurn`（同命令重试统计）。

**措施 B：建议生成两段式（SKILL.md Step 7 重写）**

先让模型列"观察清单"（8-12 条，每条必须引用具体 incident/消息/指标），再从中挑 5-7 条升级成建议。防止模型跳过证据直接套模板。

#### 根因 2：建议 schema 把深度锁死在"改一句 prompt"

`promptRewrite` 是必填字段、body 限 1-2 句、title 限 18 字符——结构上就只容得下"prompt 措辞技巧"这一种建议。真正值钱的建议往往是**工作流层面**的（建 AGENTS.md、加验证闭环、该用 plan 模式、该把研究派给子代理、该接某个 MCP）。

**措施 C：建议规范 v2（rubric.json `suggestions` 重写）**

每条建议增加 `type` 字段，按类型给不同的 payload：

| type | 交付物 | 例子 |
| --- | --- | --- |
| `prompt_rewrite` | 可粘贴 prompt（保留现有形态） | 现状 |
| `workflow_habit` | 3-5 步 playbook（`steps[]` 字段） | "多文件任务先要 plan：① 让 Codex 先 update_plan ② 审一遍步骤 ③ 每步完成要求贴 diff 摘要" |
| `setup_action` | 可直接落盘的文件内容或 shell 命令（`snippet` 字段） | 一段针对该项目定制的 AGENTS.md 草稿、`mkdir tests && ...` |
| `tool_adoption` | 具体工具+接入方式+第一个使用场景 | "你每周手查 N 次文档 → 接 web_search/某 MCP，下次这样触发……" |
| `verification_loop` | 一条"完成定义"话术+对应的 proof 命令 | "每次改完让 Codex 跑 `npm test` 并贴结果再收工" |

通用约束（写进 rubric）：
- **反通用规则**：禁止"放到任何用户身上都成立"的建议；每条必须通过 `evidenceRefs` 引用 ≥2 个 evidenceAtom，且必须出现该用户项目里的真实名词（文件名、命令、工具名）——把项目专属名词删掉后仍然成立的建议要求重写。
- **可验证性**：每条建议附 `verifyBy` —— 指向一个 facts 字段（"下次 Radar 运行时 `proofCommands.passed` 应 >0"），让建议闭环可度量。
- `body` 放宽到 2-4 句：现状 → 代价 → 怎么改。

**措施 C+：按维度的建议配方 `suggestionRecipes[]`（Codex 交叉评审提出，采纳）**

现在的 `highScorerFillSources` 是泛化素材池，模型仍要自己发明建议。给每个维度写触发条件明确的配方，例如：

```jsonc
"proof_check": [{
  "trigger": "fileEditCount > 0 && proofCommands.passed == 0",
  "requiredEvidence": ["editedFiles", "nearestDetectedTestCommand"],
  "suggestionType": "verification_loop",
  "promptPattern": "改完后运行 <detected test/build command> 并把结果贴给我再收工"
}],
"toolcraft": [{
  "trigger": "mcpCalls == 0 && (webSearchCalls > N || repeatedDocsAsks)",
  "suggestionType": "tool_adoption",
  "requiredEvidence": ["repeatedSearchTopics"]
}]
```

模型的自由度用在"把配方实例化成这个用户的语言和场景"，而不是从零编建议——深度和稳定性同时提升。

#### 根因 3：关键词分类器噪声大，人人得分相近 → 报告千人一面

`explicitGoal` 的正则（做|生成|fix|检查…）几乎命中所有中文消息；`correction` 匹配任意位置的"不是"；`confirmation` 匹配任何以"好"开头的消息。信号饱和后所有人的 ratio 都挤在高位，基线区分度差，诊断自然只能写套话。

**措施 D**：
- 收紧正则（动词+宾语共现、句首位置约束），对每个 classifier 建一个 30-50 条真实消息的标注小样本回归测试（fixtures 里已有素材）；
- 长期方向：把逐条消息分类也交给模型做（facts 里给原文，rubric 给判据）——但这会牺牲确定性，建议先做正则收紧＋抽样人审，效果不够再升级。

#### 根因 4：没有基准，分数没有语境

用户看到 "Lock-On 72" 不知道这算好算坏，模型写建议也没有参照系。

**措施 E：自我基准（完全本地，无需外部数据）**——你本机就有 319 个项目。增加一个轻量 `--baseline` 汇总（可缓存）：对用户全部项目算各信号分布（中位数/四分位），facts 里附 `selfBaseline`。报告与建议都能说"这个项目的 proof 密度只有你自己中位项目的 1/3"——个性化、可信、还是隐私安全的。

---

### P2 — 现代 Codex 场景覆盖（workflow / MCP / 多代理 / goals / skills）

当前 Toolcraft 把所有高级用法压成 5 个计数器。真实数据里可挖的信号：

| 场景 | 数据源（已验证存在） | 建议的信号 |
| --- | --- | --- |
| **MCP** | `mcp_tool_call_end.invocation.{server,tool}`、`result.Ok/Err`、`duration`；新版需确认 function_call fallback | 每 server/tool 的调用数与错误率；报告"工具版图"展示接了哪些 server、哪些在浪费 |
| **多代理编排** | `function_call: spawn_agent/wait_agent/close_agent`（151/108/134 次）、子代理会话的 `agent_role`/`agent_nickname`、`parent_thread_id` | 编排闭环质量：spawn 后是否 wait/close（泄漏检测）、并行度、子代理产出是否被采纳（父会话后续是否引用） |
| **Plan 工作流** | `update_plan`（86 次）＋ plan 参数里的步骤内容 | 不只数次数：plan 的步骤完成率（后续 update 中 completed 状态比例）→ "计划依从度" |
| **Goals** | `create_goal/update_goal/get_goal`、`thread_goal_updated`（101 次） | 长期目标使用；long_running 项目的加分信号 |
| **Web 研究** | `web_search_call`（2,582 次）＋ `search_openai_docs/fetch_openai_doc` | 已计数，但可加"研究→行动"转化：搜索后是否紧跟编辑/命令 |
| **动态工具发现** | `tool_search_call`、session_meta `dynamic_tools` | 平台熟练度证据（facts 已采 dynamicTools 但 rubric 完全没用它） |
| **浏览器/REPL** | node_repl MCP 的 `js` 调用（浏览器自动化实际走这里）、`view_image` | 修正 browserCalls 永远为 0 的问题 |
| **Skills** | 需探明落盘形态（user_message 注入 or base_instructions） | 至少检测"使用了哪些 skill"，作为 Toolcraft 证据 |
| **上下文卫生** | `token_count` 事件、`context_compacted`、超长粘贴（oversized 行） | Tempo 的细化信号：上下文膨胀速度、压缩频率 |

原则：**不增加第 10 个维度**（9 维结构是产品资产），这些都作为 Toolcraft/Tempo 的子信号与证据供给，让诊断和建议有的放矢。

---

### P3 — 报告与产品体验

1. **历史趋势**：每次运行把 facts 摘要＋各维度分数 append 到 `~/.codex-radar/history.jsonl`；报告新增"趋势"区（近 N 次雷达图叠加/折线）。第二次运行自动输出 **delta**（"较上次：Proof Check +9，因为你开始跑测试了"）——这是让用户持续回来用的钩子，也把"建议→改变→验证"闭环做实（配合 P1 的 `verifyBy`）。
2. **AGENTS.md 生成器**：Architecture 建议从"你该建 AGENTS.md"升级为**直接产出一份根据该项目会话史定制的 AGENTS.md 草稿**（项目约定、常用命令、踩过的坑），报告里一键复制。这是"建议可执行化"的标杆特性。
3. **项目列表去噪**：319 个"项目"里大量是自动化批量任务的子目录（每个 cwd 一个会话）。按 git root/公共前缀合并子目录、按 sessionKind 折叠自动化组，列表才可读。
4. **性能与缓存**：`list-codex-projects.mjs` 每次全量扫 11k 文件读 session_meta（本机实测明显变慢）。按文件 mtime 建 `~/.codex-radar/cache/meta.json` 增量缓存；parser 对超大项目（4,640 会话的项目实存在）加 `--since` / 会话数上限＋分层采样。
5. **会话下钻**：报告的 key-messages 表升级为按会话分组的下钻视图（会话叙事摘要 → 展开看关键消息与失败命令）。
6. **report JSON 校验**：renderer 目前对缺字段静默容忍。渲染前按 schema 校验，缺失时给出可读错误（配合 SKILL 的 Error recovery）。

---

### 工程质量（横切）

1. **fixtures 回归测试**（目前 0 测试）：从真实会话脱敏抽取多版本 rollout 样本（含 2026-04 老格式、2026-06 新格式、subagent 会话、exec 会话、oversized 行），对 parser 输出做 golden-file 断言。这是防格式漂移复发的唯一手段，也是开源项目可信度的门面。
2. **格式漂移探测器**：parser 统计未识别的 `payload.type` 并输出到 facts（`parserCoverage: {unknownTypes, knownRatio}`）；当未知比例超阈值，SKILL 提示用户"Codex 格式已更新，请升级插件"。**这条能把下一次 P0-1 式的静默失真变成显式告警。**
3. **CI**：GitHub Actions 跑 fixtures 测试 + lint。

---

## 三、分阶段实施计划

### Milestone 1 — 止血：让分数在新版 Codex 上重新真实（P0 全部）

| # | 任务 | 文件 | 验收标准 |
| --- | --- | --- | --- |
| 1.1 | function_call/output join 恢复 shell 命令与退出码（含旧格式 fallback、call_id 去重） | parse-codex-project.mjs | 「Lemo Story」重跑：shellCommandCount ≈ 2,013，commandSuccessRate ∈ (0,1)，proofCommands > 0 |
| 1.2 | opening 桶改为 per-session 前 2 条 | 同上 | 195 会话项目 opening.messageCount ≈ 390 |
| 1.3 | sessionKind 标注＋子代理剥离＋automation profile | parser + rubric + list 脚本 | subagent 会话不进沟通力统计；exec 批量项目分类为 automation |
| 1.4 | 修 4 个计数 bug（spawn 双计、agent 消息去重、view_image/新事件类型、静默中断） | parser | fixtures 断言各计数正确 |
| 1.5 | 基线公式移入 parser，facts 输出 computedBaselines | parser + SKILL + rubric | 同一 facts 两次打分基线完全一致；SKILL Step 4 大幅简化 |
| 1.6 | fixtures 测试基建＋格式漂移探测器 | 新增 tests/ | `node --test` 全绿；facts 含 parserCoverage |
| 1.7 | Proof 语义收紧：只有 passed 的 proof 命令主要加分；`检查\|验证` 关键词收紧；imageCalls 移出 proof 信号 | parser + rubric | `echo 验证` 不再算 proof；facts 含 proofCommands{total,passed,failed} |
| 1.8 | 低置信度时同步收紧 ±调整幅度（low ±5 / medium ±10 / high ±15） | rubric + SKILL | 与 1.5 一起落地 |

**建议排序**：1.6（测试基建）与 1.1 同时先做——后面所有改动都靠它兜底。

### Milestone 2 — 建议深度（P1，直接回应痛点）

| # | 任务 | 验收标准 |
| --- | --- | --- |
| 2.1 | 证据管道 v2：critical incidents、时间分层 keyMessages（~30 条）、会话叙事摘要＋时长、failedCommands | facts 里证据覆盖首/中/尾时段；每个 incident 带前后文 |
| 2.2 | 建议规范 v2：5 种 type、steps/snippet/verifyBy 字段、反通用规则、body 放宽 | 同一项目重跑，5-7 条建议中 ≥3 条非 prompt_rewrite 类型；每条引用 ≥2 个具体证据 |
| 2.3 | SKILL Step 7 两段式生成（观察清单 → 建议） | 观察清单进 report JSON（可折叠展示），建议均可溯源 |
| 2.4 | 关键词分类器收紧＋标注回归样本 | 标注集 precision ≥ 0.8；各 ratio 分布拉开（不再挤在高位） |
| 2.5 | 自我基准 selfBaseline | 报告出现"相对你自己的中位项目"表述 |
| 2.6 | 模板适配新建议类型（steps 列表、snippet 复制块、verifyBy 徽章） | 五种类型渲染正常，单文件 HTML 不破 |

### Milestone 3 — 场景覆盖（P2）

MCP per-server 版图、编排闭环质量（spawn/wait/close 泄漏检测）、plan 依从度、goals、tool_search、skills 探测、上下文卫生信号；全部作为 Toolcraft/Tempo 子信号＋证据，不加新维度。验收：重度多代理/MCP 用户的报告能说出"你 spawn 了 15 个子代理但 4 个没 close"这种粒度的话。

### Milestone 4 — 产品闭环（P3）

history.jsonl＋趋势区＋delta 对比 → AGENTS.md 生成器 → 项目列表去噪＋meta 缓存 → 会话下钻。验收：第二次运行的报告自动含"较上次变化"；AGENTS.md 草稿可直接落盘使用。

### 依赖关系

```
M1（数据真实）──► M2（建议深度）──► M4（趋势/delta 依赖 M2 的 verifyBy）
        └────────► M3（场景覆盖，可与 M2 并行）
```

M1 不做，M2-M4 都是在失真数据上刷漆。**强烈建议按 M1 → M2 的顺序走，M3 可穿插。**

---

## 四、Codex 独立交叉评审的补充发现

本机 Codex CLI 对同一代码库做了独立评审（未看我方结论）。在 exec 事件漂移、子代理污染、spawn 双计数、公式由模型心算、证据饥饿、建议 schema 限制这六个主要问题上**两边独立收敛**——可视为高置信度结论。以下是 Codex 提出、且已并入上文方案的补充点，以及尚未并入、留作设计讨论的点。

### 已采纳并入上文

1. **`evidenceAtoms[]` + `workflowEpisodes[]` + `evidenceRefs`**（→ 措施 A）：证据从"文本描述"变成可引用、可核验的结构化对象。
2. **按维度 `suggestionRecipes[]`**（→ 措施 C+）：触发条件＋必需证据＋建议类型的配方化，防止模型从零编建议。
3. **Proof 语义收紧**（→ M1 任务 1.7）：`isProofCommand` 的 `检查|验证` 关键词会把 `echo 验证` 也当 proof；proof 只数不看成败；`imageCalls` 也计入 proof 加分——生成插画被算成"验证"。改为 `proofCommands{total,passed,failed,unknown}`，只有 **passed** 的 proof 才主要加分，image generation 移出 proof 信号（保留 screenshot/render 检视类）。
4. **计数器统一**（→ P0-4 表）：`categorizeTool` 与专用计数器两套逻辑合一，避免 byCategory 和公式输入自相矛盾。
5. **report schema 校验＋`parserWarnings` 上屏**（→ P3-6 / 工程质量-2）：模型漏字段目前会静默渲染成空白；报告顶部应显示解析告警。
6. **classifier 交叉污染实例**（→ 措施 D 的测试样本）：`检查` 同时命中 explicitGoal 和 asksVerify；`review` 同时命中 explicitGoal 和 asksPlan；`^对` 会把"对比一下…"当成确认。

### 留作设计讨论（暂不进排期）

1. **N/A 改为降权**：Codex 认为 one-shot 直接 N/A 掉 Architecture/Tempo/Completion 会掩盖"单次任务收尾差"；建议 downweight＋注明原因而非消失。有道理，但 N/A 的诚实性是产品卖点，倾向保留 N/A、在诊断文字里补收尾评价。可再议。
2. **低置信度时缩小 ±调整幅度**（low ±5 / medium ±10 / high ±15）：合理，实现成本低，可以搭 M1-1.5 顺手做。
3. **Architecture 的"实质性"检查**：空 AGENTS.md 也能拿 20 分、`rootEntryCount` 变相奖励根目录杂乱。可改为检查 AGENTS.md 字节数/章节数等有界实质信号——注意与"不读文件内容"的隐私承诺权衡（读自家 AGENTS.md 的长度应可接受，需在 PRIVACY.md 说明）。
4. **profile 多标签化**（如 `conversation_heavy + long_running`）：30 条纯聊天会被 long_running 规则抢走 learning 标签。M1-1.3 的 sessionKind 已解决自动化误判，多标签可作为后续增强。
5. **oversized 行的宽松抽取**：>2MB 的行目前只留 type/call_id，丢掉命令与输出——恰恰是大粘贴这种高信号场景。可用分段 regex 保留 `name/call_id/output 尾部`。
