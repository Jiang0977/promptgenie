// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_clipboard_manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_single_instance;

// 飞书同步模块
mod feishu_sync;
use feishu_sync::{save_feishu_config, get_feishu_config, check_feishu_config_exists, get_feishu_table_fields, test_feishu_connection, trigger_sync, sync_with_local_data};

// 新增：用于从前端接收菜单项数据的结构体
#[derive(serde::Deserialize)]
struct PromptMenuItem {
    id: String,
    title: String,
}

// 初始化数据库
fn init_db<R: Runtime>(app: &AppHandle<R>) {
    // 确保数据目录存在
    let app_dir = app.path().app_data_dir().expect("无法获取app数据目录");
    std::fs::create_dir_all(&app_dir).expect("无法创建数据目录");

    // 打印数据库路径
    let db_path = app_dir.join("promptgenie.db");
    println!("数据库路径: {}", db_path.to_string_lossy());
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You\'ve been greeted from Rust!", name)
}

// 处理托盘图标事件的独立函数 - Simplified
fn handle_tray_icon_event<R: Runtime>(tray_handle: &TrayIcon<R>, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click { .. } => {
            // 点击时显示菜单而不是主窗口
            // 注意：我们不使用菜单，因为菜单已经通过 TrayIconBuilder 配置
            // 在 v2 中，单击会自动显示菜单（取决于操作系统设置）
        }
        TrayIconEvent::DoubleClick { .. } => {
            // 双击时显示主窗口
            if let Some(window) = tray_handle.app_handle().get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    }
}

