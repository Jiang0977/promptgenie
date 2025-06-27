use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use thiserror::Error;
use chrono::{DateTime, Utc};
use reqwest::Client;

#[derive(Debug, Error)]
pub enum FeishuSyncError {
    #[error("网络请求失败: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("配置文件操作失败: {0}")]
    ConfigError(#[from] std::io::Error),
    #[error("JSON序列化/反序列化失败: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("飞书API错误: {code} - {msg}")]
    FeishuApiError { code: i32, msg: String },
    #[error("URL解析失败: {0}")]
    UrlParseError(String),
}

/// 飞书配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
    pub base_url: String,
    pub app_token: String,
    pub table_id: String,
    pub enabled: bool,
}

/// 提示词数据结构 - 用于与飞书API交互
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: String, // JSON字符串形式存储标签数组
    pub is_favorite: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>, // 用于临时存储飞书的记录ID
}

/// 同步结果统计
#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub local_created: u32,
    pub local_updated: u32,
    pub remote_created: u32,
    pub remote_updated: u32,
    pub total_processed: u32,
}

/// 飞书API响应结构
#[derive(Debug, Deserialize)]
pub struct FeishuApiResponse<T> {
    pub code: i32,
    pub msg: String,
    pub data: Option<T>,
}

/// 租户访问令牌API的特殊响应格式（不包装在data字段中）
#[derive(Debug, Deserialize)]
pub struct TenantTokenApiResponse {
    pub tenant_access_token: String,
    pub expire: i32,
}

/// 飞书多维表格记录响应
#[derive(Debug, Deserialize)]
pub struct RecordsResponse {
    #[serde(default)]
    pub items: Vec<serde_json::Value>, // 当表格为空时可能不存在此字段
    pub has_more: bool,
    pub page_token: Option<String>,
}

/// 更新记录响应
#[derive(Debug, Deserialize)]
pub struct UpdateRecordsResponse {
    pub records: Vec<serde_json::Value>,
}

/// 获取应用配置目录
fn get_config_dir<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, FeishuSyncError> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| FeishuSyncError::ConfigError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "无法获取应用配置目录",
        )))?;
    
    std::fs::create_dir_all(&app_dir)?;
    Ok(app_dir)
}

/// 保存飞书配置到本地文件
#[tauri::command]
pub async fn save_feishu_config<R: Runtime>(
    app_handle: AppHandle<R>,
    app_id: String,
    app_secret: String,
    base_url: String,
) -> Result<(), String> {
    // 解析飞书多维表格URL，提取app_token和table_id
    let (app_token, table_id) = parse_feishu_base_url(&base_url)
        .map_err(|e| format!("URL解析失败: {}", e))?;

    let config = FeishuConfig {
        app_id,
        app_secret,
        base_url,
        app_token,
        table_id,
        enabled: true,
    };

    let config_dir = get_config_dir(&app_handle)
        .map_err(|e| format!("获取配置目录失败: {}", e))?;
    
    let config_file = config_dir.join("feishu_config.json");
    
    // 将配置序列化为JSON并保存
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("配置序列化失败: {}", e))?;
    
    std::fs::write(config_file, config_json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    println!("飞书配置已保存");
    Ok(())
}

/// 从本地文件读取飞书配置
#[tauri::command]
pub async fn get_feishu_config<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<Option<FeishuConfig>, String> {
    let config_dir = get_config_dir(&app_handle)
        .map_err(|e| format!("获取配置目录失败: {}", e))?;
    
    let config_file = config_dir.join("feishu_config.json");
    
    if !config_file.exists() {
        return Ok(None);
    }

    let config_content = std::fs::read_to_string(config_file)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    
    let config: FeishuConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("配置反序列化失败: {}", e))?;

    // 出于安全考虑，不返回app_secret的明文
    let mut safe_config = config.clone();
    safe_config.app_secret = "********".to_string();
    
    Ok(Some(safe_config))
}

/// 检查飞书配置是否存在
#[tauri::command]
pub async fn check_feishu_config_exists<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<bool, String> {
    let config_dir = get_config_dir(&app_handle)
        .map_err(|e| format!("获取配置目录失败: {}", e))?;
    
    let config_file = config_dir.join("feishu_config.json");
    Ok(config_file.exists())
}

