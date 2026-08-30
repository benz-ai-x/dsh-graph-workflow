# TODO

## P0 — Runtime foundation

- [x] Pin DeepSeek Harness `0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- [x] Create the Host Tool namespace plugin, Schemastery Config, bundle patch,
  Codex/Claude entries, stable-id Loader fixture, built-entry smoke, and
  packed-file check.
- [x] Bind development dependencies to the audited local Harness source.

## P1 — Business contract

- [x] Implement saved visual DAGs and accepted final delivery over `ctx.workflowEngine`.
- [x] Define structured workflow/input/run contracts and stable domain error codes.
- [x] Bind Remote mutations and execution to the exact live Agent; atomically commit definitions with CAS.
- [x] Define foreground/background cancellation, Agent/plugin disposal quiescence, concurrency and size limits.
- [x] Keep DAG/user content as data passed to a fixed script; enforce scoped Skill invocation policy.

## P2 — Verification

- [x] Add focused success, validation, failure, cancellation, and external-boundary tests.
- [x] Retain namespace-export, HMR, Remote mount and Fiber-disposal coverage.
- [x] Prove the real `cordis.yml` Loader path applies the configured storage location.
- [x] Assert the atomic store file from the filesystem and reopen it independently.
- [x] Exercise the visual editor, live node state, structured run form and final deliverable in jsdom.
- [ ] Install into a development profile and verify add, config dump, boot, behavior, and remove.

## P3 — Delivery

- [x] Document Model Experience, configuration, authority, limits and operational setup.
- [x] Verify every development link against the pinned clean Harness source and built entry.
- [ ] Keep `private: true` until an ordinary clean-directory install and packed-artifact profile smoke pass without source links.

## Definition of done

The source-linked implementation is locally complete when `pnpm verify` passes. Independent publication remains blocked until the dependency closure installs without local links and a packed artifact passes a real profile smoke.
