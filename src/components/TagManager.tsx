import React, { useState, useEffect } from 'react';
import { getAllTags, deleteTag, updateTag, Tag } from '../services/db';
import { X, Edit2, Trash2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

interface TagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onTagsChanged: () => void;
}

const TagManager: React.FC<TagManagerProps> = ({ isOpen, onClose }) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // 确认对话框状态
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);

  // 预定义颜色选项
  const colorOptions = [
    '#EF4444', // 红色
    '#F59E0B', // 琥珀色
    '#10B981', // 绿色
    '#3B82F6', // 蓝色
    '#8B5CF6', // 紫色
    '#EC4899', // 粉色
    '#6B7280', // 灰色
    '#000000', // 黑色
  ];

  // 加载标签
  const loadTags = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loadedTags = await getAllTags();
      setTags(loadedTags);
    } catch (err) {
      console.error('加载标签失败:', err);
      setError('加载标签失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadTags();
    }
  }, [isOpen]);

  // 开始编辑标签
  const startEditing = (tag: Tag) => {
    if (!tag.id) {
      console.error("编辑标签时ID无效:", tag);
      return;
    }
    setEditingTagId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  // 取消编辑
  const cancelEditing = () => {
    setEditingTagId(null);
    setEditName('');
    setEditColor('');
  };

  // 保存标签编辑
  const saveTagEdit = async () => {
    if (!editingTagId) return;

    try {
      setError(null);
      setIsLoading(true);

      const success = await updateTag(editingTagId, editName, editColor);

      if (success) {
        // 更新本地状态
        setTags(prev => prev.map(tag =>
          tag.id === editingTagId
            ? { ...tag, name: editName, color: editColor }
            : tag
        ));

        // 通知应用标签已更新
        try {
          const { emit } = await import('@tauri-apps/api/event');
          await emit('tags-changed', { action: 'update', id: editingTagId });
          console.log('已发送标签更新事件');
        } catch (err) {
          console.error('发送标签更新事件失败:', err);
        }

        // 重置编辑状态
        cancelEditing();
      } else {
        throw new Error('更新标签失败');
      }
    } catch (err) {
      console.error('更新标签失败:', err);
      setError('更新标签失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 开始删除流程 - 打开确认对话框
  const startDelete = (id: string) => {
    if (!id) {
      console.error("删除标签时ID无效:", id);
      return;
    }
    console.log("准备删除标签ID:", id);
    setTagToDelete(id);
    setIsConfirmOpen(true);
  };

  // 执行删除
  const executeDelete = async () => {
    if (!tagToDelete) return;

    try {
      setIsLoading(true);
      setError(null);
      console.log("执行删除标签:", tagToDelete);

      // 执行删除操作
      const result = await deleteTag(tagToDelete);

      if (result) {
        console.log("删除标签成功");

        // 从状态中移除已删除的标签
        setTags(prev => prev.filter(tag => tag.id !== tagToDelete));

        // 尝试通知其他组件
        try {
          const { emit } = await import('@tauri-apps/api/event');
          await emit('tags-changed', { action: 'delete', id: tagToDelete });
        } catch (e) {
          console.error("发送标签变更事件失败:", e);
        }
      } else {
        throw new Error("删除标签失败");
      }
    } catch (err) {
      console.error("删除标签出错:", err);
      setError("删除标签失败，请稍后重试");
    } finally {
      setTagToDelete(null); // 清除要删除的标签ID
      setIsLoading(false);
    }
  };

  // 取消删除
  const cancelDelete = () => {
    setIsConfirmOpen(false);
    setTagToDelete(null);
  };

  // 确认删除
  const confirmDelete = () => {
    setIsConfirmOpen(false);
    executeDelete();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-800">标签管理</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto hide-scrollbar">
          {isLoading && <div className="text-center py-4">加载中...</div>}

          {error && <div className="text-red-500 py-2 mb-4">{error}</div>}

          {!isLoading && tags.length === 0 ? (
            <div className="text-gray-500 py-4 text-center">暂无标签</div>
          ) : (
            <ul className="space-y-2">
              {tags.map(tag => (
                <li key={tag.id} className="border border-gray-200 rounded-lg p-3">
                  {editingTagId === tag.id ? (
                    // 编辑UI
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          标签名称
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                          placeholder="输入标签名称"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          标签颜色
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          {colorOptions.map(color => (
                            <button
                              key={color}
                              type="button"
                              className={`w-6 h-6 rounded-full ${editColor === color ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                              style={{ backgroundColor: color }}
                              onClick={() => setEditColor(color)}
                              aria-label={`选择颜色 ${color}`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end space-x-2 mt-3">
                        <button
                          onClick={cancelEditing}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          onClick={saveTagEdit}
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600"
                          disabled={!editName.trim()}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 正常显示UI
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div
                          className="w-4 h-4 rounded-full mr-3"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-gray-800">{tag.name}</span>
                        {tag.count !== undefined && (
                          <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {tag.count}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          className="p-1 text-gray-400 hover:text-blue-500"
                          onClick={() => startEditing(tag)}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-gray-400 hover:text-red-500"
                          onClick={() => startDelete(tag.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md"
          >
            关闭
          </button>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="确认删除"
        message="确定要删除这个标签吗？此操作无法撤销，并且将从所有提示词中移除此标签。"
        confirmText="删除"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
};

export default TagManager; 