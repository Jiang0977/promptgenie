# PromptGenie 项目深度解析

> **背景说明**
> 本文档分析的项目是 [Jiang0977/promptgenie](https://github.com/Jiang0977/promptgenie)，它 Fork 自 [ChrisZou/promptgenie](https://github.com/ChrisZou/promptgenie)。其主要增强之处在于深度集成了**飞书多维表格双向同步**功能，因此本文档将对此功能的实现细节进行重点解析。

本文档旨在为开发者提供 PromptGenie 应用的全面技术概览，包括架构设计、技术栈、代码结构、核心功能实现等。

## 1. 架构概览

PromptGenie 采用基于 [Tauri](https://tauri.app/) 的混合应用架构。这种架构结合了 Web 前端技术（React, TypeScript）和 Rust 后端的强大能力，实现了高性能的跨平台桌面应用。

```mermaid
graph TD
    subgraph Frontend (WebView)
        A[React UI Components] --> B{State Management};
        B --> C[Data Service (db.ts)];
    end

    subgraph Backend (Rust Core)
        E[Tauri Core] --> F{Tauri Commands};
        F --> G[System Integrations];
        F --> H[Database Plugin];
        F --> I[Feishu Sync Module];
    end
    
    subgraph System
      J[SQLite Database]
      K[System Tray]
      L[Feishu API]
    end

    C -- "Invoke Commands" --> F;
    F -- "Emit Events" --> C;
    H -- "CRUD" --> J;
    G -- "Manage" --> K;
    I -- "HTTP Requests" --> L;

    style Frontend fill:#cde,stroke:#333,stroke-width:2px
    style Backend fill:#e8d5b5,stroke:#333,stroke-width:2px
    style System fill:#d4e4d4,stroke:#333,stroke-width:2px

```

- **前端 (WebView)**: 负责所有用户界面的渲染和交互。使用 React 构建，并通过一个专门的服务层 (`db.ts`) 与后端通信。
- **后端 (Rust Core)**: 处理所有核心业务逻辑、原生系统交互和数据持久化。通过 Tauri 的 `command` 机制向前端暴露接口，并通过 `event` 机制向前端推送消息。
- **系统**: 包括 SQLite 数据库文件、原生系统托盘和外部的飞书 API。

## 2. 技术栈详情

| 类别 | 技术 | 版本/说明 |
| --- | --- | --- |
| **核心框架** | Tauri | v2.0.0-beta |
| **前端** | React | v18.3.1 |
| | TypeScript | v5.6.2 |
| | Vite | v6.0.3 |
| | Tailwind CSS | v3.4.1 |
| **后端** | Rust | 2021 Edition |
| **数据库** | SQLite | via `tauri-plugin-sql` |
| **关键库 (前端)** | `@tauri-apps/api` | Tauri 前端 JS-API |
| | `lucide-react` | 图标库 |
| | `uuid` | v11.1.0, 用于生成 UUID |
| | `sonner` | Toast 通知 |
| **关键库 (后端)** | `serde` | 数据序列化/反序列化 |
| | `uuid` | v1.8.0, 特性：`v7`, `serde` |
| | `reqwest` | HTTP 客户端，用于飞书同步 |
| | `tokio` | 异步运行时 |

## 3. 项目结构

```
promptgenie/
├── .cursor/docs/         # 项目文档
├── src/                  # 前端代码
│   ├── components/       # React UI 组件
│   ├── services/
│   │   └── db.ts         # 前端数据库服务层 (核心)
│   ├── types/            # TypeScript 类型定义
│   ├── App.tsx           # 主应用组件
│   └── main.tsx          # 前端入口
├── src-tauri/            # 后端代码与Tauri配置
│   ├── db/
│   │   └── schema.sql    # 数据库表结构定义
│   ├── src/
│   │   ├── feishu_sync.rs# 飞书同步功能的Rust实现
│   │   └── lib.rs        # Rust 后端入口与核心逻辑
│   └── tauri.conf.json   # Tauri 应用核心配置
├── package.json          # 前端依赖与脚本
└── pnpm-lock.yaml        # 依赖版本锁定
```

## 4. 核心功能实现分析

### 4.1. 数据持久化 (SQLite)

- **后端**: `src-tauri/src/lib.rs` 中初始化 `tauri-plugin-sql` 插件，并加载 `src-tauri/db/schema.sql` 完成数据库和表的创建。
- **前端**: `src/services/db.ts` 是前端与数据库交互的唯一入口。它封装了所有 SQL 查询，向上层 UI 组件提供类型安全的异步函数（如 `getAllPrompts`, `createPrompt` 等）。
- **ID 策略**: 所有主键（`prompts.id`, `tags.id`）都使用 `uuid v7` 生成，这在 `db.ts` 的 `createPrompt` 等函数中实现。

### 4.2. 系统托盘快速访问

这是一个经典的前后端协作功能：

1.  **前端触发**: 用户在应用中操作后（如使用了一个提示词），`src/services/db.ts` 中的 `updateTrayMenu` 函数会被调用。
2.  **数据准备**: 该函数从本地数据库查询最近使用的5个提示词。
3.  **调用后端**: 将查询到的提示词列表（仅含 `id` 和 `title`）作为参数，调用 Rust 端的 `update_tray_menu` 命令。
4.  **后端处理**: `src-tauri/src/lib.rs` 中的 `update_tray_menu` 命令接收到数据后，动态构建一个新的托盘菜单并应用到系统托盘上。
5.  **用户交互**: 当用户点击托盘菜单中的某个提示词时，Rust 后端会捕获该事件。
6.  **事件通知**: Rust 后端通过 `app_handle.emit` 方法，向前端发送一个名为 `tray-prompt-selected` 的事件，并附带被点击项的 `id`。
7.  **前端响应**: 前端在 `App.tsx` 中监听此事件，接收到 `id` 后执行相应操作（如将提示词内容复制到剪贴板）。

### 4.3. 飞书多维表格同步

这是项目最复杂的功能，实现了本地数据与云端表格的双向同步。

- **UI 入口**: `src/components/Settings.tsx` 提供了配置飞书 App ID, App Secret 和多维表格链接的用户界面，并包含触发同步的按钮。
- **前端发起**: 点击同步后，`src/services/db.ts` 中的 `syncWithFeishu` 函数被调用。它会先从本地数据库查询出所有的 `prompts` 记录。
- **Rust 主导同步**: 前端将配置信息和本地所有数据通过 `trigger_sync` 命令一次性发送给 Rust 后端。**后续的同步逻辑完全由 Rust 主导**。
- **后端同步逻辑 (`feishu_sync.rs`)**:
    1. 获取飞书 API 的 `tenant_access_token`。
    2. 从飞书拉取所有在线记录。
    3. 将在线记录与本地记录进行对比（通过 `id` 匹配），找出差异：
        - 本地存在，远程不存在 -> **需在远程创建**
        - 远程存在，本地不存在 -> **需在本地创建**
        - 两边都存在，但 `updated_at` 不一致 -> **根据时间戳决定更新方向**
    4. 执行所有必要的创建和更新操作（调用飞书 API 或直接修改本地数据库）。
- **后端到前端的通信**: 对于需要在本地创建或更新的记录，Rust 后端会通过 `app.emit` 向前端发送 `create-local-records` 或 `update-local-records` 事件，并携带需要操作的数据。
- **前端执行更新**: `Settings.tsx` 中监听这些事件，并调用 `db.ts` 中的 `handleSyncCreateLocal` 和 `handleSyncUpdateLocal` 方法，将后端传来的数据更新到前端的 SQLite 数据库中，完成闭环。

## 5. 代码解读

### 5.1. 后端 (`src-tauri/src/lib.rs`)

- **`run()`**: 应用主入口。负责配置和初始化所有插件（SQL, Shell, Single-Instance, Clipboard）。
- **`setup` 闭包**: 在应用启动时执行一次。负责初始化数据库目录、动态调整窗口大小、创建初始的系统托盘。
- **`#[tauri::command]`**: 宏，用于将 Rust 函数暴露给前端调用。关键命令包括 `update_tray_menu` 和一系列 `feishu_sync` 模块中的函数。

### 5.2. 前端服务层 (`src/services/db.ts`)

- **`initDatabase()` & `ensureDbInitialized()`**: 提供了健壮的数据库单例连接和重试机制，是所有操作的基础。
- **CRUD 函数**: 封装了所有数据库操作，是前端业务逻辑的核心。其中 `ensureTagsExist` 函数处理了复杂的标签创建/查找逻辑，是避免数据冗余的关键。
- **同步相关函数**: `syncWithFeishu` 负责发起同步，而 `handleSyncCreateLocal` / `handleSyncUpdateLocal` 负责响应后端发来的同步事件。

### 5.3. 数据库 (`src-tauri/db/schema.sql`)

- **`prompts`**: 核心表，存储提示词内容和元数据。
- **`tags`**: 标签表。
- **`prompt_tags`**: 关联表，实现了 `prompts` 和 `tags` 的多对多关系。使用了 `FOREIGN KEY` 和 `ON DELETE CASCADE` 来保证数据引用的完整性，当一个提示词或标签被删除时，其关联关系也会被自动清除。

---
*本文档基于当前代码库分析生成，最后更新于 `DATE`。* 