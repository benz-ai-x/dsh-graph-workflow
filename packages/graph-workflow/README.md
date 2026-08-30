# dsh-graph-workflow

DeepSeek Harness Host/Client 插件：保存、可视化编排并执行可重复 DAG 工作流，支持逐节点提示词、Skill、LLM 路由、验收条件、不可变版本、发布、回归输入、持久运行证据和最终交付物。

## 使用方式

安装并启动后，展开任一 Workspace，即可看到同级的“会话”和“工作流”。点击工作流进入工作流中心，随后按“中心 → 编排 → 测试/运行”的层级完成资产选择、三栏 DAG 配置和可视化执行；它不属于全局“设置”。聊天中的 Agent 可以调用：

- `list_graph_workflows`：列出工作流、说明和必需输入。
- `run_graph_workflow`：以当前 Agent 权限执行指定工作流的已发布版本，或显式锁定某个不可变版本，并返回最终节点的已验收内容。

内置 `xiaohongshu-content` 示例会询问主题/产品、目标人群、核心卖点和可选语气，执行“内容策略 → 首稿撰写 → 质量与合规审校 → 发布版交付”。

提示词模板使用 `{{input.key}}` 引用输入，使用 `{{nodes.node-id}}` 引用具有依赖路径的祖先输出。同层节点并行执行；任何节点未通过验收时，下游不会继续交付成功结果。

编排画布支持节点拖拽、端口连线、边删除、自动布局、MiniMap、撤销/重做和键盘操作。结构化输入可选单行、多行、数字、布尔或枚举控件。测试台既可运行完整 DAG，也可只运行目标节点及其全部祖先；回归输入集可持久保存和复用。

每次保存产生新的不可变 revision，但不会自动改变生产版本。版本页可查看变更摘要和完整 JSON 快照、发布任意保留版本，并把历史内容恢复为新的头版本。浏览器测试始终锁定当前已保存 revision；不显式指定 revision 的模型运行只读取 published revision。

## 配置

`cordis.patch.yml` 使用稳定 row id `graph-workflow`，默认配置如下：

| 字段 | 默认值 | 含义 |
| --- | ---: | --- |
| `storageFile` | `.dsh/graph-workflows.json` | 版本化工作流定义文件 |
| `maxWorkflows` | `100` | 最多保存的工作流数 |
| `maxNodesPerWorkflow` | `32` | 单个 DAG 节点上限 |
| `maxInputChars` | `20000` | 一次运行全部输入的字符上限 |
| `maxPromptChars` | `12000` | 单节点提示词字符上限 |
| `maxSkillChars` | `50000` | 单节点加载 Skill 内容上限 |
| `maxResultChars` | `50000` | 一次运行全部节点输出字符上限 |
| `maxActiveRunsPerAgent` | `4` | 单 Agent 同时运行数 |
| `retainedRuns` | `50` | 每个 Workspace 持久保留的已结束运行快照数 |
| `seedExample` | `true` | 首次启动时写入小红书示例 |

工作流保存、发布和恢复使用 compare-and-set，并按稳定 Workspace ID 隔离。文件写入经过同目录临时文件、fsync 和原子 rename；成功返回即表示状态已经提交。当前存储格式为 schema-v4，统一保存定义头、不可变版本、回归输入集和已结束运行；schema-v1 全局目录会在第一个访问它的 Workspace 中完成一次性归属迁移，schema-v2/v3 头版本会迁移为已发布的不可变版本。

运行快照携带准确的工作流版本、目标节点范围、输入、节点输出、执行路由、错误和逐条验收证据，旧运行不会被后续编辑或删除改变。已结束运行在对外呈现 settled 状态前提交到存储，Host 重启后仍可查看；当前运行状态由内存实时更新。

## 权限与取消

保存、发布、恢复、删除、回归输入、启动、运行记录查询和取消操作都绑定 Typert Remote 解析出的真实 Agent 实例，不接受调用者自报的 Session/Agent 权限。Tool 路径只使用 `exec.agent`。Skill 按该 Agent 的作用域和工作目录加载，并检查 `modelInvocable`；编辑器的 Skill、Provider 和 Model 候选也来自该 Agent 的实时能力目录。

Tool 运行跟随 `exec.signal`，取消会同时传递给 Workflow Engine 的 signal 和 run handle。浏览器启动只在输入与 Skill 准备成功后转移所有权；随后由插件和 Agent Fiber 管理，插件卸载会停止接纳、取消所有运行并等待底层 dispose 完成。

## Source-linked 安装

在 workspace 根目录先执行：

```sh
pnpm context:sync
pnpm verify
dsh plugin --profile web add ./packages/graph-workflow
```

随后使用 `dsh web` 启动。该插件面向包含 `workspaceRegistry`、浏览器 Workspace UI 和 Agent preset 的 `web` Profile；每次执行从确切的 `agent.ctx` 解析该 preset 自己的 `workflowEngine`，不依赖 Host 根作用域引擎。

`context:sync` 会应用并校验仓库内已审计的 Workspace resource Slot 补丁。补丁只允许修改 lock 中列出的 Harness 文件，严格校验会拒绝任何额外漂移。本包锁定本地 DeepSeek Harness `0.1.2-alpha.1` 源码快照并保持 `private: true`，当前不作为独立 npm 发布包承诺。
