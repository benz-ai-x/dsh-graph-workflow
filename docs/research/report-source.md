# Graph Workflow DAG UI/UX 竞品研究与产品建议

研究日期：2026-08-30
研究对象：`dsh-graph-workflow` 工作区级可复用 AI 工作流插件
资料口径：优先采用产品官方文档、官方产品设计文章和官方技术文档；建议结合当前仓库实现与已审计的 DeepSeek Harness `0.1.2-alpha.1` Slot 合同。

> 实施状态（2026-08-30）：本报告的 P0 组合方案已落地为正式产品界面。Harness 通过已审计的 `sidebar.workspace.section` Slot 让“会话 / 工作流”成为 Workspace 下的同级资源；插件已实现“工作流中心 → 三栏编排 → 测试/运行详情”，并按稳定 Workspace ID 隔离定义、保存不可变运行拓扑。直接拖拽连线、草稿/发布版本和持久运行历史仍按本文 P1/P2 路线保留为后续能力。

## 1. 结论摘要

这个产品不应被设计成“设置页里的一个复杂表单”，而应被定义为“当前工作区中的工作流资产与执行工作台”。成熟产品的共同信息架构是：先在项目、空间或工作区中管理工作流，再进入一个占据主要视口的编排器；设计、试运行、生产运行证据和版本发布分别有清晰层级。

建议的目标结构是：

```text
当前工作区
└── 工作流
    ├── 工作流中心：搜索、模板、状态、最近运行、创建
    └── 单个工作流
        ├── 编排：节点库 + 画布 + 节点检查器
        ├── 测试：结构化输入 + 当前测试运行 + 节点证据
        ├── 运行：历史列表 + 单次运行详情
        └── 版本：草稿、已发布版本、比较、回滚
```

在当前 Harness 只有 `sidebar.footer.action`、没有可供插件占用的 `workspace.surface` 或 Workspace 行内动作 Slot 的前提下，当前“绑定当前 Workspace 的近全屏浮层”可以作为 MVP 容器继续使用；但产品文案应从“工作区设置”改为“工作流”或“工作流工作台”。中长期如果要成为主力功能，应在 Harness 上游增加真正的工作区级页面或动作 Slot，而不是回到全局 Settings。

## 2. 竞品与可借鉴模式