/// 获取飞书表格字段信息（用于调试）
#[tauri::command]
pub async fn get_feishu_table_fields<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<String, String> {
    let config = load_feishu_config(&app_handle).await
        .map_err(|e| format!("加载配置失败: {}", e))?
        .ok_or_else(|| "配置未设置".to_string())?;

    let client = Client::new();
    
    // 获取访问令牌
    let access_token = get_tenant_access_token(&client, &config.app_id, &config.app_secret)
        .await
        .map_err(|e| format!("获取访问令牌失败: {}", e))?;
    
    // 获取表格字段信息
    let url = format!(
        "https://open.feishu.cn/open-apis/bitable/v1/apps/{}/tables/{}/fields",
        config.app_token, config.table_id
    );
    
    println!("获取字段信息URL: {}", url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("请求字段信息失败: {}", e))?;
    
    let response_text = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    println!("字段信息响应: {}", response_text);
    Ok(response_text)
}

/// 测试飞书连接
#[tauri::command]
pub async fn test_feishu_connection<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<String, String> {
    println!("开始测试飞书连接...");
    
    let config = load_feishu_config(&app_handle).await
        .map_err(|e| {
            println!("加载配置失败: {}", e);
            format!("加载配置失败: {}", e)
        })?
        .ok_or_else(|| {
            println!("配置未设置");
            "配置未设置".to_string()
        })?;

    println!("配置加载成功，App ID: {}, Base URL: {}", config.app_id, config.base_url);

    let client = Client::new();
    let access_token = get_tenant_access_token(&client, &config.app_id, &config.app_secret)
        .await
        .map_err(|e| format!("获取访问令牌失败: {}", e))?;

    match list_all_records(&client, &access_token, &config.app_token, &config.table_id).await {
        Ok(records) => {
            println!("连接测试完全成功，获取到 {} 条记录", records.len());
            Ok(format!("连接测试成功！找到 {} 条记录，飞书云同步可以正常使用", records.len()))
        },
        Err(e) => {
            println!("获取记录失败: {}", e);
            Err(format!("连接测试失败: {}", e))
        }
    }
}

/// 触发同步操作
#[tauri::command]
pub async fn trigger_sync<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<SyncResult, String> {
    // 加载配置
    let config = load_feishu_config(&app_handle).await
        .map_err(|e| format!("加载配置失败: {}", e))?
        .ok_or_else(|| "配置未设置".to_string())?;

    if !config.enabled {
        return Err("同步功能已禁用".to_string());
    }

    println!("开始同步操作...");
    
    match perform_sync(&app_handle, &config).await {
        Ok(result) => {
            println!("同步完成: {:?}", result);
            Ok(result)
        }
        Err(e) => {
            let error_msg = format!("同步失败: {}", e);
            println!("{}", error_msg);
            Ok(SyncResult {
                success: false,
                message: error_msg,
                local_created: 0,
                local_updated: 0,
                remote_created: 0,
                remote_updated: 0,
                total_processed: 0,
            })
        }
    }
}

/// 执行核心同步逻辑
async fn perform_sync<R: Runtime>(
    app_handle: &AppHandle<R>,
    config: &FeishuConfig,
) -> Result<SyncResult, FeishuSyncError> {
    // 1. 获取访问令牌
    let client = Client::new();
    let access_token = get_tenant_access_token(&client, &config.app_id, &config.app_secret).await?;
    
    // 2. 获取云端数据
    println!("正在获取云端数据...");
    let remote_records = list_all_records(&client, &access_token, &config.app_token, &config.table_id).await?;
    println!("获取到 {} 条云端记录", remote_records.len());
    
    // 3. 获取本地数据
    println!("正在获取本地数据...");
    let local_records = get_local_prompts(app_handle).await?;
    println!("获取到 {} 条本地记录", local_records.len());
    
    // 4. 执行同步算法
    let sync_plan = calculate_sync_plan(&local_records, &remote_records);
    println!("同步计划: 本地创建{}条, 本地更新{}条, 云端创建{}条, 云端更新{}条", 
             sync_plan.to_create_local.len(),
             sync_plan.to_update_local.len(),
             sync_plan.to_create_remote.len(),
             sync_plan.to_update_remote.len());
    
    // 5. 执行同步操作
    let mut result = SyncResult {
        success: true,
        message: "同步成功".to_string(),
        local_created: 0,
        local_updated: 0,
        remote_created: 0,
        remote_updated: 0,
        total_processed: 0,
    };

    // 创建到云端
    if !sync_plan.to_create_remote.is_empty() {
        let count = sync_plan.to_create_remote.len();
        create_remote_records(&client, &access_token, &config.app_token, &config.table_id, sync_plan.to_create_remote).await?;
        result.remote_created = count as u32;
    }

    // 更新到云端
    if !sync_plan.to_update_remote.is_empty() {
        let count = sync_plan.to_update_remote.len();
        update_remote_records(&client, &access_token, &config.app_token, &config.table_id, sync_plan.to_update_remote).await?;
        result.remote_updated = count as u32;
    }

    // 创建到本地
    if !sync_plan.to_create_local.is_empty() {
        let count = sync_plan.to_create_local.len();
        create_local_prompts(app_handle, sync_plan.to_create_local).await?;
        result.local_created = count as u32;
    }

    // 更新到本地
    if !sync_plan.to_update_local.is_empty() {
        let count = sync_plan.to_update_local.len();
        update_local_prompts(app_handle, sync_plan.to_update_local).await?;
        result.local_updated = count as u32;
    }

    result.total_processed = result.local_created + result.local_updated + result.remote_created + result.remote_updated;
    
    Ok(result)
}

