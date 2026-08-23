<div align="center">

# No Workspace for DSH

**让会话保持独立，而不是被迫塞进一个文件夹。**

[English](README.en.md) · 简体中文

[![npm](https://img.shields.io/npm/v/dsh-plugin-no-workspace?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-plugin-no-workspace)
[![Release](https://img.shields.io/badge/release-v1.0.0-5b8cff?style=flat-square)](https://github.com/SpookySandwich/dsh-plugin-no-workspace/releases/tag/v1.0.0)
[![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-23272f?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Tests](https://img.shields.io/badge/tests-88%20passed-36b37e?style=flat-square)](#验证)
[![License](https://img.shields.io/badge/license-MIT-f0b429?style=flat-square)](LICENSE)

为 DeepSeek Harness 添加真正的一等「无工作区」会话，同时保留原生工作区体验。

![No Workspace 演示](assets/no-workspace-demo.gif)

*从工作区中选择「无工作区」；即使随后收起工作区，独立会话仍直接显示在侧边栏。*

</div>

## 它解决什么

DSH 原本会把每个会话放进工作区，或显示在一个额外的「未分组」文件夹中。这个插件把“未绑定工作区”变成真正的一等状态：独立会话直接出现在侧边栏，不显示虚构的「未分组」目录，也不会偷偷继承当前工作区。

| 场景 | 安装后 |
| --- | --- |
| 点击顶部「新建会话」 | 创建独立会话，不继承当前或最近使用的工作区 |
| 在工作区选择器中选择「无工作区」 | 将当前会话无损移出工作区 |
| 收起真实工作区 | 独立会话仍作为一级会话显示 |
| 打开独立空白会话 | 输入、模型选择、附件与发送立即可用 |
| 使用原生工作区功能 | 搜索、菜单、拖放、排序、归档和目录选择保持不变 |

## 安装

```bash
dsh plugin --profile desktop add dsh-plugin-no-workspace
```

从本地源码或打包文件安装：

```bash
dsh plugin --profile desktop add ./dsh-plugin-no-workspace
# 或
dsh plugin --profile desktop add ./dsh-plugin-no-workspace-1.0.0.tgz
```

安装或升级后重启 DSH，使宿主端和客户端代码同时重新加载。

## 设计原则

- **不替换原生侧边栏**：插件包装 DSH 已注册的槽位，而不是重写整套导航。
- **不伪造文件夹**：只隐藏独立会话外层的「未分组」容器；真实工作区仍保留原生文件夹结构。
- **不损坏历史**：解绑只更新工作区会话索引，完整保留会话事件、草稿与上下文。
- **不污染执行目录**：新独立会话使用用户主目录作为中性的执行目录。
- **不破坏语言体验**：界面随 DSH 显示「无工作区」或 “No Workspace”。

## 工作方式

宿主端提供创建独立会话和无损解绑的轻量路由；客户端只改变三处行为：通用新建会话、独立会话的 composer 门禁，以及原生工作区选择器。图标、箭头、菜单定位和会话行继续沿用 DSH 的原生布局与交互。

## 验证

```bash
npm test
npm run test:e2e
```

测试覆盖 88 个单元与健壮性用例，以及真实 DSH desktop profile 上的独立会话创建、输入与模型选择、工作区切换、草稿迁移、解绑、侧边栏展平和原生菜单行为。E2E 结束后会恢复工作区存储并删除测试会话。

## 兼容性

已针对 DSH `0.1.1-rc.2` 验证，并可与 `dsh-plugin-message-edit`、`dsh-plugin-marginalia`、`dsh-plugin-rollout-scout` 等客户端插件共存。

## License

[MIT](LICENSE) © SpookySandwich
