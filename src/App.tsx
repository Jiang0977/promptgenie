import React, { useState, useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import PromptEditor from './components/PromptEditor';
import TagManager from './components/TagManager';
import Settings from './components/Settings';
import ConfirmDialog from './components/ConfirmDialog';
import {
  initDatabase,
  getAllPrompts,
  createPrompt,
  updatePrompt,
  toggleFavorite,
  deletePrompt,
  Prompt,
  PromptInput,
  updateTrayMenu,
  copyPromptToClipboard,
  getPrompt,
  updatePromptLastUsed,
} from './services/db';

function App() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'favorites'>('all');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const filteredPrompts = React.useMemo(() => {
    let result = [...prompts];
    if (filterMode === 'favorites') {
      result = result.filter(p => p.isFavorite);
    }
    if (selectedTagId) {
      result = result.filter(p => p.tags.some(tag => tag.id === selectedTagId));
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        p =>
          p.title.toLowerCase().includes(term) ||
          p.content.toLowerCase().includes(term) ||
          p.tags.some(tag => tag.name.toLowerCase().includes(term))
      );
    }
    return result;
  }, [prompts, filterMode, selectedTagId, searchTerm]);

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [promptToDeleteId, setPromptToDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        await initDatabase();
        const loadedPrompts = await getAllPrompts();
        setPrompts(loadedPrompts);
        updateTrayMenu().catch(err => console.error('启动时更新托盘菜单失败:', err));

        const { listen } = await import('@tauri-apps/api/event');


        const unlistenCopyPrompt = await listen('copy-prompt-to-clipboard', async event => {
          const promptId = event.payload as string;
          try {
            const prompt = await getPrompt(promptId);
            if (!prompt) return;
            const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
            await writeText(prompt.content);
            const trayAutoInsert = localStorage.getItem('trayAutoInsert') !== 'false';
            console.log('自动插入设置:', trayAutoInsert);
            if (trayAutoInsert) {
              console.log('正在调用 simulate_paste...');
              const { invoke } = await import('@tauri-apps/api/core');
              try {
                await invoke('simulate_paste');
                console.log('simulate_paste 调用完成');
                toast.success('已自动粘贴到当前输入框');
              } catch (pasteErr) {
                console.error('自动粘贴失败:', pasteErr);
                toast.info('内容已复制到剪贴板，请手动粘贴 (Ctrl+V)');
              }
            } else {
              console.log('自动插入已禁用');
              toast.info('内容已复制到剪贴板');
            }
            await updatePromptLastUsed(promptId);
          } catch (err) {
            console.error('复制提示词内容时出错:', err);
            toast.error('操作失败，请重试');
          }
        });

        // 监听飞书同步事件
        const unlistenSyncCreateLocal = await listen('sync-create-local', async event => {
          try {
            console.log('收到创建本地记录事件:', event.payload);
            const { handleSyncCreateLocal } = await import('./services/db');
            await handleSyncCreateLocal(event.payload as any[]);
            toast.success('成功创建云端同步的新记录');
            // 刷新提示词列表
            const refreshedPrompts = await getAllPrompts();
            setPrompts(refreshedPrompts);
          } catch (err) {
            console.error('处理同步创建事件失败:', err);
            toast.error('同步创建记录失败');
          }
        });

        const unlistenSyncUpdateLocal = await listen('sync-update-local', async event => {
          try {
            console.log('收到更新本地记录事件:', event.payload);
            const { handleSyncUpdateLocal } = await import('./services/db');
            await handleSyncUpdateLocal(event.payload as any[]);
            toast.success('成功更新云端同步的记录');
            // 刷新提示词列表
            const refreshedPrompts = await getAllPrompts();
            setPrompts(refreshedPrompts);
          } catch (err) {
            console.error('处理同步更新事件失败:', err);
            toast.error('同步更新记录失败');
          }
        });

        return () => {
          unlistenCopyPrompt();
          unlistenSyncCreateLocal();
          unlistenSyncUpdateLocal();
        };
      } catch (err) {
        console.error('App: 加载数据失败:', err);
        setError('无法加载数据，请检查数据库连接或重启应用。');
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleEditorOpen = (prompt?: Prompt) => {
    setEditingPrompt(prompt || null);
    setIsEditorOpen(true);
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingPrompt(null);
  };

  const handleSavePrompt = async (promptData: PromptInput) => {
    try {
      if (editingPrompt && editingPrompt.id) {
        const updated = await updatePrompt(editingPrompt.id, promptData);
        setPrompts(prompts.map(p => (p.id === updated.id ? updated : p)));
      } else {
        const newPrompt = await createPrompt(promptData);
        setPrompts([newPrompt, ...prompts]);
      }
      handleEditorClose();
    } catch (err) {
      console.error('保存提示词失败:', err);
      setError('保存提示词失败，请重试。');
    }
  };

  const handleDeletePrompt = (id: string) => {
    setPromptToDeleteId(id);
    setIsConfirmOpen(true);
  };

  const confirmDeletion = async () => {
    if (!promptToDeleteId) return;
    try {
      await deletePrompt(promptToDeleteId);
      setPrompts(prompts.filter(p => p.id !== promptToDeleteId));
    } catch (err) {
      console.error('删除提示词失败:', err);
      setError('删除提示词失败，请重试。');
    } finally {
      setIsConfirmOpen(false);
      setPromptToDeleteId(null);
    }
  };

  const cancelDeletion = () => {
    setIsConfirmOpen(false);
    setPromptToDeleteId(null);
  };

  const handleFavoriteToggle = async (id: string) => {
    try {
      const isFavorite = await toggleFavorite(id);
      setPrompts(prompts.map(p => (p.id === id ? { ...p, isFavorite } : p)));
      if (isFavorite) {
        toast.success('已收藏');
      } else {
        toast.info('已取消收藏');
      }
    } catch (err) {
      console.error('切换收藏状态失败:', err);
      toast.error('操作失败，请重试');
    }
  };

  const handleCopy = async (id: string) => {
    try {
      const success = await copyPromptToClipboard(id);
      if (success) {
        toast.success('提示词已复制到剪贴板');
      } else {
        toast.error('复制失败');
      }
    } catch (err) {
      console.error('复制提示词失败:', err);
      toast.error('复制失败，请查看控制台日志');
    }
  };

  const handleTagsChanged = async () => {
    try {
      setIsLoading(true);
      const loadedPrompts = await getAllPrompts();
      setPrompts(loadedPrompts);
    } catch (err) {
      console.error('刷新提示词列表失败:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 新增：刷新提示词列表（用于同步后更新）
  const handleRefreshPrompts = async () => {
    try {
      const loadedPrompts = await getAllPrompts();
      setPrompts(loadedPrompts);
      // 更新托盘菜单
      await updateTrayMenu();
    } catch (err) {
      console.error('刷新提示词列表失败:', err);
    }
  };

  const openTagManager = () => setIsTagManagerOpen(true);
  const closeTagManager = () => {
    setIsTagManagerOpen(false);
    handleTagsChanged();
  };

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  const handleFavoritesClick = () => {
    setFilterMode('favorites');
    setSelectedTagId(null);
  };

  const handleAllPromptsClick = () => {
    setFilterMode('all');
    setSelectedTagId(null);
  };

  const handleTagClick = (tagId: string) => {
    if (selectedTagId === tagId) {
      setSelectedTagId(null);
    } else {
      setFilterMode('all');
      setSelectedTagId(tagId);
    }
  };

  const handleSearchChange = (term: string) => setSearchTerm(term);

  const getContentTitle = () => {
    if (filterMode === 'favorites') return '收藏';
    if (selectedTagId) {
      const tag = prompts.flatMap(p => p.tags).find(t => t.id === selectedTagId);
      return tag ? `标签: ${tag.name}` : '全部';
    }
    return '全部';
  };

  return (
    <div className="flex h-screen bg-white font-sans">
      <Toaster richColors position="top-center" />
      <Sidebar
        onNewPrompt={handleEditorOpen}
        onOpenTagManager={openTagManager}
        onAllPromptsClick={handleAllPromptsClick}
        onFavoritesClick={handleFavoritesClick}
        onTagClick={handleTagClick}
        activeFilterMode={filterMode}
        activeTagId={selectedTagId}
        onOpenSettings={openSettings}
        onRefreshPrompts={handleRefreshPrompts}
      />
      <div className="flex flex-1 flex-col border-l border-gray-200">
        <MainContent
          title={getContentTitle()}
          prompts={filteredPrompts}
          isLoading={isLoading}
          error={error}
          onFavoriteToggle={handleFavoriteToggle}
          onEdit={handleEditorOpen}
          onDelete={handleDeletePrompt}
          onCopy={handleCopy}
          onSearchChange={handleSearchChange}
          searchTerm={searchTerm}
        />
      </div>

      {isEditorOpen && (
        <PromptEditor
          isOpen={isEditorOpen}
          onClose={handleEditorClose}
          onSave={handleSavePrompt}
          promptToEdit={editingPrompt}
        />
      )}
      {isTagManagerOpen && (
        <TagManager
          isOpen={isTagManagerOpen}
          onClose={closeTagManager}
          onTagsChanged={handleTagsChanged}
        />
      )}
      {isSettingsOpen && <Settings isOpen={isSettingsOpen} onClose={closeSettings} />}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={cancelDeletion}
        onConfirm={confirmDeletion}
        title="确认删除"
        message="确定要删除这个提示词吗？此操作无法撤销。"
      />
    </div>
  );
}

export default App;