# dsh-graph-workflow

DeepSeek Harness 的可视化 DAG 工作流插件。它把可重复任务保存为工作流，让用户为每个节点配置提示词、Skill、LLM 路由和确定性验收条件，然后从聊天工具或浏览器界面执行，并实时查看每个节点的状态与最终交付物。

仓库内已经内置“小红书运营文案”示例：收集主题、受众、卖点和语气后，依次完成内容策略、初稿、质量审校与发布版交付。

## 能力

- 每个 Workspace 展开后都以同级资源显示“会话”和“工作流”；工作流不进入全局“设置”。
- 工作流中心用于搜索、创建和选择资产；进入后使用三栏编排器配置 DAG；画布支持节点拖拽、端口连线、边删除、自动布局、MiniMap、撤销/重做和键盘操作。
- 输入支持单行、多行、数字、布尔和枚举类型；节点支持 `prompt`、可选 `skill`、可选 `provider/model` 和 `minChars`、`mustInclude`、`forbidden` 验收规则，Skill/模型选择器来自当前 Agent 的实时能力目录，也允许手动填写自定义值。
- 同一层无依赖节点并行执行；下游只在所有依赖节点验收通过后启动。
- 草稿保存会创建不可变版本；用户可比较版本、发布任意保留版本，或把历史版本恢复为新的头版本。普通模型运行默认只使用已发布版本，测试台显式锁定正在编辑的保存版本。
- `list_graph_workflows` 只向模型公开已发布流程及其结构化输入；`run_graph_workflow` 使用当前 `exec.agent` 执行已发布版本，也可显式锁定不可变版本，返回可直接交付的最终节点内容。
- 浏览器运行在返回 receipt 后转为服务所有；界面轮询展示 queued/running/succeeded/failed/cancelled/skipped，并可取消运行。
- 测试台支持完整流程或“目标节点 + 全部祖先”的隔离运行，并可保存、复用和删除回归输入集。
- 工作流定义按稳定 Workspace ID 隔离，通过版本号 CAS 和原子 JSON 文件持久化；多窗口保存冲突不会覆盖本地草稿，可载入远端版本或另存副本。同名 ID 可存在于不同 Workspace。
- 已结束运行在对外呈现 settled 状态前持久化不可变 definition snapshot、逐节点输出和逐条验收证据；Host 重启后仍可查看并复用输入。运行中的状态保持实时更新。

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
pnpm context:sync
pnpm verify
```

`pnpm context:sync` 会把锁定的 Workspace resource Slot 补丁应用到对应 Harness checkout、重建受影响的 Client 包、同步 source links 并安装依赖。`pnpm verify` 会校验 Harness commit、文档摘要、补丁 SHA-256、补丁之外零漂移和全部 source links，然后构建 Host/Client/Typert 产物，运行领域、存储、执行器、取消/生命周期、Tool/HMR、真实 Loader、Remote 挂载和 UI 测试，最后检查公共导出与实际 `.tgz` 文件清单。

如果 Harness checkout 移动或重新拉取为干净 checkout，需要重新应用已审计补丁、同步两个 manifest 中的链接并刷新 lockfile：

```sh
DSH_HARNESS_ROOT=/new/path/to/deepseek-harness pnpm context:sync
```

## 开发 Profile 安装

先在仓库根目录完成构建，再安装实际插件子包：

```sh
pnpm build
dsh plugin --profile web add ./packages/graph-workflow
dsh --profile web --dump-config
dsh web
```

卸载命令：

```sh
dsh plugin --profile web remove dsh-graph-workflow
```

插件通过 [cordis.patch.yml](packages/graph-workflow/cordis.patch.yml) 注入稳定 row `graph-workflow`。它面向带 Workspace 与浏览器 UI 的 `web` Profile；工作流引擎按当前 Agent preset 解析，因此不要把它安装到只有 `dsh-base` 的自定义 Profile。完整配置说明见[插件包 README](packages/graph-workflow/README.md)。

## 交付边界

当前插件是针对上述固定 Harness 源码快照验证的 source-linked 交付，包保持 `private: true`。已使用隔离的开发 Profile 验证安装与启动，并验证本地构建、Loader 组合和 tarball 内容；不宣称当前依赖闭包已具备独立 npm 发布条件。