/// 同步计划
struct SyncPlan {
    to_create_local: Vec<PromptRecord>,
    to_update_local: Vec<PromptRecord>,
    to_create_remote: Vec<PromptRecord>,
    to_update_remote: Vec<(String, PromptRecord)>, // (record_id, prompt_record)
}

/// 计算同步计划
fn calculate_sync_plan(local_records: &[PromptRecord], remote_records: &[PromptRecord]) -> SyncPlan {
    let local_map: HashMap<String, &PromptRecord> = local_records.iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    
    // 对于远程记录，我们需要同时通过我们自己的 `id` 和飞书的 `record_id` 进行查找
    // 1. `remote_map_by_custom_id` 用于通过我们的UUID进行匹配
    // 2. 原始的 `remote_records` 列表包含了所有信息，包括 `record_id`
    let remote_map_by_custom_id: HashMap<String, &PromptRecord> = remote_records.iter()
        .map(|r| (r.id.clone(), r))
        .collect();

    let mut plan = SyncPlan {
        to_create_local: Vec::new(),
        to_update_local: Vec::new(),
        to_create_remote: Vec::new(),
        to_update_remote: Vec::new(),
    };

    // 遍历本地记录，决定是否需要创建或更新到云端
    for local_record in local_records {
        match remote_map_by_custom_id.get(&local_record.id) {
            None => {
                // 本地有，云端没有 -> 创建到云端
                plan.to_create_remote.push(local_record.clone());
            }
            Some(remote_record) => {
                // 本地和云端都存在，比较更新时间
                if local_record.updated_at > remote_record.updated_at {
                    // 本地记录较新 -> 更新到云端
                    // 我们需要飞书的 record_id 来执行更新操作
                    if let Some(feishu_record_id) = &remote_record.record_id {
                        plan.to_update_remote.push((feishu_record_id.clone(), local_record.clone()));
                    } else {
                        // 这是一个异常情况：在云端找到了匹配的记录，但它没有 record_id
                        // 这可能意味着解析出了问题，或者是一个没有被正确创建的记录
                        println!("警告: 云端记录 {} (自定义ID: {}) 缺少 feishu_record_id，无法更新。", remote_record.title, remote_record.id);
                    }
                }
            }
        }
    }

    // 遍历云端记录，决定是否需要创建或更新到本地
    for remote_record in remote_records {
        match local_map.get(&remote_record.id) {
            None => {
                // 云端有，本地没有 -> 创建到本地
                plan.to_create_local.push(remote_record.clone());
            }
            Some(local_record) => {
                // 本地和云端都存在，比较更新时间
                if remote_record.updated_at > local_record.updated_at {
                    // 云端记录较新 -> 更新到本地
                    plan.to_update_local.push(remote_record.clone());
                }
                // 如果本地记录较新，已经在上一个循环中处理过了
            }
        }
    }

    plan
}

