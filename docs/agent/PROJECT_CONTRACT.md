# Project Contract

## Product outcome

Package `dsh-graph-workflow` contributes a Host service, two model Tools and a browser settings surface to DeepSeek Harness. Users save reusable DAG definitions, configure each node's prompt, optional Skill, optional LLM route and deterministic acceptance checks, then run one selected workflow from structured input and receive the accepted output node as the deliverable while observing live node state.

The seeded `xiaohongshu-content` workflow is the reference product path: content strategy, draft, compliance review and publish-ready delivery.

## Runtime shape

- Plugin form: Host-side Cordis namespace function plugin plus lazy browser Client bundle.
- Required services: `tools`, `workflowEngine`, `skills`, and `agents`, declared through `inject`.
- Activation: bundle patch `cordis.patch.yml`, stable row id `graph-workflow`.
- Configuration: storage, definition/input/prompt/Skill/result limits, per-Agent concurrency, retained run count and seed behavior; a TypeScript `Config` is paired with a same-named Schemastery schema and direct-call validation.
- Public Tool result: `{ runId, workflowId, workflowRevision, deliverable }`, decoded and bounded before model rendering.
- Definition commit point: a versioned JSON envelope is fsynced to a same-directory temporary file and atomically renamed. Save/remove success is returned only after that commit.
- Run truth: saved definitions are durable; observable run snapshots are process-local and intentionally do not survive Host restart.
- Cancellation: foreground Tool execution bridges `exec.signal` into both the Workflow Engine signal and run handle. Browser start transfers ownership only after validation and Skill loading; it then belongs to the service and exact Agent Fiber.
- Disposal: the plugin stops admission, cancels owned work, awaits every run's engine disposal, drains storage, unregisters Tools/Remote/UI, and then resolves Fiber disposal.
- Development route: local source overlay against the audited Harness lock.
- Publication status: blocked while required DSH packages are unavailable from an ordinary registry install.

## DAG execution contract

- IDs are normalized lower-kebab-case; input keys are lower snake_case.
- Definitions reject cycles, dangling dependencies, duplicate ids, unknown inputs and output references without an ancestor dependency path.
- The executor always sends one fixed orchestration script to `ctx.workflowEngine`; workflow definitions and user input are JSON arguments, never executable source.
- Nodes in the same topological layer use Workflow `parallel`; layers run in order.
- Node prompt templates may reference `{{input.key}}` and `{{nodes.ancestor-id}}` only.
- Skills load through `ctx.skills.get(name, { cwd, signal, scope: agent })`, must be `modelInvocable`, and are size-bounded.
- Per-node provider/model values route the child `agent()` call; omitted values inherit runtime defaults.
- Acceptance rules are deterministic: minimum characters, required substrings, and forbidden substrings. A rejection produces a typed failed run and no successful deliverable.

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
- Do not publish state or notify observers before the authoritative operation commits.
- Stop admission, abort owned work, and await quiescence during disposal.
- Keep the Loader test and Fiber-removal test when changing implementation structure.
- Keep Client Remote-mount disposal and visual execution tests when changing the browser surface.
- Never interpolate workflow/user strings into the Workflow program source.
- Do not replace source-linked dependencies with guessed registry versions or claim publication readiness without a clean external closure.
- When the Harness checkout moves, run `pnpm context:sync` to rewrite the
  development links and dependency lock; changing `DSH_HARNESS_ROOT` alone
  does neither.

## Completion

The source-linked business capability is complete only when `pnpm verify` passes and an assertion observes the filesystem commit independently of the Tool's self-report. Independent distribution is complete only after a clean registry dependency closure and real packed-artifact profile add/boot/behavior/remove smoke.
