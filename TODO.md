# TODO

## P0 — Runtime foundation

- [x] Pin DeepSeek Harness `0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- [x] Create the Host Tool namespace plugin, Schemastery Config, bundle patch,
  Codex/Claude entries, stable-id Loader fixture, built-entry smoke, and
  packed-file check.
- [x] Bind development dependencies to the audited local Harness source.

## P1 — Business contract

- [x] Implement saved visual DAGs and accepted final delivery over the exact Agent-scoped `workflowEngine`.
- [x] Define structured workflow/input/run contracts and stable domain error codes.
- [x] Bind Remote mutations and execution to the exact live Agent; atomically commit definitions with CAS.
- [x] Define foreground/background cancellation, Agent/plugin disposal quiescence, concurrency and size limits.
- [x] Keep DAG/user content as data passed to a fixed script; enforce scoped Skill invocation policy.
- [x] Isolate catalogs, definitions, seeding and active-run guards by stable Workspace identity.
- [x] Capture an immutable workflow definition snapshot in every run.
- [x] Separate immutable draft revisions from the explicitly published production revision; support compare, exact-version execution and restore-as-new-revision.
- [x] Persist bounded settled run history, node outputs and per-rule acceptance evidence before publishing the settled state.

## P2 — Workspace product surface

- [x] Add the audited `sidebar.workspace.section` Harness Slot so `会话` and `工作流` are sibling resources under each Workspace.
- [x] Replace the old Settings/footer entry with `工作流中心 → 三栏编排器 → 测试/运行详情`.
- [x] Connect the workbench to scoped Remote catalog/save/delete/start/runs/cancel operations.
- [x] Add search, structured input, prompt-variable insertion, grouped node configuration, zoom/fit/MiniMap, timeline, cancellation and final-deliverable copy.
- [x] Refine the production UI with full-height workbench layouts, responsive canvas fitting, readable DAG states, accessible tabs and required-input readiness feedback.
- [x] Add direct node dragging, port-to-port edge authoring, edge deletion, persisted positions, undo/redo and keyboard-complete canvas interactions.
- [x] Add typed inputs, live Skill/Provider/Model suggestions, isolated node testing and reusable persisted regression input sets.
- [x] Add immutable version history, change summaries, complete snapshot inspection, publication and restore controls.
- [x] Add durable run history, detailed execution evidence and historical-input reuse.

## P0/P1 — Product hardening

- [x] Seed each Workspace exactly once so deleting the example never resurrects it.
- [x] Lock an existing workflow id and preserve local edits on CAS conflicts, with explicit remote-load and save-as-copy recovery.
- [x] Fence duplicate mutations/runs and guard dirty back, modal close and browser unload paths.
- [x] Trap modal focus, support Escape close and return focus to the launcher.
- [x] Persist and validate schema-v4 migrations, historical execution snapshots and restart-safe run evidence.

## P3 — Verification

- [x] Add focused success, validation, failure, cancellation, and external-boundary tests.
- [x] Retain namespace-export, HMR, Remote mount and Fiber-disposal coverage.
- [x] Prove the real `cordis.yml` Loader path applies the configured storage location.
- [x] Assert the atomic store file from the filesystem and reopen it independently.
- [x] Exercise the visual editor, live node state, structured run form and final deliverable in jsdom.
- [x] Install into a development profile and verify add, config dump, boot, behavior, and remove.

## P4 — Delivery

- [x] Document Model Experience, configuration, authority, limits and operational setup.
- [x] Verify every development link against the pinned clean Harness source and built entry.
- [x] Pin the Workspace resource Slot overlay by base commit, file allowlist and SHA-256; reject all other Harness drift.
- [ ] Keep `private: true` until an ordinary clean-directory install and packed-artifact profile smoke pass without source links.

## Next product increments

- [ ] Add upstream node-result cache and stale markers to make iterative node tests cheaper and clearer.
- [ ] Add conditions, explicit Gates, retry/fallback edges and human approval only after the execution/checkpoint contract supports them.

## Definition of done

The source-linked implementation is locally complete when `pnpm verify` passes. Independent publication remains blocked until the dependency closure installs without local links and a packed artifact passes a real profile smoke.