/// 解析飞书多维表格URL，提取app_token和table_id
fn parse_feishu_base_url(url: &str) -> Result<(String, String), FeishuSyncError> {
    // 支持多种飞书URL格式：
    // 1. https://yourdomain.feishu.cn/base/VkbvbJGl0aSYGtsT6CQcTGcPnMd?table=tblNYzJrWFGN4OWI
    // 2. https://yourdomain.feishu.cn/base/VkbvbJGl0aSYGtsT6CQcTGcPnMd  
    // 3. https://yourdomain.feishu.cn/wiki/I1iZwpcLli7wQtkGBywcYEldnmb?table=tblZCp9LxuJk7Z1H&view=vewHOQVag0
    
    let url_parts: Vec<&str> = url.split('/').collect();
    let mut app_token = None;
    let mut table_id = None;

    // 查找 /base/ 或 /wiki/ 后面的部分
    for (i, part) in url_parts.iter().enumerate() {
        if (*part == "base" || *part == "wiki") && i + 1 < url_parts.len() {
            let content_part = url_parts[i + 1];
            
            // 检查是否包含查询参数
            if let Some(query_start) = content_part.find('?') {
                app_token = Some(content_part[..query_start].to_string());
                
                // 解析查询参数中的table
                let query_string = &content_part[query_start + 1..];
                for param in query_string.split('&') {
                    if let Some((key, value)) = param.split_once('=') {
                        if key == "table" {
                            table_id = Some(value.to_string());
                        }
                    }
                }
            } else {
                app_token = Some(content_part.to_string());
            }
            break;
        }
    }

    let app_token = app_token.ok_or_else(|| 
        FeishuSyncError::UrlParseError("无法从URL中提取app_token，请确保URL包含/base/或/wiki/路径".to_string())
    )?;

    // 如果URL中没有table参数，返回错误提示
    let table_id = table_id.ok_or_else(|| 
        FeishuSyncError::UrlParseError("无法从URL中提取table_id，请确保URL包含?table=参数".to_string())
    )?;

    println!("成功解析URL - app_token: {}, table_id: {}", app_token, table_id);
    Ok((app_token, table_id))
}

/// 从配置文件加载飞书配置（内部使用，包含完整的app_secret）
async fn load_feishu_config<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Option<FeishuConfig>, FeishuSyncError> {
    let config_dir = get_config_dir(app_handle)?;
    let config_file = config_dir.join("feishu_config.json");
    
    if !config_file.exists() {
        return Ok(None);
    }

    let config_content = std::fs::read_to_string(config_file)?;
    let config: FeishuConfig = serde_json::from_str(&config_content)?;
    
    Ok(Some(config))
}

/// 获取飞书租户访问令牌
async fn get_tenant_access_token(
    client: &reqwest::Client,
    app_id: &str,
    app_secret: &str,
) -> Result<String, FeishuSyncError> {
    let url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
    
    let payload = serde_json::json!({
        "app_id": app_id,
        "app_secret": app_secret
    });

    println!("正在获取访问令牌，App ID: {}", app_id);

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    println!("收到HTTP响应，状态码: {}", response.status());

    // 先获取原始响应文本，便于调试
    let response_text = response.text().await?;
    println!("原始API响应: {}", response_text);

    // 首先尝试解析为通用的飞书API响应来检查是否有错误
    let api_response: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| {
            println!("JSON解析失败: {}", e);
            println!("尝试解析的文本: {}", response_text);
            FeishuSyncError::JsonError(e)
        })?;

    // 检查是否有错误码
    if let Some(code) = api_response.get("code").and_then(|v| v.as_i64()) {
        if code != 0 {
            let msg = api_response.get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("未知错误");
            
            let error_msg = match code {
                10014 => "App Secret 无效，请检查飞书应用配置中的 App Secret 是否正确",
                10013 => "App ID 无效，请检查飞书应用配置中的 App ID 是否正确",
                99991663 => "租户访问令牌无效",
                99991664 => "租户访问令牌过期",
                _ => &format!("飞书API错误 (代码: {}): {}", code, msg)
            };
            
                         println!("飞书API返回错误: {} - {}", code, msg);
             return Err(FeishuSyncError::FeishuApiError {
                 code: code as i32,
                 msg: error_msg.to_string(),
             });
        }
    }

    // 如果没有错误，尝试解析访问令牌
    let token_response: TenantTokenApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| {
            println!("解析访问令牌响应失败: {}", e);
            FeishuSyncError::JsonError(e)
        })?;

    println!("访问令牌获取成功，过期时间: {} 秒", token_response.expire);
    Ok(token_response.tenant_access_token)
}

