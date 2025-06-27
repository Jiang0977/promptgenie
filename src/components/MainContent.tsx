import React, { useState } from 'react';
import Header from './Header';
import PromptGrid from './PromptGrid';
import PromptList from './PromptList';
import { Prompt } from '../services/db';

type MainContentProps = {
  title: string;
  prompts: Prompt[];
  isLoading: boolean;
  error: string | null;
  onFavoriteToggle: (id: string) => void;
  onEdit: (prompt: Prompt) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
};

const MainContent: React.FC<MainContentProps> = ({
  title,
  prompts,
  isLoading,
  error,
  onFavoriteToggle,
  onEdit,
  onDelete,
  onCopy,
  searchTerm,
  onSearchChange,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title={title}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
      />
      <div className="flex-1 overflow-y-auto bg-gray-50 hide-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            <span className="ml-2 text-gray-600">加载中...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-red-400">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p className="text-lg font-medium">出错了</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <p className="text-lg">没有提示词</p>
            <p className="text-sm mt-1">点击右下角的按钮添加一个提示词</p>
          </div>
        ) : viewMode === 'grid' ? (
          <PromptGrid
            prompts={prompts}
            onFavoriteToggle={onFavoriteToggle}
            onCopy={onCopy}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <PromptList
            prompts={prompts}
            onFavoriteToggle={onFavoriteToggle}
            onCopy={onCopy}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
};

export default MainContent;