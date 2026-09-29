<div align="center">

# No Workspace for DSH

**Let a conversation stand on its own instead of forcing it into a folder.**

English · [简体中文](README.md)

[![npm](https://img.shields.io/npm/v/dsh-plugin-no-workspace?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-plugin-no-workspace)
[![CI](https://github.com/SpookySandwich/dsh-plugin-no-workspace/actions/workflows/ci.yml/badge.svg)](https://github.com/SpookySandwich/dsh-plugin-no-workspace/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SpookySandwich/dsh-plugin-no-workspace?style=flat-square)](https://github.com/SpookySandwich/dsh-plugin-no-workspace/releases/latest)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-23272f?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT-f0b429?style=flat-square)](LICENSE)

True first-class workspace-free conversations for DeepSeek Harness, without replacing its native workspace experience.

![No Workspace demo](assets/no-workspace-demo.gif)

*Choose “No Workspace”, then collapse the real workspace—the standalone conversation remains directly in the sidebar.*

</div>

## What it fixes

DSH normally places every conversation in a workspace, or renders unassigned conversations under an extra “Ungrouped” folder. This plugin makes “not attached to a workspace” a real first-class state: standalone conversations appear directly in the sidebar, without a synthetic folder and without silently inheriting the active workspace.

| Scenario | With this plugin |
| --- | --- |
| Click the global **New Session** button | Creates a standalone conversation without inheriting a workspace |
| Choose **No Workspace** in the native picker | Detaches the current conversation without losing history |
| Collapse a real workspace | Standalone conversations remain visible at the top level |
| Open an empty standalone conversation | Composer, model picker, attachments, and send are immediately available |
| Use native workspace features | Search, menus, drag-and-drop, sorting, archive, and directory selection remain intact |

## Install

```bash
dsh plugin --profile desktop add dsh-plugin-no-workspace
```

Install from a local checkout or package:

```bash
dsh plugin --profile desktop add ./dsh-plugin-no-workspace
# or
dsh plugin --profile desktop add ./dsh-plugin-no-workspace-1.1.0.tgz
```

Restart DSH after installing or upgrading so both host and client code reload.

## Design principles

- **Keep the native sidebar** — wrap DSH's registered slots instead of replacing navigation.
- **Never invent a folder** — hide only the synthetic “Ungrouped” container; real workspaces retain their native structure.
- **Preserve conversation data** — detaching updates only workspace indexes, keeping events, drafts, and context intact.
- **Use a neutral working directory** — new standalone conversations start from the user's home directory.
- **Respect the current language** — the UI follows DSH with “No Workspace” or “无工作区”.

## How it works

The host adds small endpoints for standalone creation and lossless detaching. The client changes only three behaviors: global session creation, the composer gate for standalone sessions, and the native workspace picker. Icons, disclosure arrows, menu placement, and session rows continue to use DSH's native layout and interactions.

## Verification

```bash
npm ci
npm test
npm run check:package
```

Automated tests cover host behavior, client loading and persistence. Optional `npm run test:e2e` requires a fresh `dsh-no-workspace-e2e-*` directory under the system temporary directory as `DSH_HOME`, and `DSH_CLI_ENTRY` pointing to the official CLI JavaScript entry. Install the test profile separately; the runner refuses the regular DSH home.

## Compatibility

Version `1.2.0`: Load on official dsh `0.2.0-rc.2`. Session creation still goes through the native Session Controller, and detach still calls `workspace.detachSession`.

Version `1.1.0`: Create durable standalone chats through the native Session Controller. Adapt sidebar component props instead of cached injection results, including the split workspace sidebar.

The declared host range is `>=0.2.0-rc.2 <0.3.0-0`; official dsh `0.2.0-rc.2` satisfies it. Keep the previous plugin release on older DSH. [Validation record](.github/reviews/dsh-0.1.5.md).

Download the archive from the [GitHub Release](https://github.com/SpookySandwich/dsh-plugin-no-workspace/releases/tag/v1.2.0), then run `dsh plugin --profile desktop add ./dsh-plugin-no-workspace-1.2.0.tgz`.

This release targets DSH `0.2.0-rc.2`. Run `npm ci`, `npm test`, and `npm run check:package` to verify the build and package. Restart DSH after updating.


Version `1.1.0` checked standalone persistence and workspace detachment on DSH `0.1.5-rc.2`. Automated tests cover client loading.

## License

[MIT](LICENSE) © SpookySandwich