| 产品/资料 | 高价值模式 | 对本插件的启发 |
| --- | --- | --- |
| [扣子低代码工作流](https://docs.coze.cn/guides_use_workflow) | 工作流作为目标工作空间资源；开始/结束节点；画布试运行后成功节点显示绿色并可查看节点输入输出；试运行后再发布；可查看资源引用关系 | 与本产品最接近。保留“工作区资产”定位；运行时节点状态应能下钻到输入、输出和验收证据；发布前绑定测试样例 |
| [Dify Workflow 快速上手](https://docs.dify.ai/en/quick-start) | User Input 节点生成运行输入；节点可使用缓存上游变量单独测试；节点 Last Run 日志；草稿测试后 Publish Update | 输入定义自动生成运行表单；加入“测试此节点”；把保存草稿和正式发布分开 |
| [n8n 项目内工作流与共享](https://docs.n8n.io/workflows/sharing/) | 工作流列表跟随项目范围与成员权限；项目成员共享项目中的工作流 | 工作流与权限必须继承 Workspace，不应成为全局配置 |
| [n8n 数据映射 UI](https://docs.n8n.io/data/data-mapping/data-mapping-ui/) | 可把上游 INPUT 面板中的字段拖到节点参数，自动生成表达式 | 不应要求用户手写 `{{input.key}}` / `{{nodes.id}}`；应提供变量选择器、自动补全和插入操作 |
| [n8n 执行管理](https://docs.n8n.io/workflows/executions/all-executions/) | 可过滤运行；失败后选择用原工作流或当前已保存工作流重试；可把历史执行数据加载回画布 | “重试”必须明确绑定哪个 revision；生产失败数据应可回放到编辑/测试环境 |
| [Langflow Visual Editor](https://docs.langflow.org/concepts-overview) 与 [Traces](https://docs.langflow.org/next/traces) | 画布、Playground、Logs 在同一工作空间可达；trace/span 记录节点输入输出、延迟、错误、模型和 Token | 画布状态只负责定位，右侧或底部证据面板解释原因；测试体验可在编辑器内完成 |
| [Flowise Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2) 与 [Human in the Loop](https://docs.flowiseai.com/tutorials/human-in-the-loop) | Start 节点支持聊天或表单输入；显式 Flow State；条件、循环、迭代；人工审批会暂停并从 checkpoint 恢复，拒绝可带反馈回环 | 将人工验收设计成显式 Gate；未来需要 checkpoint 后再承诺长流程审批与恢复 |
| [LangSmith Studio](https://docs.langchain.com/langsmith/observability-studio) 与 [Evaluation](https://docs.langchain.com/langsmith/evaluation) | Graph/Chat 两种复杂度；可从节点进入 LLM Playground；用人工、代码规则、LLM-as-judge 和 pairwise evaluator 评测；离线评测与在线监控分离 | “验收条件”应分确定性规则、LLM 评分和人工审核；发布前回归测试与线上运行验收不要混为一谈 |
| [Pipedream Control Flow](https://pipedream.com/docs/workflows/building-workflows/control-flow) 与 [Event Inspector](https://pipedream.com/docs/workflows/building-workflows/inspect) | 高亮本次实际执行路径；上游变化后把下游测试结果标成 stale；可选择事件回放 | 测试状态与生产运行状态必须视觉分离；修改上游 Prompt/Skill/模型后，下游缓存结果应显示“已过期” |
| [Node-RED Editor](https://nodered.org/docs/user-guide/editor/) 与 [Subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows) | 顶部发布、左侧节点库、中间画布、可移动侧栏；子流程把一组节点折叠为可复用节点 | 采用稳定的三栏编辑器；大图通过组和子流程降噪，而不是无限缩小卡片 |
| [Kestra Flow Editor](https://kestra.io/docs/ui/flows)、[Executions](https://kestra.io/docs/ui/executions) 与 [Revisions](https://kestra.io/docs/concepts/revision) | 编辑器可组合 No Code、代码、Topology、文档面板；运行详情有 Gantt、日志、Topology、输出、Metrics；支持任务重放；版本可比较和回滚 | 运行详情应是独立工作区；版本与运行 revision 必须不可变；高级用户后续可获得 JSON/YAML 视图 |
| [Airflow 3 UI](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) | Graph 解释依赖；Grid 用“任务 × 多次运行”热力矩阵发现反复失败；单任务下钻日志和元数据 | 当运行量增大后，除了单次 DAG，还需要跨运行矩阵与失败聚合 |
| [Dagster+ UI](https://dagster.io/blog/introducing-the-new-dagster-plus-ui) | Lineage Facets 允许按需要显示 owner、状态、自动化条件等元数据；图可保持简洁或切到诊断密度 | 节点卡片提供“简洁/诊断”显示密度，不要永久塞满 Prompt、Skill、模型、成本和状态 |
| [Retool Inspector 设计复盘](https://retool.com/blog/simplifying-retools-inspector) | 属性分组、逐步添加列表项、基础/高级折叠，用渐进披露减少长面板负担 | 当前扁平节点表单应改成稳定的分组与高级区；验收规则用逐条规则编辑器，不用逗号字符串 |
| [React Flow 组件](https://reactflow.dev/learn/concepts/built-in-components) 与 [无障碍支持](https://reactflow.dev/learn/advanced-use/accessibility) | MiniMap、缩放/适配/锁定控制、背景和固定面板；节点/边支持键盘操作和屏幕阅读器 | 一旦进入拖拽连线阶段，优先采用成熟画布基础设施，不再自行实现视口、选区、边交互和键盘可达性 |

## 3. 推荐的信息架构

### 3.1 工作流中心与编辑器分开

当前实现把工作流目录永久放在编排器左侧。工作流数量增加后，这会同时挤压画布和检查器。建议先进入工作流中心：

- 列表或卡片字段：名称、描述、标签、草稿/已发布、当前 revision、最近一次运行、成功率、更新时间。
- 顶部操作：新建、从模板创建、搜索、筛选、导入。
- 打开某个工作流后，左侧位置改为节点库或图大纲；通过面包屑返回工作流中心。
- “小红书运营文案”作为模板卡片，带示例输入与预期交付预览。

### 3.2 单工作流四个一级视图

建议用 `编排 / 测试 / 运行 / 版本`，而不是当前的 `编排 / 运行`：

- 编排：定义与保存草稿。
- 测试：用一次结构化输入快速试跑，允许节点级测试和缓存数据。
- 运行：生产/用户触发的运行历史与单次运行详情。
- 版本：草稿、已发布版本、差异和回滚。

这能避免当前“启动表单 + 12 个完整 DAG 卡片”同时堆在一个长页面里。

### 3.3 编排页面布局

```text
┌ Workspace / 工作流 / 小红书运营文案 ─ Draft r7 ─ 校验 ─ 测试 ─ 发布 ┐
├ 节点库/大纲 ────────┬──────── DAG 画布 ───────────┬ 节点检查器 ┤
│ 搜索、最近使用       │ 缩放、适配、MiniMap、自动布局 │ 任务与 Prompt │
│ 输入/LLM/Skill/Gate │ 节点、端口、边、组/子流程    │ Skill / LLM   │
│                     │                              │ 输出与验收    │
├─────────────────────┴── 可收起的测试/Trace 控制台 ┴─────────────┤
```

在当前 Harness 容器中继续使用近全屏浮层时，应做到：固定顶部栏，画布自身占满剩余高度，目录/检查器独立滚动，不让整个浮层出现一条超长页面滚动条。

## 4. 画布与节点交互规范

### 4.1 画布

- 必备：缩放、缩小、100%、适配全部、MiniMap、锁定编辑、自动布局。
- 节点可拖动并记住坐标；提供“一键自动布局”，而不是每次都强制重排。
- 支持框选、多选、复制粘贴、删除、撤销/重做和快捷添加。
- 连接关系应通过端口和边操作；节点检查器中的依赖列表只做摘要或辅助编辑，不再以大量复选框作为主路径。
- 边必须可选中、删除；条件分支出现后给边显示 `通过/未通过` 或条件标签。
- 节点和边都需要键盘焦点；颜色之外必须有图标和文字状态。

### 4.2 节点卡片

默认简洁视图只显示：类型图标、名称、一行任务摘要、Skill/模型覆盖徽标、验收规则数量和校验状态。

运行诊断视图增加：状态、耗时、尝试次数、Token/成本（有数据后）、验收结果。选中使用外圈，运行状态使用内部状态条或角标，避免两者争夺同一个边框颜色。

### 4.3 节点检查器

固定分组：

1. 基本信息：名称、描述；ID 放高级区且保存后谨慎修改。
2. 任务：Prompt 编辑器、变量自动补全、输入预览。
3. 能力：Skill 选择器、可用性/权限状态。
4. 模型：默认选择“继承工作区/运行时默认”，需要时再覆盖 Provider/Model。
5. 输出与验收：输出预览、规则列表、失败策略。
6. 高级：元数据、超时、重试、调试选项（运行时支持后）。

底部固定操作：`测试此节点`、`保存`。变量引用使用可搜索选择器并只展示合法的 workflow input 和祖先节点输出。

## 5. 运行与调试体验

单次运行详情建议采用三栏：左侧运行历史，中间带状态的 DAG，右侧选中节点证据；底部可切时间轴/日志。点击节点至少显示：

- 开始、结束、耗时、状态和错误码；
- 运行时使用的 Prompt、Skill、Provider/Model；
- 节点输出；
- 每一条验收规则的通过/失败及证据；
- 可复制的最终交付物。

允许的操作需要语义明确：

- 取消当前运行；
- 用同一 revision 和同一输入重跑；
- 复制为新测试；
- 未来支持“从失败节点继续”时，必须复用不可变上游输出并标明 provenance；
- 用当前草稿重试必须显示它不是原运行的重放。

工作流运行图必须来自该运行绑定的不可变 definition snapshot，不能用当前目录中的最新定义重建旧运行图。

## 6. 验收条件应成为一等能力

当前的最小字符数、必须包含、禁止包含是一个好的确定性起点，但 UI 不应只提供三个文本框。建议采用“规则列表 + 结果证据”：

- 确定性：最小/最大长度、包含/禁止、正则、JSON Schema、字段完整性。
- 模型评分：Rubric、阈值、评分理由、评审模型版本。
- 人工审核：暂停、显示产物、通过/驳回、反馈、回到指定节点。
- 失败策略：停止、按反馈重试、走 fallback、等待人工。

如果验收只决定节点能否成功，它可作为节点附属策略并显示 `验收 3 条` 徽标；如果验收会形成不同执行路径，它必须在图上成为显式 Gate/边，不能藏在属性面板里。

## 7. 评审时实现基线（已由上述实施状态替换）

### 已经做对的部分

- `WorkspaceGraphWorkflowSettings.tsx` 从当前 Session/CWD 解析 Workspace，Workspace 消失或切换时关闭，符合工作区边界。
- 使用 `sidebar.footer.action`，没有重新注册到全局 Settings。
- Definition 有 CAS revision；运行记录包含 node status、startedAt/endedAt、output/error，足以先做节点证据和耗时 UI。
- 编排与运行已分模式，且 DAG 状态可视化已经有基础。

### 优先修正的 UX/正确性问题

1. 名称仍是 `WorkspaceGraphWorkflowSettings`，弹层标题也使用“工作区设置”；用户心智应改成“工作流工作台”。
2. 当前 `DagCanvas` 是固定自动布局的 SVG + button 卡片，没有视口、拖拽、端口、边选择、MiniMap 或键盘边操作。
3. 依赖关系主要靠检查器复选框配置，图本身不能完成“编排”。
4. 节点检查器是一个扁平长表单；Prompt、Skill、LLM、依赖和验收竞争同一纵向空间。
5. `运行`页同时承载启动表单和最多 12 个完整 DAG，运行越多越难浏览；应改成运行列表 + 单个详情。
6. 旧运行图当前通过 `catalog` 中同 workflow ID 的最新定义渲染。Definition 更新后，旧运行可能显示错误拓扑；运行数据需要保存拓扑/definition snapshot。
7. 当前“运行历史”是 Agent 与进程内状态，Host 重启不保留。持久化之前，文案应明确为“本次会话运行”或“近期运行（重启后清空）”。
8. 当前 900ms 轮询适合 MVP；若以后有大量运行，改用受取消与重连管理的 snapshot/delta stream。

## 8. 实施优先级

### P0：在现有运行时合同内提升可用性与正确性

- 改名与信息架构：工作流中心；`编排 / 测试 / 运行`；不进入全局 Settings。
- 运行列表 + 单个运行详情，停止同时展开全部 DAG。
- 运行绑定不可变拓扑快照；旧 revision 显示正确。
- 运行节点检查器：状态、耗时、输出、错误和确定性验收证据。
- 节点检查器分组；验收项改为 tags/规则列表；Prompt 变量选择器。
- 画布加入缩放、适配、MiniMap、自动布局、键盘焦点和非颜色状态。
- 依赖连线成为主要编辑方式，并保留 Host 端 DAG 校验。

### P1：可复用工作流的安全发布与调试闭环

- 草稿与已发布 revision 分离；dsh 自动调用只运行已发布版本。
- 版本列表、差异、回滚；保存后是否立即生效必须透明。
- 节点单测、缓存上游输出、stale 标记、样例输入集。
- 重跑原 revision、复制生产失败为测试、从安全检查点继续。
- 模板中心、复制工作流、导入导出。

### P2：需要扩展领域/执行合同

- 条件分支、Gate、重试边、fallback、循环和子流程。
- LLM-as-judge、人工审批与持久 checkpoint。
- 类型化输入/输出与字段级数据映射。
- Token、成本、模型元数据与 trace/span。
- 持久运行历史、跨运行 Grid、成功率/延迟/成本趋势。
- Workspace 成员权限、协作、评论、审批角色。

## 9. 不建议的做法

- 不把工作流重新放回全局 Settings。
- 不把成熟版本永久困在普通居中 Modal；当前近全屏容器只是 Harness Slot 限制下的过渡方案。
- 不在节点卡片上永久显示完整 Prompt 或所有配置。
- 不用颜色作为唯一状态信号。
- 不在没有 checkpoint/不可变 revision 的情况下提供“从这里继续”并暗示结果可复现。
- 不把 LLM 质量要求只写进 Prompt；验收必须产生结构化结果和证据。
- 不把所有高级能力一次铺开；先完成可理解、可测试、可回放的线性/并行 DAG。

## 10. 研究边界

本轮关注 UI/UX 与产品信息架构，未对各产品商业价格、部署性能或许可证做横向评估。部分建议（例如条件边、人工审批、持久运行历史和成本）超出当前 `GraphWorkflowNode` / `GraphWorkflowRunSnapshot` 合同，已明确放入需要扩展运行时的阶段，不能仅靠前端伪造。