/// 获取本地提示词数据
async fn get_local_prompts<R: Runtime>(_app_handle: &AppHandle<R>) -> Result<Vec<PromptRecord>, FeishuSyncError> {
    println!("开始获取本地提示词数据...");
    
    // 在 Tauri v2 中，建议通过 JavaScript API 调用数据库
    // 这里我们返回一个简化的实现，实际的数据库操作应该在前端完成
    // 然后通过 IPC 传递给 Rust 端进行同步操作
    
    // 暂时返回空的 Vec，等待前端提供数据
    println!("获取本地提示词数据 - 当前实现需要前端配合");
    Ok(Vec::new())
}

/// 创建本地提示词
async fn create_local_prompts<R: Runtime>(
    _app_handle: &AppHandle<R>,
    records: Vec<PromptRecord>,
) -> Result<(), FeishuSyncError> {
    if records.is_empty() {
        return Ok(());
    }

    println!("创建本地提示词，记录数: {}", records.len());
    
    // 在 Tauri v2 中，数据库操作应该通过前端 JavaScript API 完成
    // 这里我们可以发送事件给前端，让前端处理数据库操作
    
    for record in records {
        println!("需要创建提示词: {} - {}", record.id, record.title);
        
        // 这里可以通过事件发送给前端处理
        // app_handle.emit_all("create_prompt", &record).ok();
    }
    
    println!("提示词创建完成（需要前端配合）");
    Ok(())
}

/// 更新本地提示词
async fn update_local_prompts<R: Runtime>(
    _app_handle: &AppHandle<R>,
    records: Vec<PromptRecord>,
) -> Result<(), FeishuSyncError> {
    if records.is_empty() {
        return Ok(());
    }

    println!("更新本地提示词，记录数: {}", records.len());
    
    // 在 Tauri v2 中，数据库操作应该通过前端 JavaScript API 完成
    // 这里我们可以发送事件给前端，让前端处理数据库操作
    
    for record in records {
        println!("需要更新提示词: {} - {}", record.id, record.title);
        
        // 这里可以通过事件发送给前端处理
        // app_handle.emit_all("update_prompt", &record).ok();
    }
    
    println!("提示词更新完成（需要前端配合）");
    Ok(())
}

