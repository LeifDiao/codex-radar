# Codex Radar

> **一款 Codex 插件，读取你本地的 Codex 会话记录，评估你和 Codex 协作的质量。** 从「沟通力 / 工程力 / 成效」三个层面、9 个维度打分 —— 由你自己的 Codex 模型对照公开 rubric 打分并撰写诊断，输出一组可直接粘贴的改写 prompt 和一个专业可读的单文件 HTML dashboard。全程本地。

🌏 [English](./README.md) · 📖 [方法论](./docs/METHODOLOGY_zh.md) · 🖥 [在线预览](https://leifdiao.github.io/codex-radar/) · ⚖️ [协议](./LICENSE)

> **English summary:** A Codex plugin that reads your local Codex session history and grades how well you collaborate with the agent across 9 dimensions in 3 categories. Your own Codex model scores the sessions against a transparent rubric and writes a free-form diagnosis, plus paste-ready improvement prompts and a professional single-file HTML dashboard. 100% local. Full English docs → [README.md](./README.md)

---

## 核心特性

**🎯 评估你真实的 Codex 会话记录，不靠人工题库。** Codex Radar 直接解析 Codex 已经写好的 JSONL —— 你发的每条 prompt、每条 shell 命令和它的退出码、每次 `apply_patch` 编辑、每次 plan 更新，以及 MCP / 搜索 / 图像 / 子代理调用。分数反映你真实的工作方式，而不是你怎么答题。

**💬 你的 Codex 亲自给你写诊断，而不只是给分数。** 确定性解析器先提取事实；再由你自己的 Codex 模型对照公开 rubric 打分 —— 公式基线 + 有界、引用证据的 ±15 微调 —— 并写出一段自由格式的协作诊断。每条结论都指向你的真实消息。

**📋 每条建议都是可粘贴 prompt。** 不讲"要多思考"这种空话。每条改进建议都附一段可以直接复制到下一个 thread 的具体话术，并标注它能提升哪个维度、预期影响多大。

**⚖️ 按项目类型公平加权。** 3 条消息修完的 bug 不会和 50 个 session 的功能开发用同一把尺子。Codex Radar 自动归类（一次性 / 功能开发 / 长期 / 学习），按类别套用不同权重。当某个信号确实无法评估时 —— 比如项目目录在本机已经找不到，Architecture 维度会标记为 **N/A**，绝不假装给一个 50 分。

**🛠 专门评估你怎么用平台，不只是怎么说话。** 工程力类目读取 shell 命令成功率、补丁、plan 更新、MCP 服务、网页搜索、图像工具、子代理调用。Architecture 奖励持久化的工程设置 —— `AGENTS.md`、仓库脚手架、测试、依赖清单 —— 这些都是大多数用户没用足的杠杆。

**🔒 全本地，零数据上传。** 只读访问 `~/.codex/sessions`，无 API key、无云端、不发任何网络请求。报告是经过转义的单文件 HTML，写到 `~/.codex-radar/reports/`。

> **English highlights:**
> - **🎯 Reads your real Codex sessions** — prompts, shell exit codes, `apply_patch` edits, plan updates, MCP / search / image / subagent calls
> - **💬 Your Codex writes the diagnosis** — facts parser + model scoring against a transparent rubric (formula baseline + evidence-cited adjustment)
> - **📋 Every suggestion is a paste-ready prompt** with its expected impact
> - **⚖️ Project-type-aware weighting** — N/A instead of a faked 50 when a signal can't be evaluated
> - **🛠 Evaluates platform leverage** (shell / patch / plan / MCP / search / image / subagents + AGENTS.md scaffolding)
> - **🔒 100% local, zero telemetry**
>
> Full English version → [README.md](./README.md)

---

## 报告里有什么

让 Codex 运行这个插件，你会得到一个单文件、专业可读的 HTML dashboard：

**总评等级** —— 从 S 到 D，旁边永远标注你项目的画像类型，让你知道自己是用什么尺子被量。

**三类评分卡** —— 每类 0-100 分，下挂 3 个维度：

| 类别 | 维度 |
| --- | --- |
| **沟通力** | Lock-On 瞄准力 · Scene Setting 铺场力 · Steering 校准力 |
| **工程力** | Toolcraft 工具调度 · Architecture 工程脚手架 · Tempo 推进节奏 |
| **成效** | Efficiency 产出效率 · Proof Check 验证意识 · Completion 闭环完成 |

**诊断** —— 你最强的信号、最主要的瓶颈、一段协作概述，以及一段跨类别的模式解读 —— 全部由你自己的会话计算得出，每个维度都内嵌可见的证据。

**改进 prompt** —— 一组按优先级排序、可直接粘贴的改写 prompt（最多 7 条），针对每个有明显提升空间的维度各给一条，并标注预期分数影响。

**信号与指标** —— 高频工具、工具类别、项目资产（`AGENTS.md`、`.git`、测试、依赖清单）、命令成功率、上下文压缩次数，以及一张「关键消息」表，标出每条消息里被识别出的信号。

---

## 安装

**第一步** —— 添加插件市场（这个仓库本身就是一个 Codex marketplace）：

```bash
codex plugin marketplace add LeifDiao/codex-radar
```

**第二步** —— 安装插件：

```bash
codex plugin add codex-radar@codex-radar-marketplace
```

**本地安装：**

```bash
git clone https://github.com/LeifDiao/codex-radar.git ~/codex-radar
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
3. 解析 + 评分 —— 几秒钟，纯 Node，不用等模型。
4. Dashboard 写入 `~/.codex-radar/reports/`，并把路径打印出来供你打开。

像 *"Analyze my Codex collaboration"* 或 *"Create a Codex Radar report"* 这样的起手 prompt 同样有效。

---

## 环境要求

- **Codex CLI** —— 支持插件版本
- **Node.js 18+**
- 不用 `npm install`、不用编译、不用服务

---

## 隐私

你的会话数据始终留在本地：

- 所有计算本地完成 —— 不发任何网络请求、无 API key、无遥测
- `~/.codex/sessions`、`~/.codex/archived_sessions`、`~/.codex/session_index.jsonl` 只读访问
- 报告写入 `~/.codex-radar/reports/`（临时 JSON 写入 `~/.codex-radar/temp/`）
- 项目资产检测只判断 `AGENTS.md`、`.git`、测试目录等文件是否存在，从不读取它们的内容
- 报告可能包含你自己 prompt 的短片段作为证据 —— 除非你主动分享，否则请把 HTML 当作私有文件

完整数据清单见 [PRIVACY.md](./PRIVACY.md)。

---

## 评分原理

**两层架构，与 [Claude Radar](https://github.com/LeifDiao/claude-radar) 一致：**

1. **事实** —— `parse-codex-project.mjs` 读取匹配的会话文件，提取可计数的信号（消息模式、工具类别、命令退出码、补丁事件、验证命令、项目资产）。确定性：同一输入 → 同一份事实。
2. **评分 + 诊断** —— 由你自己的 Codex 模型读取这些事实和 `data/rubric.json`，计算每个维度的公式基线，加上有界的 ±15 证据微调，再写出自由格式的诊断和可粘贴 prompt。rubric 是公开的评分章程。
3. **渲染** —— `render-report.mjs` 把报告 JSON 转成一个自包含的单文件 HTML。

分析跑在你自己的 Codex 会话里 —— 插件本身不发任何网络请求，也不需要额外的 API key。

👉 [完整方法论](./docs/METHODOLOGY_zh.md)

---

## 评分规则全公开

所有评分输入都在 [`plugins/codex-radar/data/rubric.json`](./plugins/codex-radar/data/rubric.json)：

- 9 个维度的定义（中英）和所属类别
- 4 种项目画像 + 各自的类别权重表
- 等级阈值（S / A / B / C / D）

想让评分更贴合团队习惯？改这个文件，以及 `parse-codex-project.mjs` 里的维度公式 —— 解析器每次跑都会重新读取 rubric。

---

## 项目结构

这个仓库本身就是一个 Codex 插件市场。

```text
codex-radar/
├── .agents/plugins/marketplace.json      # Codex marketplace 清单
├── docs/
│   ├── index.html                        # GitHub Pages 落地页
│   ├── METHODOLOGY.md / METHODOLOGY_zh.md # 评分规范（中英）
└── plugins/
    └── codex-radar/
        ├── .codex-plugin/plugin.json      # 插件清单
        ├── data/rubric.json               # 9 维定义 + 画像权重
        └── skills/analyze/
            ├── SKILL.md                    # 编排：检测 → 解析 → 渲染
            └── scripts/
                ├── lib.mjs                 # 共享的 Codex 会话工具函数
                ├── list-codex-projects.mjs # 扫描 ~/.codex/sessions + cwd 匹配
                ├── parse-codex-project.mjs # 信号提取 + 确定性评分
                └── render-report.mjs       # 报告 JSON → 单文件 HTML
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
