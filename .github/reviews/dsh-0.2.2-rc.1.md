# Official DSH 0.2.2-rc.1 compatibility validation

Event: `compatibility:no-workspace:dsh-0.2.2-rc.1`.
Parent: `37a091ad-502c-43d6-bc7b-82d926144743`; Implementer thread: `ef39ab75-df2d-49ee-9bcb-b82239ec9fa2`.
Base and remote `main`: `aac22932560e6bb96e1b87c62b5ac6b46b241fdc` (checked before changes and before handoff).
Branch: `maint-20261106-no-workspace-37a091ad`.
Official tag: [`dsh-v0.2.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1), commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; npm `latest` and `next` both resolved to `0.2.2-rc.1` on 2026-11-06.

Runtime requirement correction after independent inspection: official `@deepseek-ai/dsh@0.2.2-rc.1` declares Node `>=24.9.0`. The Implementer's original latest-host runs below used Node `22.19.0` and are **unsupported-runtime baseline observations**, not supported-platform acceptance evidence. Older-host Node 22 results remain valid. Parent reports that Attacker Opus `c49719c9` subsequently ran actual packed-tarball acceptance on Node `24.19.0`: all 17 checks passed, exit code 0. That is Attacker's supported-runtime evidence, not an Implementer rerun or a completed independent verdict.

## Reproduction and change

A clean consumer declaring exact published `dsh-plugin-no-workspace@1.4.0` and `@deepseek-ai/dsh@0.2.2-rc.1` fails `npm install --package-lock-only --ignore-scripts --strict-peer-deps --no-audit --no-fund` with `ERESOLVE unable to resolve dependency tree`. The reported conflicting peer is `>=0.2.0-rc.2 <0.3.0-0 || 0.2.1-rc.2 || 0.2.1-rc.5`. Default npm semver does not admit the new prerelease through the broad stable range.

Add the explicit `|| 0.2.2-rc.1` arm to the peer, DSH engines, and root lock metadata. DSH itself uses `includePrerelease: true` in `app-boot/src/plugin-compatibility.ts`, so the observed failure is npm peer resolution, not a host loader refusal. Retain all three previously tested hosts.

Extend Windows browser CI to the fourth host and install the packed plugin together with the exact host using `--strict-peer-deps`, making the reproduced install failure an ongoing CI gate. Extend the real-runtime acceptance allowlist and run the existing Creator preservation and explicit keep/append/replace assertions for the new host. Initial English/Chinese checks missed the added host locales: independent Japanese UI review subsequently found B1, requiring the shipped client correction described below. Version remains `1.4.0` in this implementation stage; Writer owns the later release version and README/release-note changes.

Browser CI now selects Node per host: `0.2.2-rc.1` uses Node 24 (setup-node resolves the current 24.x release, satisfying the host's `>=24.9.0` floor); the three older hosts keep Node 22. The unit-test Node 22/24 matrix is unchanged. CI's strict peer step installs the packed plugin, but the acceptance fixture still junctions the repository checkout as its runtime plugin. Actual packed-entry runtime acceptance was performed separately by Attacker, as reported above; CI does not yet provide that packed-entry runtime check.

## API and published-package inspection

Compared targeted source files from official `dsh-v0.2.1-rc.5` and `dsh-v0.2.2-rc.1` and inspected corresponding installed npm JavaScript/type declarations. The targeted source snapshots under `$QA/upstream-source` are downloaded files, not another Git checkout.

- `ui-workspace/src/client/navigation.ts`: `startSession(workspaceId, options)`, `StartSessionOptions`, explicit workspace delegation, and retained binding/draft preparation remain compatible. New remote-access helpers and initial restoration cancellation do not change the adapter's calling convention. The plugin retains its documented fresh-default standalone New Session policy and selected-matching-blank Creator reuse policy.
- `ui-conversation/src/client/contract/input.ts`, `input/facade.ts`, and `input/hub.ts`: `DraftInitializationOptions` still carries `prompt`, `clearPreviousDraft`, and `whenDraftExists`; explicit keep/append/replace precedence is unchanged. The new sending phase is included in native initialization refusal. The plugin continues to use the native resolver and its refusal result. Quote insertion and model submission changes are outside this compatibility change.
- `ui-agent-preset/src/client/index.ts`: Creator's requested preset and selected-blank behavior remain the rc.5 contract. The real Settings Creator callback is exercised by acceptance, including preservation of a different-preset blank and reuse of the matching selected blank.
- `ui-workspace` picker, `rows/WorkspaceBrowser.tsx`, `rows/Rows.tsx`, and slot contracts: native menus/access helpers and animated rows changed; the stable `data-row-key="workspace:"` bucket and wrapped picker/composer slots still work. Actual English/Chinese screenshots, native workspace toggle, draft transfer, and detach checks passed.
- `api/session-controller/src/commands.ts`, `agent.ts`, client session management, and published controller bundle: `create` still accepts a named session, cwd and preset, returns the actual created/reused identity, and performs native durable creation. Internal model ownership and history/state controllers changed. The plugin still calls native creation rather than raw session storage.
- Workspace controller and `workspace/src/entity.ts`: detach still commits membership removal through the native workspace mutation path. Session-persistence adds optional location diagnostics; existing durability/stat behavior used in acceptance remains compatible. Fresh and detached blanks survived a real host stop/restart and reopening.

## Commands and results

All task changes and repository commands used the preassigned worktree. `$QA` is `C:/Users/charl/AppData/Local/Temp/opencode/dsh-20261106-37a091ad-no-workspace`; `$REPO` is `$QA/repo`. Runtime prefixes, package output, source snapshots and QA logs stay under `$QA`. QA `TEMP` and `TMP` are `$QA/tmp`. No existing DSH profile was used.

| Command/check | Result |
| --- | --- |
| `git rev-parse --show-toplevel HEAD`; `git status --short --branch`; `git ls-remote origin refs/heads/main` | Correct assigned worktree/branch, initially clean, local and remote base both `aac2293`; no integration needed |
| `npm ci` | PASS, 580 packages; existing audit reports 16 advisories (8 moderate, 8 high) |
| `npm test` | PASS: 4 host, 88 robustness, 1 client loading, 4 persistence, 49 client interaction, 2 acceptance-fixture tests; 148 total (`$QA/tests.txt`) |
| `npm run check:package` | PASS, real npm pack lifecycle, 8 shipped files |
| `npm run check:release-tools` | PASS, 4 tests |
| `node --test scripts/npm-publish.test.mjs` | PASS, 10 tests; no publication performed |
| `npm pack --pack-destination "$QA/packed" --json` | PASS, local `dsh-plugin-no-workspace-1.4.0.tgz` |
| `npm run check:release -- 1.4.0` | PASS, existing published release's npm gitHead/tag and matching npm/GitHub archives; does not claim this implementation is published |
| Clean exact published-package strict-peer reproduction above | Expected FAIL, ERESOLVE (`$QA/peer-before/result.txt`) |
| Strict packed-plugin install for all four exact hosts (command below) | PASS (`$QA/strict-peer-<version>.txt`) |
| `npm ci --ignore-scripts --no-audit --no-fund` after lock metadata update | PASS; dependency graph remains unchanged |
| `node scripts/build-client.mjs --check`; `git diff --check` | PASS |
| `semver.satisfies` assertions for all four hosts (default and `includePrerelease:true`), original range rejection of latest, manifest/root-lock equality, and rejection of `0.3.0` | PASS |

Runtime setup and peer validation, run for each version in `0.2.2-rc.1`, `0.2.1-rc.5`, `0.2.1-rc.2`, `0.2.0-rc.2`:

```powershell
npm install --prefix "$QA/runtime-$v" --save-exact --no-audit --no-fund "@deepseek-ai/dsh@$v"
npm install --prefix "$QA/runtime-$v" --save-exact --ignore-scripts --strict-peer-deps --no-audit --no-fund "@deepseek-ai/dsh@$v" "$QA/packed/dsh-plugin-no-workspace-1.4.0.tgz"
$env:TEMP = "$QA/tmp"
$env:TMP = "$QA/tmp"
$env:DSH_QA_MODULES = "$QA/runtime-$v/node_modules"
$env:DSH_QA_OUTPUT = "$QA/acceptance-$v"
node "$REPO/scripts/e2e/acceptance.mjs"
```

All four first Implementer acceptance runs exited successfully on Node `22.19.0`; the latest-host run is an unsupported-runtime baseline. Their outputs include `result.json`, `ownership.json`, `processes.json`, sanitized `host.log`, `sidebar.json`, `browser-isolation.json`, and screenshots under `$QA/acceptance-<version>/`. The commands above record those historical runs; use Node `>=24.9.0` for future latest-host execution.

| Official host | Checks and limits | First-run host PIDs / Edge PID |
| --- | --- | --- |
| `0.2.2-rc.1` | Unsupported Node 22 baseline: all 17 reported checks, including explicit draft policies with/without workspaces and Creator preset preservation | 51588, 103104 / 73972 |
| `0.2.1-rc.5` | Same applicable checks | 46764, 85864 / 45484 |
| `0.2.1-rc.2` | Applicable checks; native old Creator staging still changes the original blank's preset, explicitly accounted for by the existing acceptance contract | 31212, 22340 / 100512 |
| `0.2.0-rc.2` | Creation, sidebar/locales, shortcut, workspace navigation/draft transfer/detach, durability/reopen; newer Creator/draft-option contract not asserted | 63784, 68076 / 112588 |

Every run asserted zero browser errors. Every isolated Edge profile had zero accounts, signed-in profiles, installed user extensions and unexpected targets. Latest English and Chinese layout checks both observed a 1px separator, 31px heading space, visible standalone row and visible native workspace, with the synthetic Ungrouped header hidden.

Final sequential Implementer rerun after all installations completed: `node "$QA/run-final-acceptance.mjs"` exited successfully for all four versions on Node `22.19.0`, again an unsupported baseline for the latest host, with outputs `$QA/acceptance-final-<version>/`. This task-local wrapper runs the same acceptance script and records each runner PID before launch; it introduces no altered acceptance behavior. Wrapper PID 13088 and all child runners exited. Exact ownership is also in `$QA/acceptance-runners.json` and each output's `ownership.json`.

| Host | Runner PID | Host PIDs | Edge PID | Host ports / debug port | Removed home suffix |
| --- | --- | --- | --- | --- | --- |
| `0.2.2-rc.1` | 108296 | 112804, 111800 | 110308 | 58987, 55194 / 58993 | `gflT8l` |
| `0.2.1-rc.5` | 88020 | 94136, 44972 | 38652 | 63191, 61285 / 63192 | `IsFkIK` |
| `0.2.1-rc.2` | 53448 | 99516, 59564 | 107308 | 55345, 53402 / 55346 | `lGOUWD` |
| `0.2.0-rc.2` | 28072 | 87384, 9700 | 107644 | 51546, 61343 / 51547 | `S5SNs6` |

## Visible UI inspection

A separate official `0.2.2-rc.1` instance used `$QA/visible-qa.mjs` on unsupported Node `22.19.0`, runner PID 115748, host PID 12904 (child 27392), isolated home `$QA/tmp/dsh-no-workspace-e2e-NY8JVZ`, and origin `http://127.0.0.1:60696/`. These are historical baseline UI observations. Browser-control tab `tab-e0dfbd9d-01d4-4db9-ae9e-c78a781b2cfb` was created for this check and closed afterwards.

Through actual visible controls: acknowledged preview, dismissed account onboarding, clicked global New Session, typed `VISIBLE OFFICIAL DSH 0.2.2 QA DRAFT`, collapsed the native workspace, selected that workspace in the picker, and detached via No Workspace. Read-back confirmed the draft survived, the standalone editor had `contenteditable="true"`, and the selected standalone row was visible with 264×32px bounds, `display:flex`, `visibility:visible`, `opacity:1`. The section had its No Workspace heading and 1px border. Network capture observed `/no-workspace/detach` return HTTP 200. An immediate generic visibility observation during native row animation was false; the settled selected row and snapshot were visible without another click.

The browser connector exposed no screenshot/console callable in this session's catalog. Visual screenshot review therefore used the actual official-host acceptance screenshots captured by the repository's isolated Edge/CDP runner. Both English and Chinese screenshots were opened and visually inspected: native workspace, standalone separator/heading, selected row, No Workspace chip and composer were correctly laid out. Console-error assertions come from that runner, not from the visible connector check.

Tracked visual evidence: [English](assets/dsh-0.2.2-rc.1-en.png) and [Chinese](assets/dsh-0.2.2-rc.1-zh.png).

## Ownership, cleanup, and review

First-run disposable acceptance homes: `6Wgvml`, `vzEGbX`, `dHiR6Y`, `H6sa1M`, each prefixed `$QA/tmp/dsh-no-workspace-e2e-`. Each contains only the runner's fixture workspace/profile/browser and two junctions: profile `node_modules/@deepseek-ai` to the owned runtime scope and `node_modules/dsh-plugin-no-workspace` to the assigned repository. The acceptance `finally` stops host/browser trees and removes its own disposable home. The visible host tree was explicitly stopped; its two junctions were unlinked without traversing their targets. Its credential-free source fixture and sanitized log remain available under `$QA`; the retained isolated home is not a user profile and is not committed.

Final cleanup verification: `Get-Process` found none of the recorded first/final/visible host, browser, or final wrapper/runner PIDs; `Get-NetTCPConnection -State Listen` found none of their recorded host/debug ports; `Get-CimInstance Win32_Process` found no Node/Edge process referencing this task root. All eight acceptance homes were removed. The visible browser tab was closed and browser-control disabled before handoff. Only owned process trees were stopped; no user tree/junction target was traversed for cleanup.

Implementer environment: Windows, Node `22.19.0`, npm `10.9.3`, Microsoft Edge `156.0.4314.58`. Node 22 is unsupported by the latest host; Attacker's reported Node `24.19.0` packed-tarball run supplies the supported latest-host acceptance result. Tests used official npm DSH Web hosts. No remote model/provider was configured or called in the Implementer's runs: draft/preset composition and blank-session persistence are the exercised contract. No generated conversation history, native desktop, Linux, remote sharing/access restrictions, attachment submission, or unsent-draft persistence across a changed browser origin is claimed. Existing unit tests cover nonblank detach/history preservation with fixtures; the real runtime restart check covers blank identity/cwd/preset/membership and reopening.

For independent product review, use the retained exact runtime directories and the acceptance command above with a new owned `DSH_QA_OUTPUT`, selecting Node `>=24.9.0` for `0.2.2-rc.1`. Existing strict-peer install results above are retained as historical evidence. Source/API snapshots and `$QA/inspect-upstream.mjs` are retained for comparison. Repository files under `.github/reviews` are the durable handoff; thread metadata/transcript remain workflow state.

No README compatibility/changelog or version edit, no publication, and no changes to the main checkout or other repositories. No delegation, email, schedule, global-memory or watcher work. Home-thread app Git controls do not resolve this externally assigned worktree; Git commands use the exact absolute workdir, consistent with the prior review's documented workflow. No approval/tool-policy rejection occurred in the Implementer's original run.

## Focused CI Node correction and refusal boundary

Follow-up to implementation `70b1d7fc42788e48357898bac87ff538121cd270`: changed only browser CI Node selection and this validation record. Read-only inspection of the installed official manifest confirmed `engines.node: ">=24.9.0"`. Validation for this metadata revision uses YAML parsing/matrix inspection, installed host engine compatibility checks, generated-client consistency and Git whitespace/diff checks. Product JavaScript, compatibility admission and lock data are unchanged. No new runtime/UI run or independent PASS verdict is claimed for this metadata revision.

Focused validation passed: parsed the workflow with installed `js-yaml`; asserted the four host/Node pairs and setup-node's matrix reference; compared the full unit job and browser command bodies to `70b1d7f` for equality; checked Node `24.19.0` against the installed latest CLI's `>=24.9.0` requirement; confirmed product/manifest/lock/acceptance files have zero diff; ran `node scripts/build-client.mjs --check` and `git diff --check`. The first read-only validation attempt assumed every older CLI declared `engines.node` and threw a TypeError; the corrected inspection reports their absent CLI engine fields and preserves their previously tested Node 22 selection. No CI command body was executed by either inspection. No new QA host, browser, profile or runtime installation was created; prior Implementer cleanup inventory remains unchanged.

Parent reports automatic approval rejected Attacker's attempted `ci-step-negative.ps1` (matrix `0.2.1-rc.4`), then `ci-step-latest.ps1` (matrix `0.2.2-rc.1`), each launched with `pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File`. The rejection required STOP and wait and supplied no specific reason; partial execution occurred and is not proof. The optional materialized CI-step reproduction remains unrun/unverified as a validation claim. This follow-up does not execute, recreate or equivalently retry those commands, change ExecutionPolicy, or inspect/mutate Attacker scratch/output. Read-only workflow inspection is the alternative used here. This boundary is separate from the successful product acceptance reported by Attacker.

## B1 semantic composer-chip correction

Independent Attacker review returned FAIL after observing Japanese `ワークスペースを選択` on a standalone composer, with the native aria-label and no `data-dsh-nw-chip`. Its earlier 17-check Node 24 packed acceptance is historical evidence, not an independent PASS for this fix. The previous implementation recognized only English/Chinese placeholder text, which also confused real workspace titles with the standalone label.

The wrapper now registers the native `conversation.hero.workspace` picker `anchorRef` and `selectedId` through a DOM-free React marker component. These native props identify the exact chip and its optimistic selection without translated text matching. The observer remembers native label/aria changes and restores them for real workspaces and disposal, while preserving React's text node. Chinese still uses the existing `无工作区`; all other locales use the existing English fallback. No translation catalog was added. The generated `lib/client.js` is rebuilt from `plugin.client.js`.

Failed-before proof: `node --test test/client-interactions.test.mjs` against prior product source produced 49 passes and six failures (`$QA/b1-regression-before.txt`). Japanese expected `No Workspace` but actually retained `ワークスペースを選択`; the five title cases also failed. With the correction, the same 55 tests pass (`$QA/b1-regression-after.txt`), including live locale changes, exact native text/aria restoration on disposal, detachment, unrelated menu buttons, and real titles `No Workspace`, `Choose workspace`, `无工作区`, `选择工作区`, and `研究資料`.

Updated-source checks: `npm test` passes all 154 tests (`$QA/b1-tests.txt`); `npm run check:package` verifies eight shipped files; `npm run check:release-tools` passes four tests; `node --test scripts/npm-publish.test.mjs` passes ten. Package/lock metadata and the Node 24 latest-host CI selection have no changes in this round. No publication helper was used to publish.

Runtime runner: `node "$QA/run-b1-acceptance.mjs" <suffix> [versions...]` invokes the actual repository acceptance fixture on official installed hosts, using existing read-only `mise/installs/node/24.19.0/node.exe` for latest and `22.19.0/node.exe` for older hosts. It records wrapper/child PIDs in `$QA/b1-<suffix>-runners.json`. Like CI, this runtime fixture loads the checkout through its owned junction; the package check separately verifies the packed artifact. This was the Implementer's interim fixture validation prior to Attacker Opus Round 2's packed-entry runtime verification detailed below.

Initial supported latest run (`$QA/b1-initial-0.2.2-rc.1`) passed the new locale/title/reload assertions but failed the final zero-console-error gate with `Sidebar Session opening failed: ... Session reference ... is released`. The new title loop had waited only for membership removal, which can precede the detach response and native reopen. Acceptance now waits for the response and open completion before the next workspace operation. The failure artifacts remain retained; errors are not filtered or waived. Reload screenshots also exposed the native account prompt reopening, so the fixture dismisses that prompt before capturing the final Japanese screenshot.

### First Node 24 failure: exact evidence and causal limits

The initial run exited **1**. Its exact captured console entry is:

```text
[error] Sidebar Session opening failed: Error: Session reference "session-83d86236-ac6b-492e-91b2-4001a116b7e2" is released
    at ClientSessionReference.release (http://127.0.0.1:61480/plugins/??@deepseek-ai/dsh-client-ui-settings-subagent/client.js,@deepseek-ai/dsh-client-ui-settings-web-search/client.js,@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-ui-user-questions/client.js,@deeps
```

The trailing `@deeps` is the actual end of the retained entry, not an editorial abbreviation. The existing driver truncates console arguments to 400 characters before storing them (`scripts/e2e/driver.mjs:42`). A full original stack or timestamped navigation trace was not captured and cannot be reconstructed. `$QA/b1-initial-0.2.2-rc.1/failure.json`, its failure screenshot, chip checks, ownership, sanitized host log and companion `.txt` remain intact. The error's session ID matches the first added unusual-name detach request in that file.

Verified source path in the installed official `0.2.2-rc.1` packages:

1. `dsh-client-ui-sidebar-right/lib/client.js:1982` allocates an independent `sidebarView` reference. Its `ready.catch` at line 1984 logs **every** readiness rejection as `Sidebar Session opening failed:`.
2. Native `SidebarSessionViews.select` prunes the old view when selection changes (lines 2056–2069, 2091–2095). A view with no retained tabs is retired and, after its mounts finish, disposed; disposal releases its reference (lines 2025–2035).
3. `dsh-api-session-controller/lib/types/client/sessions/service.js:126` creates the exact `Session reference "…" is released` error, aborts the reference waiter and rejects its readiness promise. Releasing an already-ready reference leaves the settled promise fulfilled; releasing a pending reference enters the sidebar's error handler.
4. The plugin's existing detach path snapshots the current ID, awaits `/detach`, then calls native `openSession(current)` (`plugin.client.js:195–205`). The old added loop observed membership removal and chip text only. Those observations do not prove that the HTTP response/reopen and associated native reference initialization have finished, so the loop could advance into another native workspace start during an unfinished transition.

A focused Node `24.19.0` diagnostic, `$QA/b1-native-reference-diagnostic.mjs`, evaluates the **unchanged installed** `ClientSessionReference` and `SidebarSessionView` classes without loading the plugin. Retiring a view while its opening promise is pending reproduces `Sidebar Session opening failed: Error: Session reference "diagnostic-native" is released`; awaiting `reference.ready` before retiring yields no log. Both assertions pass, exit **0**, recorded in `$QA/b1-native-reference-diagnostic.json`. This proves the native lifecycle mechanism, not the uncaptured original interleaving. It also means a claim that arbitrary interrupted/rapid native navigation is now error-free would be unsupported.

The corrected acceptance adds bounded state waits for `pendingRequests.size === 0` and the native binding's `openState === 'open'` before the next named-workspace operation. These are completion conditions for the intended sequential select/detach scenarios, not a fixed sleep, error suppression, request stub or change to navigation behavior. The complete-run `assert.deepEqual(driver.appErrors(), [])` remains unchanged and receives logs across every locale change and reload. No source defect in the semantic chip implementation was identified by this failure; no fix to the host's interrupted-open cancellation logging is claimed. The passing matrix supports completed-navigation B1 acceptance, with the rapid-navigation limitation retained for independent review.

### Corrected matrix and handoff

`node "$QA/run-b1-acceptance.mjs" final` completed with these individually inspected runner exit codes and result files:

| Official host | Node | Runner PID | Exit | Result |
| --- | --- | --- | --- | --- |
| `0.2.2-rc.1` | `24.19.0` | 84516 | 0 | `b1-final-0.2.2-rc.1/result.json`: `ok:true`, 19 checks, 45 chip observations, zero browser errors |
| `0.2.1-rc.5` | `22.19.0` | 64196 | 0 | `b1-final-0.2.1-rc.5/result.json`: `ok:true`, 17 checks, zero browser errors |
| `0.2.1-rc.2` | `22.19.0` | 26248 | 0 | `b1-final-0.2.1-rc.2/result.json`: `ok:true`, 15 checks, zero browser errors; existing old Creator staging distinction retained |
| `0.2.0-rc.2` | `22.19.0` | 103608 | 0 | `b1-final-0.2.0-rc.2/result.json`: `ok:true`, 11 checks, zero browser errors |

Latest `chip-checks.json` records English/Chinese/Japanese/Spanish/French/German/Russian/Portuguese label, aria-label, marker presence, nonzero width and icon mask after live switching, switching on an actually detached session, new sessions and same-origin reloads. Reload assertions also preserve each locale's draft. Actual real-workspace selection tests cover `No Workspace`, `Choose workspace` and `研究資料`, asserting absence of standalone marking and native aria-label restoration, followed by detachment. English/Chinese title collisions are also covered by the five unit cases. All eight locale sidebar assertions observe a 1px separator, 31px heading space, visible native workspace and standalone row.

Final supported-runtime Japanese reload and Chinese layout screenshots were opened and visually inspected. The Japanese reload shows the standalone icon/English fallback and preserved `LOCAL CHIP QA ja` draft, with no account modal obscuring the composer. Tracked evidence: [Japanese layout](assets/dsh-0.2.2-rc.1-b1-ja.png) and [Japanese reload](assets/dsh-0.2.2-rc.1-b1-ja-reloaded.png). Remaining locale screenshots and full result files remain under `$QA/b1-final-<version>`.

Cleanup at **2026-11-06 16:53:20 UTC** verified no surviving process among the 22 recorded initial/final wrapper, runner, host and browser PIDs; no listeners on their 15 host/debug ports; and no remaining home among the five disposable profiles (including their owned junctions). `$QA/b1-cleanup.json` retains the exact inventory and zero-residue result. Both matrix wrappers exited. Latest browser isolation reports zero accounts, signed-in profiles, installed extensions and unexpected targets. Runtime installations and sanitized review evidence remain available; Attacker scratch was not inspected or changed.

Review the semantic anchor/selection mapping and native text restoration first, then reproduce Japanese live switching/detach/new-session/reload and real workspace label collisions. The corrected matrix above was the Implementer handoff baseline; independent Attacker Opus Round 2 subsequently completed full verification and returned PASS on exact HEAD `5b3ac1c`, as documented below. The optional refused CI commands remain unrun/unverified. No README, version, changelog, publication, other repository or main-checkout change occurred in that stage. Git UI refresh succeeds using project `11b87d93-be55-43ae-8bba-beef549f189f` and the exact assigned worktree.

## Independent Attacker (Opus Round 2) verification and PASS verdict

Attacker Opus (`c49719c9-7786-45f4-8288-be51410a0c85`, Round 2) conducted an independent verification of exact HEAD `5b3ac1cb404b04b2b79b3298688611a2a95b3486` (Astra Implementer `ef39ab75-df2d-49ee-9bcb-b82239ec9fa2` stopped) and returned an unconditional **PASS**.

### Test and package integrity checks

- Unit and integration tests: 154/154 passed across both Node `24.19.0` and Node `22.19.0` (`$QA/attacker/r2/npm-test-node24.txt` and `$QA/attacker/r2/npm-test-node22.txt`).
- Release-tool checks: 4 tests passed (`npm run check:release-tools`).
- Publication helpers: 10 tests passed (`node --test scripts/npm-publish.test.mjs`).
- Package verification: `npm run check:package` verified 8 shipped files.
- Build and diff clean: `node scripts/build-client.mjs --check` and `git diff --check` passed cleanly.
- Fresh packed source: 7 files byte-identical with package fields unchanged and verified.

### Official packed runtime acceptance (Edge / CDP headless)

All four official DSH host runtimes were executed against the packed plugin tarball (`dsh-plugin-no-workspace-1.4.0.tgz`), rather than a checkout junction:

| Host | Runtime Node | Runner Exit | Checks / Observations / Errors | Result |
| --- | --- | --- | --- | --- |
| `0.2.2-rc.1` | `24.19.0` | 0 | 19 checks, 45 chip observations across all 8 languages, 0 bad, 0 browser errors (`$QA/attacker/r2/acceptance-packed-0.2.2-rc.1.out`) | **PASS** |
| `0.2.1-rc.5` | `22.19.0` | 0 | 17 checks, 0 browser errors (`$QA/attacker/r2/acceptance-packed-0.2.1-rc.5.out`) | **PASS** |
| `0.2.1-rc.2` | `22.19.0` | 0 | 15 checks, 0 browser errors (`$QA/attacker/r2/acceptance-packed-0.2.1-rc.2.out`) | **PASS** |
| `0.2.0-rc.2` | `22.19.0` | 0 | 11 checks, 0 browser errors (`$QA/attacker/r2/acceptance-packed-0.2.0-rc.2.out`) | **PASS** |

- Negative control: Old JS implementation without the B1 fix was run against the latest host fixture (`acceptance-neg`); it reproduced the failure on the live Japanese semantic chip, verifying regression detection capability.
- Sidebar and layout checks across all 8 host locales observed the expected 1px separator, 31px heading space, hidden native header, visible native workspace + standalone row, and nonzero icon width.
- Live English real workspace names (`No Workspace`, `Choose workspace`, and `研究資料`) showed no false standalone marking, with native aria attributes correctly restored before and after detachment.
- Local unit test React restoration: 8/8 assertions passed for pending selection, live locale changes, unmounting, and disposal. Japanese reload and Russian images read correctly.
- These headless browser checks provide the real runtime proof; no additional manual Poracode-pane check is required.

### Honest boundaries and limits

- Older host UI remains English / Chinese only; unusual workspace titles are verified live in English and in unit tests for other locales.
- Unload behavior is verified via unit tests only.
- No claims are made for Desktop Electron wrappers, Linux hosts, remote model/provider integrations, or conversation history migration.
- Node 24 / npm 11 installation path receives ongoing validation through committed GitHub CI.

### Minor non-blocking observations

- Pre-existing late-detach reopen race if navigation occurs before HTTP response settles (recoverable; causes no data loss).
- Cosmetic picker row label collision if a real Chinese workspace is named `No Workspace`.
- Unreachable first anchor replacement cleanup candidate in client logic.
- Documented distinction between CI e2e checkout junction and strict packed install.
- The fix scope is deliberately kept minimal; no claim of error-free rapid navigation is made.

### Probe timing classification and limits

- Diagnostic probe 4th cycle 8-second timeout was classified as SOURCE + unit: the probe considered state settled prior to the HTTP detach response, leading unchanged `selectNoWorkspace` to await followed by `openSession(current)` late pullback. In the normal response-awaited flow, real packed execution across 4 distinct detaches passed with zero errors.
- Because raw probe output was deleted by the reviewer and state predicate failure was uncaptured, exact original timing remains unproven.
- Native comparison with `distinct:false` yielding 0 errors was invalid as comparative evidence. While the native class mechanism for release errors was reproduced without the plugin, the specific timing interleaving remains unproved.

### Explicit refusal boundaries

- Optional materialized CI negative / latest `pwsh -ExecutionPolicy Bypass` diagnostic commands and the `rapid.mjs` off/on probe were refused/unrun/unverified.
- Per policy, these optional diagnostics were not retried or bypassed. Normal user-authorized GitHub Actions CI and trusted npm publication rely exclusively on committed workflows and procedures.
