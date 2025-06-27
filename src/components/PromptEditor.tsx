import React, { useState, useEffect, useRef } from 'react';
// @ts-ignore
import { XIcon, TagIcon, PlusIcon } from 'lucide-react';
import { Tag, Prompt, PromptInput, getAllTags } from '../services/db';

type PromptEditorProps = {
  isOpen: boolean;
  promptToEdit?: Prompt | null;
  onClose: () => void;
  onSave: (promptData: PromptInput) => void;
};

const PromptEditor: React.FC<PromptEditorProps> = ({
  isOpen,
  promptToEdit,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]); // 新增：所有已知标签

  const [newTagName, setNewTagName] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);

  // 预定义的颜色列表
  const colorOptions = [
    '#3B82F6', // 蓝色
    '#10B981', // 绿色
    '#8B5CF6', // 紫色
    '#EC4899', // 粉色
    '#F59E0B', // 橙色
    '#6366F1', // 靛蓝色
    '#EF4444', // 红色
    '#14B8A6', // 青色
    '#9333EA', // 深紫色
    '#F97316', // 深橙色
  ];

  // 获取随机颜色
  const getRandomColor = () => {
    const randomIndex = Math.floor(Math.random() * colorOptions.length);
    return colorOptions[randomIndex];
  };

  // 新增：获取所有标签
  const fetchAllTags = async () => {
    try {
      const fetchedTags = await getAllTags();
      setAllTags(fetchedTags);
    } catch (error) {
      console.error('获取标签失败:', error);
    }
  };

  useEffect(() => {
    if (isOpen && promptToEdit) {
      setTitle(promptToEdit.title || '');
      setContent(promptToEdit.content || '');
      setTags(promptToEdit.tags || []);
    } else {
      setTitle('');
      setContent('');
      setTags([]);
    }
    setNewTagName('');
    
    // 当编辑器打开时获取所有标签
    if (isOpen) {
      fetchAllTags();
    }
  }, [isOpen, promptToEdit]);

  // 新增：快速添加已有标签
  const handleQuickAddTag = (tag: Tag) => {
    // 检查是否已经添加过这个标签
    const isAlreadyAdded = tags.some(existingTag => 
      existingTag.id === tag.id || existingTag.name === tag.name
    );
    
    if (!isAlreadyAdded) {
      setTags(prev => [...prev, tag]);
    }
  };

  // 新增：检查标签是否已被选中
  const isTagSelected = (tag: Tag) => {
    return tags.some(existingTag => 
      existingTag.id === tag.id || existingTag.name === tag.name
    );
  };

  const handleAddTag = () => {
    if (!newTagName.trim()) return;

    // 创建新标签 (不生成前端 ID)
    const newTag = {
      name: newTagName.trim(),
      color: getRandomColor(),
    };

    // 添加到标签列表 (需要断言类型，因为缺少 id)
    setTags(prev => [...prev, newTag as Tag]); // 断言为 Tag 类型以匹配状态

    // 清空输入
    setNewTagName('');
    if (tagInputRef.current) {
      tagInputRef.current.focus();
    }
  };

  const handleRemoveTag = (tagId: string) => {
    if (!tagId) return; // 添加安全检查
    setTags(prev => prev.filter(tag => tag.id && tag.id !== tagId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title,
      content,
      tags,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            {promptToEdit ? '编辑提示词' : '创建提示词'}
          </h2>
          <button
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
            onClick={onClose}
          >
            <XIcon size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="mb-5">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              标题
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 text-gray-800 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-colors"
              placeholder="输入提示词标题..."
              required
            />
          </div>

          <div className="mb-5">
            <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
              提示词内容
            </label>
            <textarea
              id="content"
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-4 py-3 text-gray-800 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-colors min-h-[200px] resize-none"
              placeholder="在这里输入提示词内容..."
              required
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              标签
            </label>

            <div className="flex mb-2">
              <input
                type="text"
                ref={tagInputRef}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="flex-1 px-4 py-2 text-gray-800 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-colors"
                placeholder="输入新标签..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />

              <button
                type="button"
                onClick={handleAddTag}
                className="ml-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                添加
              </button>
            </div>

            <div className="flex flex-wrap gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg min-h-[44px]">
              {tags.length === 0 ? (
                <div className="text-sm text-gray-400 flex items-center">
                  <TagIcon size={16} className="mr-1" />
                  无标签
                </div>
              ) : (
                tags.map(tag => (
                  <div
                    key={tag.id}
                    className="flex items-center px-3 py-1 rounded-full text-sm"
                    style={{
                      backgroundColor: `${tag.color}15`,
                      color: tag.color
                    }}
                  >
                    <span>{tag.name}</span>
                    <button
                      type="button"
                      className="ml-1 p-0.5 rounded-full hover:bg-white hover:bg-opacity-30"
                      onClick={() => handleRemoveTag(tag.id)}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 新增：快速选择已有标签 */}
          {allTags.length > 0 && (
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                快速选择标签
              </label>
              <div className="flex flex-wrap gap-2">
                {allTags.map(tag => {
                  const isSelected = isTagSelected(tag);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleQuickAddTag(tag)}
                      disabled={isSelected}
                      className={`flex items-center px-3 py-1 rounded-full text-sm transition-all ${
                        isSelected 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'hover:shadow-sm cursor-pointer'
                      }`}
                      style={{
                        backgroundColor: isSelected ? `${tag.color}30` : `${tag.color}15`,
                        color: tag.color,
                        border: isSelected ? `1px solid ${tag.color}50` : `1px solid transparent`
                      }}
                      title={isSelected ? '已添加此标签' : `点击添加 ${tag.name} 标签`}
                    >
                      <TagIcon size={12} className="mr-1" />
                      {tag.name}
                      {isSelected && (
                        <span className="ml-1 text-xs">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                点击标签即可快速添加，已选择的标签将显示勾号
              </p>
            </div>
          )}
        </form>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            onClick={handleSubmit}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptEditor;