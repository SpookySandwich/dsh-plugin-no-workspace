# Official DSH 0.2.1-rc.5 compatibility validation

Task: `compatibility:no-workspace:dsh-0.2.1-rc.5`, parent `958082a1-5af9-4de3-b71e-662620ee8845`.
Source base: `f8fb9ef6f060e4274aac4c98c3cf6b90b0669dfa`. Plugin version bumped to 1.4.0 for release.
Upstream: `deepseek-ai/deepseek-harness`, tag `dsh-v0.2.1-rc.5`, verified commit `b830ec950faba0a46dda564be3e2d854afed94f1`.

## Reproduction and root causes

1. A clean consumer with exact published dependencies `@deepseek-ai/dsh@0.2.1-rc.5` and `dsh-plugin-no-workspace@1.3.1` fails ordinary npm dependency resolution with `ERESOLVE`. The old range excludes rc.5 under default prerelease semantics. DSH's own `packages/boot/app-boot/src/plugin-compatibility.ts` uses `includePrerelease: true`, under which the old engines range already accepts rc.5. This is an npm peer admission fix, not a newly discovered host loader rejection.
2. The real rc.5 Settings Agent Preset Creator callback no longer stages a different-preset main blank, and native workspace navigation skips such blanks. The plugin still named the selected standard blank in `/no-workspace/create`, changing it to `cordis`. The pre-fix official browser acceptance reached Creator after passing creation, locale/layout, explicit workspace navigation, shortcut, draft transfer, and detach, then failed `creator preserves different-preset blank`. The failure screenshot showed the same draft in Creator mode.
3. rc.5 `DraftInitializationOptions` adds `whenDraftExists` with keep/append/replace semantics and precedence over `clearPreviousDraft`. The adapter dropped that option, did not initialize promptless replacement, and coalesced requests with different policies. Six focused regression cases failed against the original client (43 passed, 6 failed).

## Changes and inspected upstream behavior

- Add an explicit `0.2.1-rc.5` arm to peer/engines ranges and root lock metadata; retain both previously tested versions.
- Reuse only the selected eligible standalone blank whose listed preset matches the requested preset (or is unknown), intentionally checking the current selected blank only (unlike native which can search across other workspace blanks) to avoid jumping to background standalone sessions. The plugin no longer asks the host to change a different-mode blank's preset (see the older Creator staging limitation below). Plain global New Session continues the plugin's existing fresh-default-blank behavior (while native rc.5 workspace navigation reuses workspace blanks, intentional standalone policy keeps chats fresh); explicit workspace requests still delegate directly to native navigation, including rc.5's new workspace blank reuse behavior.
- Forward explicit draft policy to the native resolver, honor promptless replacement and explicit-policy precedence, and include the policy in concurrent-request identity. No new plugin UI or model execution path is introduced.
- Expand official browser acceptance and Windows CI to all three supported runtime versions. Add actual host restart, immediate durable-blank storage checks, detached membership checks, and reopening after the restarted session feed arrives.
- Reviewed rc.2-to-rc.5 source diffs and corresponding published runtime code for `ui-workspace/navigation.ts`, Agent Preset Creator/seat changes, conversation input facade/contract, and conversation header/view changes. The workspace picker, workspace rows, host Session Controller create transaction, and workspace entity detach implementation have no diff across those tags. The new conversation view pin/More-menu code is outside the slots this plugin wraps; no runtime change there was required by the tested blank-conversation flow.

## Commands and evidence

All commands ran in the owned checkout. Scratch root (abbreviated below as `$QA`):
`C:/Users/charl/AppData/Local/Temp/opencode/dsh-rc5-no-workspace-958082a1-d142fa2f`.
The checkout is `$QA/repo`. Runtime installations and npm cache are under `$QA`; `TEMP` and `TMP` for QA point to `$QA/tmp`.

- `npm ci` passed at the base; `npm install --package-lock-only --ignore-scripts` updated only root compatibility metadata; final `npm ci --ignore-scripts` passed. Original dependency audit reported 16 advisories (8 moderate, 8 high); no unrelated dependency upgrades were made.
- `node --test test/client-interactions.test.mjs` before the fix: six failures, saved in `$QA/regression-before.txt`.
- `npm test`: host 4, robustness 88, client loading 1, persistence 4, client interactions 49; all 146 tests passed (`$QA/tests.txt`).
- `npm run check:package`: real pack lifecycle passed, 8 shipped files (`$QA/package-check.txt`). `npm pack --pack-destination ../packed --json` produced the local tarball.
- `npm run check:release-tools`: 4 passed; `node --test scripts/npm-publish.test.mjs`: 10 passed. These are local checks, not publication (`$QA/release-tools.txt`, `$QA/npm-publish-tests.txt`).
- Default-peer install reproduction: `npm install --package-lock-only --ignore-scripts` in `$QA/peer-before`, exact published dependencies, failed `ERESOLVE` (`result.txt`). The same command in `$QA/peer-after`, using the newly packed local tarball and exact rc.5, passed without force or legacy-peer flags (`result.txt`, `package-lock.json`).
- Default semver checks pass for `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.5`; host checks with `includePrerelease: true` also pass. `node scripts/build-client.mjs --check` and `git diff --check` passed.

