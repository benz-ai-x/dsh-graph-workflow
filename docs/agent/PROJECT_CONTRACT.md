# Project Contract

## Product outcome

Package `dsh-graph-workflow` contributes a Host service, two model Tools and a Workspace-owned browser workbench to DeepSeek Harness. Every expanded real Workspace shows built-in `会话` and contributed `工作流` as sibling resource sections; the plugin must never register as a global Settings section. The workbench follows `工作流中心 → 编排 → 测试/运行`: users save reusable DAG definitions, configure each node's prompt, optional Skill, optional LLM route and deterministic acceptance checks, then run one selected workflow from structured input and receive the accepted output node as the deliverable while observing live node state.

The seeded `xiaohongshu-content` workflow is the reference product path: content strategy, draft, compliance review and publish-ready delivery.

## Runtime shape

- Plugin form: Host-side Cordis namespace function plugin plus lazy browser Client bundle.
- Required Host-root services: `tools`, `skills`, `llm`, `agents`, and `workspaceRegistry`, declared through `inject`. The Web profile mounts `workflowEngine` inside each live Agent preset; execution must resolve it from the exact `agent.ctx`, never require or use a Host-root engine.
- Activation: bundle patch `cordis.patch.yml`, stable Cordis row id `graph-workflow`; Client contribution id `graph-workflow` occupies `sidebar.workspace.section`.
- Configuration: storage, definition/input/prompt/Skill/result limits, per-Agent concurrency, retained run count and seed behavior; a TypeScript `Config` is paired with a same-named Schemastery schema and direct-call validation.
- Public Tool result: `{ runId, workspaceId, workflowId, workflowRevision, deliverable }`, decoded and bounded before model rendering.
- Durable commit point: a schema-v4, Workspace-scoped JSON envelope containing definition heads, immutable versions, regression inputs and settled runs is fsynced to a same-directory temporary file and atomically renamed. A successful save/publish/restore/remove/test-case mutation is returned only after that commit; schema-v1 definitions are adopted by the first Workspace that opens the legacy catalog, and schema-v2/v3 heads become published immutable versions.
- Version truth: every save creates an immutable draft revision; publication is an explicit CAS projection that normal/model-triggered runs use by default; historical content is restored only by creating a new head revision. An explicitly requested saved revision has exact execution semantics.
- Run truth: every run captures its exact immutable definition snapshot. In-flight observation is live and process-owned; a settled result becomes observable only after its bounded Workspace history and per-rule acceptance evidence commit, and survives Host restart.
- Cancellation: foreground Tool execution bridges `exec.signal` into both the Workflow Engine signal and run handle. Browser start transfers ownership only after validation and Skill loading; it then belongs to the service and exact Agent Fiber.
- Disposal: the plugin stops admission, cancels owned work, awaits every run's engine disposal, drains storage, unregisters Tools/Remote/UI, and then resolves Fiber disposal.
- Development route: the SHA-256-pinned `workspace-resource-slot.patch` local source overlay against the audited Harness commit. Strict verification accepts that exact diff and rejects all other Harness drift.
- Publication status: blocked while required DSH packages are unavailable from an ordinary registry install.

## DAG execution contract

- IDs are normalized lower-kebab-case; input keys are lower snake_case.
- Definitions reject cycles, dangling dependencies, duplicate ids, unknown inputs and output references without an ancestor dependency path.
- Inputs normalize to strings at the execution boundary while preserving editor control types (`text`, `multiline`, `number`, `boolean`, `select`) and validating typed/default values.
- The executor always sends one fixed orchestration script to the exact live Agent's scoped `workflowEngine`; workflow definitions and user input are JSON arguments, never executable source.
- Nodes in the same topological layer use Workflow `parallel`; layers run in order.
- Node prompt templates may reference `{{input.key}}` and `{{nodes.ancestor-id}}` only.
- Skills load through `ctx.skills.get(name, { cwd, signal, scope: agent })`, must be `modelInvocable`, and are size-bounded.
- Per-node provider/model values route the child `agent()` call; omitted values inherit runtime defaults.
- Acceptance rules are deterministic: minimum characters, required substrings, and forbidden substrings. A rejection produces a typed failed run and no successful deliverable.
- A target-node test executes that node plus all transitive ancestors and records the target in its immutable run snapshot.

## Required startup

1. Read this contract, `TODO.md`, and `dsh-reference.lock.json`.
2. Before dependency installation, run `node scripts/verify-dsh-context.mjs`.
3. Load `$dsh-plugin-dev` in Codex or `/dsh-plugin-dev` in Claude Code, then its
   core, Tool, and packaging references.
4. Inspect the worktree and preserve unrelated changes.
5. Run `node scripts/verify-dsh-context.mjs --require-source` before changing
   runtime behavior; after `pnpm install`, the equivalent command is
   `pnpm context:check:strict`.

## Invariants

- Export `name`, `inject`, `Config`, and `apply` as named exports; do not add a default export.
- Treat parameter and output schemas as public runtime contracts.
- Keep the canonical JSON value separate from model-facing rendering and optional UI presentation.
- Reject or model expected domain outcomes deliberately; do not hide infrastructure failure in a success string.
- Never accept a caller-supplied Agent or Session id as authority when `exec.agent` or the Typert Agent lookup owns the operation; require exact registry object identity.
- Resolve workflow ownership from the exact live Agent's `workspaceRegistry` membership. A caller-supplied path, title, Workspace id or current browser selection is never sufficient authority for a mutation or run.
- Scope catalogs, definitions, deletes, seeds and active-run guards by stable Workspace id; allow the same workflow id in different Workspaces.
- Do not publish state or notify observers before the authoritative operation commits.
- Do not expose an unpublished head through model catalog/default execution; browser tests must pin the intended saved revision explicitly.
- Stop admission, abort owned work, and await quiescence during disposal.
- Keep the Loader test and Fiber-removal test when changing implementation structure.
- Keep Client Remote-mount disposal and visual execution tests when changing the browser surface.
- Never interpolate workflow/user strings into the Workflow program source.
- Do not replace source-linked dependencies with guessed registry versions or claim publication readiness without a clean external closure.
- When the Harness checkout moves or is recreated clean, run `pnpm context:sync`
  to apply the audited overlay, rebuild ui-workspace, rewrite development links
  and refresh the dependency lock; changing `DSH_HARNESS_ROOT` alone does none
  of these.

## Completion

The source-linked business capability is complete only when `pnpm verify` passes and an assertion observes the filesystem commit independently of the Tool's self-report. Independent distribution is complete only after a clean registry dependency closure and real packed-artifact profile add/boot/behavior/remove smoke.
