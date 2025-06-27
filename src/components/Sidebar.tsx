import React, { useState, useEffect, useCallback } from 'react';
// @ts-ignore
import { FolderIcon, PlusCircleIcon, StarIcon, TagIcon, SettingsIcon, SettingsIcon as CogIcon, CloudIcon, RefreshCwIcon } from 'lucide-react';
import { getAllTags, Tag, getAllPrompts, convertPromptToRecord } from '../services/db';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

type SidebarProps = {
  onNewPrompt: () => void;
  onOpenTagManager?: () => void;
  onAllPromptsClick: () => void;
  onFavoritesClick: () => void;
  onTagClick: (tagId: string) => void;
  activeFilterMode: 'all' | 'favorites';
  activeTagId: string | null;
  onOpenSettings?: () => void;
  onRefreshPrompts?: () => void; // 新增：刷新提示词列表的回调
};

// SyncResult现在从db.ts导入，删除本地定义

// --- 精确的类型定义 ---
// 基础 Props，所有项目共享
type BaseSidebarItemProps = {
  label: string;
  active?: boolean;
  onClick?: () => void;
};

// 通用项目的 Props，继承基础并添加必需的 icon
type GenericSidebarItemProps = BaseSidebarItemProps & {
  icon: React.ReactNode; // 图标现在是必需的
};

// 标签项目的 Props，继承基础并添加必需的 tagColor 和可选的 count
type TagSidebarItemProps = BaseSidebarItemProps & {
  tagColor: string; // 标签颜色是必需的
  count?: number;
  active?: boolean;
  onClick?: () => void;
};
// --- 类型定义结束 ---