/// 支持前端传递本地数据的同步命令
#[tauri::command]
pub async fn sync_with_local_data<R: Runtime>(
    app_handle: AppHandle<R>,
    local_prompts: Vec<PromptRecord>, // 从前端传递的本地数据
) -> Result<SyncResult, String> {
    println!("开始同步操作（带本地数据）...");
    println!("收到本地数据: {} 条", local_prompts.len());
    
    // 打印本地数据详情
    for (i, prompt) in local_prompts.iter().enumerate() {
        println!("本地数据 {}: {} - {}", i + 1, prompt.id, prompt.title);
    }
    
    // 加载配置
    let config = load_feishu_config(&app_handle).await
        .map_err(|e| format!("加载配置失败: {}", e))?
        .ok_or_else(|| "配置未设置".to_string())?;

    if !config.enabled {
        return Err("同步功能已禁用".to_string());
    }
    
    let client = Client::new();
    
    // 获取访问令牌
    let access_token = get_tenant_access_token(&client, &config.app_id, &config.app_secret)
        .await
        .map_err(|e| format!("获取访问令牌失败: {}", e))?;
    
    // 获取云端数据
    println!("正在获取云端数据...");
    let remote_records = list_all_records(&client, &access_token, &config.app_token, &config.table_id)
        .await
        .map_err(|e| format!("获取云端数据失败: {}", e))?;
    
    println!("获取到 {} 条云端记录", remote_records.len());
    
    // 打印云端数据详情
    for (i, record) in remote_records.iter().enumerate() {
        println!("云端数据 {}: {} - {}", i + 1, record.id, record.title);
    }
    
    // 比较并计算同步操作
    let sync_plan = calculate_sync_plan(&local_prompts, &remote_records);
    
    println!("同步计划: 本地创建{}条, 本地更新{}条, 云端创建{}条, 云端更新{}条", 
             sync_plan.to_create_local.len(), 
             sync_plan.to_update_local.len(),
             sync_plan.to_create_remote.len(), 
             sync_plan.to_update_remote.len());
    
    let mut sync_result = SyncResult {
        success: true,
        message: "同步成功".to_string(),
        local_created: 0,
        local_updated: 0,
        remote_created: 0,
        remote_updated: 0,
        total_processed: 0,
    };
    
    // 执行云端创建操作
    if !sync_plan.to_create_remote.is_empty() {
        println!("开始向云端创建 {} 条记录", sync_plan.to_create_remote.len());
        match create_remote_records(&client, &access_token, &config.app_token, &config.table_id, sync_plan.to_create_remote.clone()).await {
            Ok(count) => {
                sync_result.remote_created = count as u32;
                println!("成功向云端创建 {} 条记录", count);
            }
            Err(e) => {
                let error_msg = format!("向云端创建记录失败: {}", e);
                println!("{}", error_msg);
                sync_result.success = false;
                sync_result.message = error_msg;
            }
        }
    }
    
    // 执行云端更新操作  
    if !sync_plan.to_update_remote.is_empty() {
        println!("开始向云端更新 {} 条记录", sync_plan.to_update_remote.len());
        match update_remote_records(&client, &access_token, &config.app_token, &config.table_id, sync_plan.to_update_remote.clone()).await {
            Ok(count) => {
                sync_result.remote_updated = count as u32;
                println!("成功向云端更新 {} 条记录", count);
            }
            Err(e) => {
                let error_msg = format!("向云端更新记录失败: {}", e);
                println!("{}", error_msg);
                sync_result.success = false;
                sync_result.message = error_msg;
            }
        }
    }
    
    // 计算需要在本地创建/更新的记录（通过事件通知前端）
    if !sync_plan.to_create_local.is_empty() {
        println!("需要在本地创建 {} 条记录", sync_plan.to_create_local.len());
        sync_result.local_created = sync_plan.to_create_local.len() as u32;
        
        // 发送事件给前端，让前端处理本地数据库操作
        if let Err(e) = app_handle.emit("sync-create-local", &sync_plan.to_create_local) {
            println!("发送本地创建事件失败: {}", e);
        }
    }
    
    if !sync_plan.to_update_local.is_empty() {
        println!("需要在本地更新 {} 条记录", sync_plan.to_update_local.len());
        sync_result.local_updated = sync_plan.to_update_local.len() as u32;
        
        // 发送事件给前端，让前端处理本地数据库操作
        if let Err(e) = app_handle.emit("sync-update-local", &sync_plan.to_update_local) {
            println!("发送本地更新事件失败: {}", e);
        }
    }
    
    sync_result.total_processed = sync_result.local_created + sync_result.local_updated + sync_result.remote_created + sync_result.remote_updated;
    
    println!("同步完成: {:?}", sync_result);
    Ok(sync_result)
}

/// 向飞书云端创建记录
async fn create_remote_records(
    client: &reqwest::Client,
    access_token: &str,
    app_token: &str,
    table_id: &str,
    records: Vec<PromptRecord>,
) -> Result<i32, FeishuSyncError> {
    if records.is_empty() {
        return Ok(0);
    }

    println!("开始向云端创建 {} 条记录", records.len());

    let url = format!(
        "https://open.feishu.cn/open-apis/bitable/v1/apps/{}/tables/{}/records/batch_create",
        app_token, table_id
    );

    // 构建记录数据
    let mut feishu_records = Vec::new();
    for record in &records {
        let mut fields = serde_json::Map::new();
        
        // 核心字段，确保与飞书表格字段名一致
        fields.insert("id".to_string(), serde_json::Value::String(record.id.clone()));
        fields.insert("title".to_string(), serde_json::Value::String(record.title.clone()));
        fields.insert("content".to_string(), serde_json::Value::String(record.content.clone()));
        fields.insert("tags".to_string(), serde_json::Value::String(record.tags.clone()));
        
        // isFavorite 字段现在是单选类型
        if record.is_favorite {
            fields.insert("isFavorite".to_string(), serde_json::Value::String("是".to_string()));
        } else {
            fields.insert("isFavorite".to_string(), serde_json::Value::String("否".to_string()));
        }

        // 时间戳字段，使用Unix时间戳（毫秒）
        fields.insert("createdAt".to_string(), serde_json::json!(record.created_at.timestamp_millis()));
        fields.insert("updatedAt".to_string(), serde_json::json!(record.updated_at.timestamp_millis()));
        if let Some(last_used) = record.last_used {
            fields.insert("lastUsed".to_string(), serde_json::json!(last_used.timestamp_millis()));
        }
        
        feishu_records.push(serde_json::json!({
            "fields": fields
        }));
    }

    let payload = serde_json::json!({
        "records": feishu_records
    });

    println!("创建记录请求payload: {}", serde_json::to_string_pretty(&payload).unwrap_or_default());

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    println!("创建记录响应状态码: {}", response.status());

    let response_text = response.text().await?;
    println!("创建记录响应: {}", response_text);

    let api_response: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| {
            println!("创建记录响应JSON解析失败: {}", e);
            FeishuSyncError::JsonError(e)
        })?;

    // 检查API响应状态
    let code = api_response.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code != 0 {
        let msg = api_response.get("msg").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(FeishuSyncError::FeishuApiError {
            code: code as i32,
            msg: msg.to_string(),
        });
    }

    // 返回实际创建的记录数
    let created_count = records.len() as i32;
    println!("成功创建 {} 条记录", created_count);
    Ok(created_count)
}

