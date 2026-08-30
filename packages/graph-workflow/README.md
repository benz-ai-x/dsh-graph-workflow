# dsh-graph-workflow

DeepSeek Harness Host/Client 插件：保存、可视化编排并执行可重复 DAG 工作流，支持逐节点提示词、Skill、LLM 路由、验收条件、实时状态和最终交付物。

## 使用方式

安装并启动后，在“设置 → 工作流”中编排 DAG。聊天中的 Agent 可以调用：

- `list_graph_workflows`：列出工作流、说明和必需输入。
- `run_graph_workflow`：以当前 Agent 权限执行指定工作流，并返回最终节点的已验收内容。

内置 `xiaohongshu-content` 示例会询问主题/产品、目标人群、核心卖点和可选语气，执行“内容策略 → 首稿撰写 → 质量与合规审校 → 发布版交付”。

提示词模板使用 `{{input.key}}` 引用输入，使用 `{{nodes.node-id}}` 引用具有依赖路径的祖先输出。同层节点并行执行；任何节点未通过验收时，下游不会继续交付成功结果。

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
| `retainedRuns` | `50` | 单 Agent 保留的已结束运行快照数 |
| `seedExample` | `true` | 首次启动时写入小红书示例 |

工作流保存使用 `expectedRevision` 做 compare-and-set。文件写入经过临时文件、fsync 和原子 rename；成功返回即表示定义已经提交。运行快照是进程内观测数据，Host 重启后不会恢复，但已保存定义会恢复。

## 权限与取消

保存、删除、启动、查询和取消操作都绑定 Typert Remote 解析出的真实 Agent 实例，不接受调用者自报的 Session/Agent 权限。Tool 路径只使用 `exec.agent`。Skill 按该 Agent 的作用域和工作目录加载，并检查 `modelInvocable`。

Tool 运行跟随 `exec.signal`，取消会同时传递给 Workflow Engine 的 signal 和 run handle。浏览器启动只在输入与 Skill 准备成功后转移所有权；随后由插件和 Agent Fiber 管理，插件卸载会停止接纳、取消所有运行并等待底层 dispose 完成。

## Source-linked 安装

在 workspace 根目录先执行：

```sh
pnpm install
pnpm verify
dsh plugin --profile demo add ./packages/graph-workflow
```

本包锁定本地 DeepSeek Harness `0.1.2-alpha.1` 源码快照并保持 `private: true`，当前不作为独立 npm 发布包承诺。