Acceptance command per runtime: set `DSH_QA_MODULES=$QA/runtime-<version>/node_modules`, `DSH_QA_OUTPUT=$QA/acceptance-<version>`, and `TEMP=TMP=$QA/tmp`, then run `node scripts/e2e/acceptance.mjs`. Install each runtime using `npm install --prefix <owned-prefix> --save-exact @deepseek-ai/dsh@<exact-version>`.

- Official rc.5 acceptance PASS: `$QA/acceptance-rc5/result.json`, `host.log`, `sidebar.json`, `sidebar-en.png`, `sidebar-zh.png`, `acceptance.png`, `processes.json`. Includes Creator preservation and same-preset reuse, explicit keep/append/replace precedence with and without workspaces, actual host restart/reopening, and zero browser errors. Final host PIDs 101756 and 75544; Edge PID 77872. Local origins: `http://127.0.0.1:52129` and `http://127.0.0.1:64182`.
- Official 0.2.0-rc.2 acceptance PASS: `$QA/acceptance-020rc2/result.json` and companion evidence. Host PIDs 94496 and 17112; Edge PID 14712. Includes creation, sidebar layout/locales, native shortcut, workspace navigation/draft transfer/detach, host restart/reopen and zero browser errors. Creator/draft initialization options are not asserted on this older runtime.
- During restart-harness development, early attempts navigated before the catalog or cold open completed, and compared optional header defaults byte-for-byte. The final test waits for listing and `openState === 'open'` and compares stable identity/cwd/preset fields. These failed harness attempts are not counted as acceptance passes.
- Visual inspection of rc.5 English and Chinese screenshots confirms the standalone heading and separator, native workspace row, No Workspace chip and editable composer. Computed layout checks report 1px separator and 31px heading space for both locales. Browser: Microsoft Edge 156.0.4314.50.

The 0.2.1-rc.2 native Creator callback stages `cordis` on its selected standard blank before calling navigation (confirmed in the upstream diff and real browser). That upstream staging can still change the original blank's preset, even though the updated plugin creates a different blank rather than naming a mismatched preset. The old-runtime test explicitly records this limitation; preservation of a different-preset original blank is guaranteed by the tested Creator flow on rc.5. No version-sniffing override of native preset seats was added.

- Official 0.2.1-rc.2 acceptance PASS: `$QA/acceptance-021rc2/result.json` and companion evidence. Host PIDs 25528 and 97288; Edge PID 93388. Origins `http://127.0.0.1:63910` and `http://127.0.0.1:56465`. All applicable functional checks and zero browser errors passed, with the native Creator staging limitation above explicitly recorded.
- Final rc.5 acceptance rerun after tightening all navigation waits PASS: `$QA/acceptance-rc5-final/result.json` and companion evidence. Host PIDs 104752 and 93180; Edge PID 74012. Origins `http://127.0.0.1:63911` and `http://127.0.0.1:56466`. The prior rc.5 successful evidence is retained too.
- The older right-sidebar logs a released-reference error when an open is superseded before completion. The acceptance harness now waits for the native session's `openState` alongside the workspace chip and for the repeated Creator request response. No console-error suppression was added. Earlier failed attempts are not passing evidence.
- All owned host/browser process trees were stopped by the acceptance `finally` cleanup. Final process inspection found no Node/Edge process referencing the task root; all recorded final PIDs were absent. Disposable `dsh-no-workspace-e2e-*` profiles were removed. Runtime prefixes, logs, screenshots, packed tarball and source inspection clone remain under `$QA` for review. The shared worktree remains intact.

## Limits and handoff

Windows, Node 22.19.0, npm 10.9.3, official npm DSH Web runtimes, isolated headless Microsoft Edge profiles, and the repository's existing CDP acceptance driver. No native desktop or remote model was tested; no prompt was submitted to a provider. Drafts and preset composition were exercised locally. Restart checks cover blank-session durability, stable header fields, detached membership and reopening; they do not claim generated conversation history or unsent-draft persistence across a browser-origin change. Nonblank conversation view pinning/overflow was source-reviewed, not exercised with model output.

- Acceptance cleanup harness: existing acceptance cleanup stop may return early if Edge launcher exits/relaunches under `__COMPAT_LAYER=DetectorsAppHealth` (causing potential EBUSY during directory cleanup). All orphan Edge processes were terminated. Record this harness limitation and execute tests in a safe, clean environment.
- UI and navigation limits: More menu creation was verified through the identical `uiWorkspace.startSession` API contract rather than direct mouse clicks on the menu button; multiple workspaces behavior was verified via code inspection and runtime API contracts. No unsolicited UI/sidebar functional changes were introduced after PASS.

README compatibility/changelog text and package version were completed by the Writer. No PR, issue/comment, email, schedule, or child delegation was performed. The main checkout and its untracked reviews were not edited. External-worktree Git operations use exact-path CLI because Home app Git controls cannot resolve this tree.