// 新增：用于更新托盘菜单的命令
#[tauri::command]
async fn update_tray_menu<R: Runtime>(
    app_handle: AppHandle<R>,
    items: Vec<PromptMenuItem>,
) -> Result<(), String> {
    // 构建菜单
    let mut menu_builder = MenuBuilder::new(&app_handle);

    // 添加"显示主窗口"选项
    menu_builder = menu_builder.item(
        &MenuItem::with_id(&app_handle, "show-window", "显示主窗口", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    );

    // 添加分隔线
    menu_builder = menu_builder.separator();

    // 添加最近提示词的标题（不可点击）
    menu_builder = menu_builder.item(
        &MenuItem::with_id(
            &app_handle,
            "recent-title",
            "最近使用的提示词",
            false, // 设为false表示不可点击
            None::<&str>,
        )
        .map_err(|e| e.to_string())?,
    );

    // 添加最近使用的提示词
    if items.is_empty() {
        menu_builder = menu_builder.item(
            &MenuItem::with_id(
                &app_handle,
                "no-recent",
                "  无记录", // 增加缩进以表示层级关系
                false,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        );
    } else {
        for item in items {
            let title = if item.title.chars().count() > 30 {
                format!("  {}...", item.title.chars().take(27).collect::<String>())
            // 增加缩进
            } else {
                format!("  {}", item.title) // 增加缩进
            };
            menu_builder = menu_builder.item(
                &MenuItem::with_id(&app_handle, &item.id, title, true, None::<&str>)
                    .map_err(|e| e.to_string())?,
            );
        }
    }

    let menu = menu_builder
        .separator()
        .item(
            &MenuItem::with_id(&app_handle, "quit", "退出", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    // 获取现有托盘图标并更新菜单，而不是创建新图标
    if let Some(tray_icon) = app_handle.tray_by_id("default") {
        tray_icon.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        // 如果找不到默认托盘图标，打印信息并返回错误
        eprintln!("找不到默认托盘图标");
        Err("找不到默认托盘图标".to_string())
    }
}

// 定义插件入口函数
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create initial tables",
        sql: include_str!("../db/schema.sql"),
        kind: MigrationKind::Up,
    }];

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("检测到第二个实例启动尝试，显示现有窗口");
            println!("参数: {:?}, 工作目录: {:?}", argv, cwd);
            
            // 尝试显示现有的主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                println!("已将现有窗口带到前台");
            } else {
                println!("警告：找不到主窗口");
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:promptgenie.db", migrations)
                .build(),
        )
        .setup(|app| {
            // 初始化数据库目录（如果需要）
            init_db(&app.handle());

            // --- 动态调整窗口大小 ---
            if let Some(window) = app.get_webview_window("main") {
                // 获取主显示器的尺寸
                if let Some(monitor) = window.current_monitor().ok().flatten() {
                    let monitor_size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    
                    // 计算实际像素尺寸
                    let screen_width = (monitor_size.width as f64 / scale_factor) as u32;
                    let screen_height = (monitor_size.height as f64 / scale_factor) as u32;
                    
                    // 计算70%的尺寸
                    let target_width = (screen_width as f64 * 0.7) as u32;
                    let target_height = (screen_height as f64 * 0.7) as u32;
                    
                    // 应用最小尺寸限制
                    let min_width = 800;
                    let min_height = 600;
                    
                    let final_width = target_width.max(min_width);
                    let final_height = target_height.max(min_height);
                    
                    // 设置窗口大小
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: final_width,
                        height: final_height,
                    }));
                    
                    println!("屏幕尺寸: {}x{}, 窗口尺寸: {}x{}", screen_width, screen_height, final_width, final_height);
                }
            }

            // --- 托盘初始设置 ---
            let app_handle = app.handle().clone();

            // 初始菜单可以保持简单，只包含退出选项
            let initial_menu = MenuBuilder::new(&app_handle)
                .item(&MenuItem::with_id(
                    &app_handle,
                    "quit",
                    "退出",
                    true,
                    None::<&str>,
                )?)
                .build()?;

            let icon = app_handle
                .default_window_icon()
                .expect("无法获取默认图标")
                .clone();

            // 构建托盘图标并设置 ID
            TrayIconBuilder::with_id("default")
                .icon(icon)
                .tooltip("PromptGenie")
                .menu(&initial_menu)
                .on_menu_event(move |app_handle_for_event, event| {
                    let id = event.id().0.as_str();
                    match id {
                        "quit" => {
                            std::process::exit(0);
                        }
                        "show-window" => {
                            // 显示主窗口
                            if let Some(window) = app_handle_for_event.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "recent-title" | "no-recent" => {
                            // 这些是不可点击或无操作的菜单项
                        }
                        _ => {
                            println!("Clicked prompt menu item ID: {}", id);
                            // 处理提示词菜单项点击
                            if id.starts_with("no-") {
                                return; // 无操作项，如"无记录"
                            }

                            // 把 ID 作为 payload 发送到前端，让前端获取提示词内容并复制到剪贴板
                            let payload = id.to_string();

                            // 发送事件到前端，表示要将此提示词内容复制到剪贴板
                            if let Some(window) = app_handle_for_event.get_webview_window("main") {
                                match window.emit("copy-prompt-to-clipboard", payload) {
                                    Ok(_) => {
                                        println!("已发送复制提示词内容到剪贴板事件");
                                    }
                                    Err(e) => {
                                        eprintln!("发送复制提示词内容到剪贴板事件失败: {}", e);
                                    }
                                }
                            }
                        }
                    }
                })
                .on_tray_icon_event(handle_tray_icon_event)
                .build(&app_handle)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            update_tray_menu,
            save_feishu_config,
            get_feishu_config,
            check_feishu_config_exists,
            get_feishu_table_fields,
            test_feishu_connection,
            trigger_sync,
            sync_with_local_data
        ]);

    // 构建应用实例
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 使用run方法并处理窗口事件
    app.run(|app_handle, event| {
        match event {
            // 处理 close-requested 事件
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if label == "main" {
                    // 获取窗口句柄
                    if let Some(window) = app_handle.get_webview_window("main") {
                        // 阻止窗口关闭
                        api.prevent_close();
                        // 隐藏窗口
                        let _ = window.hide();
                    }
                }
            }
            _ => {}
        }
    });
}
