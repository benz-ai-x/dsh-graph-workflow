# Workspace Workflow UI prototype

> PROTOTYPE / THROWAWAY: this folder is for structure review only. It has no persistence and calls no DSH Remote API.

Design question: **When Sessions and Workflows are sibling resources under a Workspace, which primary surface makes reusable DAG work easiest to discover, author, and run?**

Three structurally different variants live on one route and are switched with `?variant=` or the floating review bar:

- `A — 专业编排器`: editor-first, three-column canvas, progressive node inspector.
- `B — 工作流中心`: asset-first, searchable hub, then a guided step editor.
- `C — 运行工作台`: run-first, structured input, live execution, and deliverable in one view.

Run from the repository root:

```sh
pnpm prototype:ui
```

Then open <http://127.0.0.1:4179/?variant=A>.

Review with these questions:

1. Does `Workspace > Sessions / Workflows` feel like one coherent resource tree?
2. Should clicking a Workflow open the hub, the canvas, or the run form by default?
3. Is node configuration easier to understand as inspector groups (A) or guided steps (B)?
4. Should test evidence be a bottom drawer (A) or a permanent run panel (C)?
5. Which terms should become final: `编排 / 测试 / 运行 / 版本`, and `验收规则` versus `质量门`?

The sidebar arrangement is an ideal-host prototype. The pinned Harness currently lacks a per-Workspace child-resource Slot, so implementing this exact tree requires a small upstream Slot contract instead of replacing the Workspace browser.