/// 向飞书云端更新记录
async fn update_remote_records(
    client: &reqwest::Client,
    access_token: &str,
    app_token: &str,
    table_id: &str,
    records: Vec<(String, PromptRecord)>,
) -> Result<i32, FeishuSyncError> {
    if records.is_empty() {
        return Ok(0);
    }

    println!("开始向云端批量更新 {} 条记录", records.len());

    let url = format!(
        "https://open.feishu.cn/open-apis/bitable/v1/apps/{}/tables/{}/records/batch_update",
        app_token, table_id
    );

    let mut feishu_records = Vec::new();
    for (record_id, record) in &records {
        let mut fields = serde_json::Map::new();

        // 核心字段
        fields.insert("id".to_string(), serde_json::Value::String(record.id.clone()));
        fields.insert("title".to_string(), serde_json::Value::String(record.title.clone()));
        fields.insert("content".to_string(), serde_json::Value::String(record.content.clone()));
        fields.insert("tags".to_string(), serde_json::Value::String(record.tags.clone()));

        // isFavorite 字段现在是单选类型
        if record.is_favorite {
            fields.insert("isFavorite".to_string(), serde_json::Value::String("是".to_string()));
        } else {
            fields.insert("isFavorite".to_string(), serde_json::Value::String("否".to_string()));
        }

        // 时间戳字段，使用Unix时间戳（毫秒）
        fields.insert("createdAt".to_string(), serde_json::json!(record.created_at.timestamp_millis()));
        fields.insert("updatedAt".to_string(), serde_json::json!(record.updated_at.timestamp_millis()));
        if let Some(last_used) = record.last_used {
            fields.insert("lastUsed".to_string(), serde_json::json!(last_used.timestamp_millis()));
        } else {
            // 如果 last_used 是 None，可以发送 null 或者干脆不发送该字段
            // 不发送可能更安全，以防覆盖掉已有值
        }

        feishu_records.push(serde_json::json!({
            "record_id": record_id,
            "fields": fields
        }));
    }

    let payload = serde_json::json!({
        "records": feishu_records
    });

    println!("更新记录请求payload: {}", serde_json::to_string_pretty(&payload).unwrap_or_default());

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    println!("更新记录响应状态码: {}", response.status());

    let response_text = response.text().await?;
    println!("更新记录响应: {}", response_text);

    let api_response: FeishuApiResponse<UpdateRecordsResponse> = serde_json::from_str(&response_text)
        .map_err(|e| {
            println!("更新记录响应JSON解析失败: {}", e);
            FeishuSyncError::JsonError(e)
        })?;
    
    if api_response.code != 0 {
        return Err(FeishuSyncError::FeishuApiError {
            code: api_response.code,
            msg: api_response.msg,
        });
    }

    let updated_count = api_response.data.map_or(0, |d| d.records.len());
    println!("总共成功更新 {} 条记录", updated_count);
    Ok(updated_count as i32)
}

