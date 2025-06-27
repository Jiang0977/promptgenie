# PromptGenie 项目总览 (飞书同步增强版)

> **项目说明**
> 本项目 Fork 自 [ChrisZou/promptgenie](https://github.com/ChrisZou/promptgenie)，并由 [Jiang0977](https://github.com/Jiang0977) 在其基础上增加了核心的**飞书多维表格双向同步**功能。本文档旨在为该增强版提供技术和入门参考。

欢迎来到 PromptGenie！这是一个基于 Tauri 构建的、功能强大的桌面应用，旨在帮助您高效地管理、组织和使用您的 AI 提示词（Prompts）。

![App Screenshot](https://raw.githubusercontent.com/Jiang0977/promptgenie/main/assets/app_screenshot_v0.1.0.png)

## ✨ 核心功能

- **集中管理**: 在一个地方创建、编辑、搜索和组织您所有的提示词。
- **标签系统**: 使用可自定义颜色和名称的标签对提示词进行分类，方便快速查找。
- **收藏夹**: 一键收藏您最常用或最重要的提示词。
- **飞书多维表格同步**: 与飞书多T维表格无缝集成，实现提示词库的云端备份和团队协作。
- **系统托盘快速访问**: 通过系统托盘菜单，快速访问最近使用的提示词，并一键复制到剪贴板。
- **跨平台**: 基于 Tauri v2 构建，可在 Windows, macOS, 和 Linux 上运行。

## 🚀 快速入门

### 环境要求

- [Node.js](https://nodejs.org/en/) (推荐使用 pnpm 作为包管理器)
- [Rust](https://www.rust-lang.org/tools/install) 环境

### 安装与运行

1.  **克隆仓库**
    ```bash
    git clone https://github.com/Jiang0977/promptgenie.git
    cd promptgenie
    ```

2.  **安装前端依赖**
    ```bash
    pnpm install
    ```

3.  **启动开发环境**
    在项目根目录下运行以下命令，Tauri CLI 会同时启动前端 Vite 开发服务器和后端 Rust 应用。
    ```bash
    pnpm tauri dev
    ```

### 构建应用

运行以下命令来构建生产环境的可执行文件。构建产物将位于 `src-tauri/target/release/` 目录下。
```bash
pnpm tauri build
```

## 下一步

想要更深入地了解项目的设计理念、技术架构和代码实现细节，请查阅 [项目深度解析文档](./project-overview.md)。 