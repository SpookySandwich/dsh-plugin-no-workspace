# DSH 0.2.0-rc.2 compatibility

Reviewed on 2026-09-29 against the installed DSH `0.2.0-rc.2` desktop payload and the archived
`0.1.5-rc.2` packages. Both cores were extracted side by side and compared package by package.

The declared range keeps the existing `0.1.5` line verbatim and adds the new one:
`>=0.1.5-rc.2 <0.1.6-0 || ^0.2.0-rc.1`. The first clause is unchanged from v1.1.0, so no host that
was previously accepted is dropped. A plain upper bound such as `>=0.1.5-rc.2 <0.3.0-0` does
**not** admit `0.2.0-rc.2`, because semver excludes prerelease versions from comparator sets that do
not name a prerelease of the same `major.minor.patch` tuple; the same rule is why the union is
spelled out rather than widened. `0.1.6` alpha and the later `0.1.7` line remain unclaimed, matching
v1.1.0's conservative position.

## What did not change

- `conversation.hero.workspace` still registers `WorkspacePicker` with the same props
  (`open`, `anchorRef`, `useWorkspaces`, `selectedId`, `onPick`, `onClose`, `createWorkspace`,
  `useDirectoryFlow`, `renderSlot`, `t`). The picker still reads the bare snapshot through
  `useWorkspaces((state) => state)` and still selects with `Menu`'s `selectedId`.
- `sidebar` and `sidebar.workspaces` still register cells whose injected props carry
  `startSession(workspaceId)`, and `SidebarRoot` still calls `startSession()` with no argument.
- `conversation.composer.bar` still registers the same injected composer props. `InputBar`'s gate
  lines are byte-identical to 0.1.5 — `disabled: inert = false`, `const disabled = removed ||
  inert || !live || blocked !== void 0 || parentOffline`, `const workspaceTrigger = inert &&
  !removed && onRequestWorkspace !== void 0`, `const editorDisabled = removed || locked &&
  !workspaceTrigger`. The 0.2.0 extraction moved the scrollport into a new `DraftEditor` region,
  but that region reproduces the 0.1.5 markup exactly, including `aria-haspopup` and the
  workspace-trigger wiring.
- The workspace snapshot keeps `items`, `archivedSessionIds`, `state`, and `phase`; `pinnedSessionIds`
  is additive. `sessions.list` keeps `current`, `ids`, `phase`, and `byId`.
- Host-side APIs are unchanged: `workspaceRegistry.list()` returns the same entities,
  `WorkspaceEntity.sessionIds`/`detachSession()` are byte-identical, and
  `sessionController.create({ sessionId, cwd, agentPreset })` still returns `{ sessionId }`.
  0.2.0 adds a `workspaceId`/`cwd` mutual-exclusion guard that this plugin never trips, because it
  only ever passes `cwd`.
- The renderer still reads `entry.component` at render time, so swapping the component on the
  registered entry remains the supported adaptation, and `slots.inject()` still waits for an
  undeclared cell instead of failing — the 0.2.0-only cell below is therefore safe on 0.1.5.

## What 0.2.0 added, and what changed here

0.2.0 introduces two more routes into the native New Session action that never pass through the
cells this plugin wraps:

1. `shell.leading` (`HeaderLeadingControls`, new in ui-sidebar) renders the frame's window-chrome
   New Session control. It declares the same injected props as the sidebar. The plugin now patches
   this cell with the same adapter, so its button creates a standalone chat as well.
2. `dsh-client-shortcuts` adds a rebindable accelerator registry, and ui-workspace registers
   `session.new` (default `KeyN` with the primary modifier) to call workspace navigation directly.
   The registry throws on duplicate or overlapping ids, so the command cannot be replaced. The
   plugin instead reads the effective `session.new` row from the public `ctx.shortcuts.catalog`
   snapshot and consumes the matching keystroke on the window capture path, before DSH's own
   keydown dispatcher runs. The guard follows user rebinds, skips rows that DSH itself would not
   run (unbound, conflicting, errored, or disabled), requires an exact modifier match, ignores key
   repeats and composition, and stands down while a dialog or menu owns the keyboard — using the
   primitives' own `modalSelector`, so the guard never fires where DSH would refuse the command.

## Validation

`npm test` and `npm run check:package` pass on Node 24.15.0 (Windows): 88 robustness cases, 4 host
cases, 4 persistence cases, 1 client-loading case, and 9 client-interaction cases, including new
regression tests for the window-chrome control, the accelerator guard, exact modifier matching,
menu-owned keyboards, and the no-registry fallback.

`node --check` passes for both runtime entries, and `scripts/build-client.mjs --check` reports the
committed bundle is current.

The behaviours below are reasoned from the extracted 0.2.0 sources and are covered by unit tests
against a stubbed context, but they were **not** exercised against a live 0.2.0 desktop or web
runtime in this review:

- the accelerator guard's interception of DSH's `window` keydown listeners in a real browser;
- the `shell.leading` cell being mounted (0.2.0 mounts it only when the sidebar is collapsed on
  macOS desktop);
- visual acceptance of the sidebar's ungrouped-row treatment, which the 0.2.0 row markup changed
  around (`data-row-key`, the new `AnimatedRows` wrapper) without changing the `role="treeitem"`
  cells the plugin's CSS targets.

0.2.0 also adds a first-use default Workspace. It is created only when the registry has no
Workspace, no archived Session, and no Session header on disk, and the plugin's synthetic
"No Workspace" row is unaffected by it.
