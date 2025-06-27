# �� 提示词精灵（PromptGenie） - 飞书同步增强版

> **项目说明**
> 本仓库 Fork 自 [ChrisZou/promptgenie](https://github.com/ChrisZou/promptgenie)，当前项目地址为 [https://github.com/Jiang0977/promptgenie](https://github.com/Jiang0977/promptgenie)。
> 
> 与原项目相比，当前版本最大的特点是深度集成了**飞书多维表格双向同步**功能，允许您将本地的提示词数据与云端表格无缝同步，实现数据备份与团队协作。

一个专为懒人打造的AI提示词管理工具。  
**常驻系统托盘，一键复制提示词，高效复用你的 AI 灵感。**

> 适用于 macOS, Windows，支持 ChatGPT、Midjourney、Claude 等 AI 工具用户。

---

## 解决的问题
你是不是经常看到一些精彩使用的AI提示词，却因为没有一个好的统一管理工具，所以散落在各个地方，每次都要翻各种笔记软件、历史记录，找回那些写过但记不清的提示词？
提示词精灵就是为此而生的：他提供一个统一的记录空间，并且常驻在你的系统托盘，点击即可一键复制最常用的 Prompt，省去翻箱倒柜、重复操作，让 AI提示词真正成为你最强大的武器！

## ✨ 核心功能

- 🌗 **托盘常驻**：快捷访问，一键复制使用
- 🧠 **收藏功能**：收藏你最喜欢、最常用的提示词
- 🏷 **标签管理**：使用标签灵活组织、查找不同类型的提示词  
- 🔍 **快捷搜索**：快速定位关键词或标签  
- ☁️ **飞书同步**：与飞书多维表格双向同步，实现云端备份与协作。

---

## 🖥️ 截图预览

APP主界面
![](https://cdnw.togetherdaka.com/promptgenie/app/app_main.png)

系统状态栏下拉菜单
![](https://cdnw.togetherdaka.com/promptgenie/app/tray.png)

---

## 📦 安装

本项目需要手动从源码构建。

```bash
git clone https://github.com/Jiang0977/promptgenie.git
cd promptgenie
pnpm install
pnpm tauri build
```

---

## 🧑‍💻 开发者须知

本项目基于：

- [Tauri](https://tauri.app/)
- [React + Vite](https://vitejs.dev/)
- [TailwindCSS](https://tailwindcss.com/)
- SQLite + [sqlx](https://github.com/launchbadge/sqlx)

### 本地运行

```bash
pnpm install
pnpm tauri dev
```

### 数据结构说明

- 所有提示词存储在本地 SQLite 数据库中（首次启动自动创建）
- 使用 `sqlx` + migration 自动管理表结构

### 飞书同步设置

本应用支持将提示词数据与飞书多维表格进行双向同步。如果你是开发者，并希望在本地环境中测试此功能，请按照以下步骤操作：

**第一步：创建飞书应用**

1.  访问 [飞书开放平台](https://open.feishu.cn/app) 并创建一个**企业自建应用**。
2.  在应用的"凭证与基础信息"页面，获取 `App ID` 和 `App Secret`。
3.  在"权限管理"页面，确保为应用开通以下权限，否则同步将失败：
    *   `bitable:app:readonly` - 查看多维表格
    *   `bitable:app:readwrite` - 编辑多维表格

**第二步：创建多维表格**

1.  访问 [飞书多维表格](https://bytedance.feishu.cn/base) 并创建一个新的表格。
2.  **关键：** 确保表格包含以下字段，且字段名和类型必须完全匹配。建议直接复制字段名以避免错误。
    *   `id` (类型: **文本**) - 用于存储记录的唯一ID，建议设为**主字段**。
    *   `title` (类型: **文本**)
    *   `content` (类型: **多行文本**)
    *   `tags` (类型: **文本**) - 用于存储JSON格式的标签数组。
    *   `isFavorite` (类型: **单选**) - 选项必须包含 `"是"` 和 `"否"`。
    *   `createdAt` (类型: **日期**)
    *   `updatedAt` (类型: **日期**) - 同步冲突解决的关键字段。
    *   `lastUsed` (类型: **日期**)

**第三步：在应用内配置**

1.  运行 PromptGenie 应用，进入"设置"页面。
2.  在"飞书云同步"区域，准确填写以下信息：
    *   **飞书 App ID**：来自第一步。
    *   **飞书 App Secret**：来自第一步。
    *   **飞书多维表格 URL**：从你创建的多维表格页面复制浏览器地址栏中的完整 URL。
3.  点击"保存配置"，然后点击"测试连接"进行验证。

配置完成后，你就可以在本地开发环境中测试完整的双向同步功能了。

---

## 🤝 欢迎的贡献

- ✨ 新功能建议
- 🐛 Bug 修复 / UI 优化  
- 📦 PR 或插件机制探索  
- 📣 推荐给朋友或在社区分享  

---

## ⭐️ Star 一下支持一下！

如果你觉得这个项目有帮助，欢迎点个 ⭐️，也是对我最大的鼓励！