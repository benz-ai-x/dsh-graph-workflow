# dsh-graph-workflow

DeepSeek Harness 的可视化 DAG 工作流插件。它把可重复任务保存为工作流，让用户为每个节点配置提示词、Skill、LLM 路由和确定性验收条件，然后从聊天工具或浏览器界面执行，并实时查看每个节点的状态与最终交付物。

仓库内已经内置“小红书运营文案”示例：收集主题、受众、卖点和语气后，依次完成内容策略、初稿、质量审校与发布版交付。

## 能力

- 在“设置 → 工作流”中创建、修改和删除 DAG，并用画布查看依赖关系。
- 节点支持 `prompt`、可选 `skill`、可选 `provider/model` 和 `minChars`、`mustInclude`、`forbidden` 验收规则。
- 同一层无依赖节点并行执行；下游只在所有依赖节点验收通过后启动。
- `list_graph_workflows` 向模型公开可用流程及其结构化输入。
- `run_graph_workflow` 使用当前 `exec.agent` 执行流程，返回可直接交付的最终节点内容。
- 浏览器运行在返回 receipt 后转为服务所有；界面轮询展示 queued/running/succeeded/failed/cancelled/skipped，并可取消运行。
- 工作流定义通过版本号 CAS 和原子 JSON 文件持久化；运行快照只保留在当前 Host 进程内。

## 工作流格式

提示词支持两类引用：

```text
{{input.topic}}
{{nodes.content-strategy}}
```

节点只能引用已声明输入和具有依赖路径的祖先节点。保存时会拒绝环、悬空依赖、重复 ID、未知模板引用和越界内容。DAG 内容始终作为 JSON 参数进入固定执行脚本，不会被拼接成可执行代码。

Skill 由当前 Agent 作用域下的 `ctx.skills` 加载，并且必须允许模型调用。节点未配置模型时继承当前 Agent 的默认路由。

## 本地开发

项目锁定 DeepSeek Harness `0.1.2-alpha.1`、commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`，Node 要求为 `^22.19.0 || >=24.0.0`。

```sh
pnpm install
pnpm verify
```

`pnpm verify` 会校验 Harness commit、文档摘要、干净源码和全部 source links，然后构建 Host/Client/Typert 产物，运行领域、存储、执行器、取消/生命周期、Tool/HMR、真实 Loader、Remote 挂载和 UI 测试，最后检查公共导出与实际 `.tgz` 文件清单。

如果 Harness checkout 移动，需要同步两个 workspace manifest 中的链接并刷新 lockfile：

```sh
DSH_HARNESS_ROOT=/new/path/to/deepseek-harness pnpm context:sync
```

## 开发 Profile 安装

先在仓库根目录完成构建，再安装实际插件子包：

```sh
pnpm build
dsh plugin --profile demo add ./packages/graph-workflow
dsh --profile demo --dump-config
dsh --profile demo
```

卸载命令：

```sh
dsh plugin --profile demo remove dsh-graph-workflow
```

插件通过 [cordis.patch.yml](packages/graph-workflow/cordis.patch.yml) 注入稳定 row `graph-workflow`。完整配置说明见[插件包 README](packages/graph-workflow/README.md)。

## 交付边界

当前插件是针对上述固定 Harness 源码快照验证的 source-linked 交付，包保持 `private: true`。已验证本地构建、Loader 组合和 tarball 内容，但没有改动用户的 DSH profile，也不宣称当前依赖闭包已具备独立 npm 发布条件。