/// 获取所有记录 - 独立函数版本
async fn list_all_records(
    client: &reqwest::Client,
    access_token: &str,
    app_token: &str,
    table_id: &str,
) -> Result<Vec<PromptRecord>, FeishuSyncError> {
    let mut all_records = Vec::new();
    let mut page_token: Option<String> = None;
    
    loop {
        let mut url = format!(
            "https://open.feishu.cn/open-apis/bitable/v1/apps/{}/tables/{}/records",
            app_token, table_id
        );
        
        // 添加分页参数
        let mut query_params = vec!["page_size=500".to_string()];
        if let Some(token) = &page_token {
            query_params.push(format!("page_token={}", token));
        }
        if !query_params.is_empty() {
            url.push('?');
            url.push_str(&query_params.join("&"));
        }

        println!("正在请求表格记录，URL: {}", url);

        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .send()
            .await?;

        println!("收到表格记录响应，状态码: {}", response.status());

        // 先获取原始响应文本，便于调试
        let response_text = response.text().await?;
        println!("原始表格记录API响应: {}", response_text);

        // 尝试解析JSON
        let api_response: FeishuApiResponse<RecordsResponse> = serde_json::from_str(&response_text)
            .map_err(|e| {
                println!("表格记录JSON解析失败: {}", e);
                println!("尝试解析的文本: {}", response_text);
                FeishuSyncError::JsonError(e)
            })?;

        println!("表格记录API响应解析成功，code: {}, msg: {}", api_response.code, api_response.msg);

        if api_response.code != 0 {
            let error_msg = match api_response.code {
                99991672 => {
                    format!("应用权限不足。请前往飞书开放平台为应用开通多维表格权限：\n{}", 
                           "需要权限: bitable:app:readonly 或 bitable:app 或 base:record:retrieve")
                },
                1254032 => "应用无权访问此多维表格，请检查应用是否已添加到对应工作空间并有相应权限".to_string(),
                1254051 => "多维表格不存在或已删除，请检查URL中的app_token是否正确".to_string(),
                1254010 => "数据表不存在，请检查URL中的table参数是否正确".to_string(),
                _ => format!("多维表格API调用失败: {} - {}", api_response.code, api_response.msg),
            };

            return Err(FeishuSyncError::FeishuApiError {
                code: api_response.code,
                msg: error_msg,
            });
        }

        let data = api_response.data.ok_or_else(|| {
            FeishuSyncError::FeishuApiError {
                code: -1,
                msg: "API响应数据为空".to_string(),
            }
        })?;
        
        // 解析记录 - 使用新的解析逻辑
        for item in data.items {
            match parse_record_from_feishu(item) {
                Ok(record) => all_records.push(record),
                Err(e) => {
                    println!("跳过无法解析的记录: {}", e);
                    // 可以选择在这里记录更详细的错误日志
                }
            }
        }

        // 检查是否还有更多页面
        if !data.has_more {
            break;
        }
        page_token = data.page_token;
    }

    Ok(all_records)
}

/// 从飞书的JSON对象中解析出PromptRecord
fn parse_record_from_feishu(item: serde_json::Value) -> Result<PromptRecord, String> {
    let record_id = item.get("record_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 record_id".to_string())?
        .to_string();

    let fields = item.get("fields")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("记录 {} 缺少 fields 对象", record_id))?;

    // --- 辅助函数 ---
    let get_text = |key: &str| -> Result<String, String> {
        fields.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("字段 '{}' 不存在或类型不为文本", key))
    };

    let get_timestamp_from_field = |key: &str| -> Result<DateTime<Utc>, String> {
        let value = fields.get(key)
            .ok_or_else(|| format!("时间戳字段 '{}' 不存在", key))?;
        
        let timestamp_ms = value.as_i64()
            .ok_or_else(|| format!("时间戳字段 '{}' 的值 '{}' 不是有效数字", key, value))?;
        
        DateTime::from_timestamp_millis(timestamp_ms)
            .ok_or_else(|| format!("无法将毫秒时间戳 '{}' 转换为日期", timestamp_ms))
    };
    
    let get_optional_timestamp = |key: &str| -> Option<DateTime<Utc>> {
        if let Ok(ts) = get_timestamp_from_field(key) {
            Some(ts)
        } else {
            None
        }
    };
    // --- 字段解析 ---

    let id = get_text("id")?;
    let title = get_text("title").unwrap_or_else(|_| "未命名".to_string());
    let content = get_text("content").unwrap_or_else(|_| "".to_string());
    let tags = get_text("tags").unwrap_or_else(|_| "[]".to_string());

    let is_favorite = fields.get("isFavorite")
        .and_then(|v| v.as_str())
        .map(|s| s == "是") // 如果文本是 "是"，则为 true
        .unwrap_or(false);

    let created_at = get_timestamp_from_field("createdAt")?;
    let updated_at = get_timestamp_from_field("updatedAt")?;
    let last_used = get_optional_timestamp("lastUsed");

    Ok(PromptRecord {
        id,
        title,
        content,
        tags,
        is_favorite,
        created_at,
        updated_at,
        last_used,
        record_id: Some(record_id), // 存储飞书的 record_id
    })
} 