// 通用侧边栏项目组件 (使用 GenericSidebarItemProps)
const SidebarItem: React.FC<GenericSidebarItemProps> = ({ icon, label, active = false, onClick }) => {
  // 非标签项的样式（所有提示词、收藏等）
  return (
    <li
      className={`flex items-center px-3 py-2 rounded-lg mb-1 cursor-pointer group transition-all duration-150 ${active ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-100'}`}
      onClick={onClick}
    >
      <div className="flex items-center flex-1">
        {/* icon 现在是必需的，直接使用 */}
        <span className={`mr-2 ${active ? 'text-primary-600' : 'text-gray-500 group-hover:text-gray-700'}`}>{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
    </li>
  );
};

// 标签专属的侧边栏项目组件 (使用 TagSidebarItemProps)
const TagSidebarItem: React.FC<TagSidebarItemProps> = ({ label, count, tagColor, active, onClick }) => {
  return (
    <li
      className={`flex items-center px-3 py-2 rounded-lg mb-1 cursor-pointer group transition-all duration-150 ${active ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-100'}`}
      onClick={onClick}
    >
      <div className="flex items-center flex-1">
        {/* 固定使用 TagIcon，颜色由 props 决定 */}
        <TagIcon size={18} className="mr-2 flex-shrink-0" style={{ color: tagColor }} />
        <span className="text-sm font-medium truncate" title={label}>{label}</span>
      </div>
      {/* 显示数量徽章 */}
      {count !== undefined && count > 0 && (
        <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 group-hover:bg-gray-200 transition-colors">
          {count}
        </span>
      )}
    </li>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  onNewPrompt,
  onOpenTagManager,
  onAllPromptsClick,
  onFavoritesClick,
  onTagClick,
  activeFilterMode,
  activeTagId,
  onOpenSettings,
  onRefreshPrompts
}) => {
  // tags 状态现在包含 count
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  
  // 云同步相关状态
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // 获取标签数据 - 改为可调用的函数
  const fetchTags = useCallback(async () => {
    try {
      setIsLoadingTags(true);
      const fetchedTags = await getAllTags(); // 获取带 count 的标签
      setTags(fetchedTags);
    } catch (err) {
      console.error('加载标签失败:', err);
    } finally {
      setIsLoadingTags(false);
    }
  }, []);

  // 初始加载标签和同步状态
  useEffect(() => {
    fetchTags();
    
    // 从localStorage加载最后同步时间
    const savedSyncTime = localStorage.getItem('lastSyncTime');
    if (savedSyncTime) {
      setLastSyncTime(savedSyncTime);
    }

    // 添加监听 tauri 事件，当标签数据变更时刷新列表
    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('tags-changed', () => {
          console.log('收到标签变更事件，刷新标签列表');
          fetchTags();
        });

        return unlisten;
      } catch (err) {
        console.error('设置标签变更监听失败:', err);
        return () => { };
      }
    };

    const unlistenPromise = setupListener();

    // 清理函数
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [fetchTags]);

  // 处理标签管理按钮点击
  const handleTagManagerClick = () => {
    // 打开标签管理器前刷新标签列表
    fetchTags().then(() => {
      if (onOpenTagManager) onOpenTagManager();
    });
  };

  // 处理云同步
  const handleSync = async () => {
    if (isSyncing) return; // 防止重复点击

    setIsSyncing(true);
    
    try {
      toast.info('开始同步...');
      
      // 检查飞书配置是否已设置
      const configExists = await invoke<boolean>('check_feishu_config_exists');
      if (!configExists) {
        throw new Error('飞书配置未设置，请先在设置中配置飞书应用信息');
      }
      
      // 获取本地所有提示词数据
      const localPrompts = await getAllPrompts();
      
      // 转换为后端所需的格式
      const promptRecords = localPrompts.map(convertPromptToRecord);
      
      // 调用带本地数据的同步命令
      const result = await invoke<{
        success: boolean;
        message: string;
        local_created: number;
        local_updated: number;
        remote_created: number;
        remote_updated: number;
        total_processed: number;
      }>('sync_with_local_data', {
        localPrompts: promptRecords
      });
      
      if (result.success) {
        // 更新最后同步时间
        const currentTime = new Date().toLocaleString('zh-CN');
        setLastSyncTime(currentTime);
        localStorage.setItem('lastSyncTime', currentTime);
        
        // 构建成功消息
        const statsMessage = [];
        if (result.local_created > 0) statsMessage.push(`本地新增 ${result.local_created} 条`);
        if (result.local_updated > 0) statsMessage.push(`本地更新 ${result.local_updated} 条`);
        if (result.remote_created > 0) statsMessage.push(`云端新增 ${result.remote_created} 条`);
        if (result.remote_updated > 0) statsMessage.push(`云端更新 ${result.remote_updated} 条`);
        
        const successMsg = statsMessage.length > 0 
          ? `同步成功！${statsMessage.join('，')}`
          : '同步成功！数据已是最新';
          
        toast.success(successMsg);
        
        // 刷新提示词列表
        if (onRefreshPrompts) {
          onRefreshPrompts();
        }
        
        // 刷新标签列表
        fetchTags();
      } else {
        toast.error(`同步失败：${result.message}`);
      }
    } catch (error) {
      console.error('同步失败:', error);
      toast.error(`同步失败：${error}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // 格式化最后同步时间显示
  const formatLastSyncTime = (timeString: string | null) => {
    if (!timeString) return '从未同步';
    
    const syncTime = new Date(timeString);
    const now = new Date();
    const diffMs = now.getTime() - syncTime.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return '刚刚同步';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}小时前`;
    return timeString;
  };

  return (
    <div className="w-60 h-full border-r border-gray-200 bg-white flex flex-col">
      <div className="p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-gray-800">提示词精灵</h1>
        </div>

        <div className="mb-2">
          <button
            className="w-full flex items-center justify-center py-2 px-4 bg-primary-50 text-primary-500 hover:bg-primary-100 rounded-lg transition-colors duration-150 shadow-sm"
            onClick={onNewPrompt}
          >
            <PlusCircleIcon size={18} className="mr-2" />
            <span className="text-sm font-medium">新建提示词</span>
          </button>
        </div>
      </div>

      <nav className="flex-1 px-2 overflow-y-auto hide-scrollbar">
        <ul>
          <SidebarItem
            icon={<FolderIcon size={18} />}
            label="所有提示词"
            active={activeFilterMode === 'all' && !activeTagId}
            onClick={onAllPromptsClick}
          />
          <SidebarItem
            icon={<StarIcon size={18} />}
            label="收藏提示词"
            active={activeFilterMode === 'favorites'}
            onClick={onFavoritesClick}
          />
        </ul>

        <div className="mt-6 mb-2 px-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">标签</h3>
          <button
            className="p-1 text-gray-400 hover:text-primary-500 rounded transition-colors"
            onClick={handleTagManagerClick}
            title="管理标签"
          >
            <CogIcon size={14} />
          </button>
        </div>

        {isLoadingTags ? (
          <div className="px-3 text-sm text-gray-500">加载中...</div>
        ) : (
          <ul>
            {tags.map(tag => (
              <TagSidebarItem
                key={tag.id}
                label={tag.name}
                tagColor={tag.color}
                count={tag.count}
                active={activeTagId === tag.id}
                onClick={() => onTagClick(tag.id)}
              />
            ))}
            {tags.length === 0 && !isLoadingTags && (
              <li className="px-3 py-2 text-sm text-gray-400">暂无标签</li>
            )}
          </ul>
        )}
      </nav>

      <div className="p-4 border-t border-gray-200 mt-auto space-y-3">
        {/* 云同步按钮 */}
        <div>
          <button 
            className={`flex items-center justify-center w-full py-2 px-3 rounded-lg transition-colors duration-150 text-sm font-medium ${
              isSyncing 
                ? 'bg-blue-100 text-blue-600 cursor-not-allowed' 
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            }`}
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <RefreshCwIcon size={16} className="mr-2 animate-spin" />
            ) : (
              <CloudIcon size={16} className="mr-2" />
            )}
            <span>{isSyncing ? '同步中...' : '云同步'}</span>
          </button>
          
          {/* 最后同步时间 */}
          <div className="text-xs text-gray-500 text-center mt-1">
            最后同步：{formatLastSyncTime(lastSyncTime)}
          </div>
        </div>

        {/* 设置按钮 */}
        <button className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-150 w-full" onClick={onOpenSettings}>
          <SettingsIcon size={18} className="mr-2" />
          <span className="text-sm">设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;