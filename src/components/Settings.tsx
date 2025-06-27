import React, { useState, useEffect } from 'react';
import { XIcon, CloudIcon, TestTubeIcon, SaveIcon, AlertCircleIcon, CheckCircleIcon, InfoIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

// 定义组件Props
interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

// 飞书配置接口
interface FeishuConfig {
  app_id: string;
  app_secret: string;
  base_url: string;
  app_token: string;
  table_id: string;
  enabled: boolean;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const [trayAutoInsert, setTrayAutoInsert] = useState<boolean>(true);
  const [accessibilityStatus, setAccessibilityStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  
  // 飞书同步相关状态
  const [feishuConfig, setFeishuConfig] = useState<{
    app_id: string;
    app_secret: string;
    base_url: string;
    enabled: boolean;
  }>({
    app_id: '',
    app_secret: '',
    base_url: '',
    enabled: false,
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'success' | 'failed'>('unknown');

  // 加载设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // 从 localStorage 加载设置
        const savedSetting = localStorage.getItem('trayAutoInsert');
        setTrayAutoInsert(savedSetting !== 'false'); // 默认为 true

        // 检查系统权限状态（暂时跳过，因为这个功能还未实现）
        // 注意：check_accessibility_permission 命令尚未在Rust端实现
        setAccessibilityStatus('unknown');

        // 加载飞书配置
        try {
          const config = await invoke<FeishuConfig | null>('get_feishu_config');
          if (config) {
            setFeishuConfig({
              app_id: config.app_id,
              app_secret: config.app_secret,
              base_url: config.base_url,
              enabled: config.enabled,
            });
          }
        } catch (err) {
          console.error('加载飞书配置失败:', err);
        }
      } catch (err) {
        console.error('加载设置失败:', err);
      }
    };

    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  // "自动插入提示词"开关的即时保存处理函数
  const handleTrayAutoInsertChange = async (checked: boolean) => {
    setTrayAutoInsert(checked);
    try {
      localStorage.setItem('trayAutoInsert', checked.toString());
      toast.success(`"自动插入提示词" 已${checked ? '开启' : '关闭'}`);
      // 如果启用了功能但没有权限，提示用户
      if (checked && accessibilityStatus === 'denied') {
        openAccessibilitySettings();
      }
    } catch (err) {
      console.error('保存设置失败:', err);
      toast.error('保存设置失败');
    }
  };

  // 保存飞书配置 - 提取为可复用函数
  const saveFeishuConfigInternal = async (showToast = true) => {
    if (!feishuConfig.app_id.trim() || !feishuConfig.app_secret.trim() || !feishuConfig.base_url.trim()) {
      if (showToast) {
        toast.error('请填写完整的飞书配置信息');
      }
      return false;
    }

    try {
      await invoke('save_feishu_config', {
        appId: feishuConfig.app_id.trim(),
        appSecret: feishuConfig.app_secret.trim(),
        baseUrl: feishuConfig.base_url.trim(),
      });
      
      if (showToast) {
        toast.success('飞书配置保存成功');
      }
      setConnectionStatus('unknown'); // 重置连接状态
      return true;
    } catch (error) {
      console.error('保存飞书配置失败:', error);
      if (showToast) {
        toast.error(`保存配置失败: ${error}`);
      }
      return false;
    }
  };

  // 保存飞书配置 - 公开接口
  const saveFeishuConfig = async () => {
    setIsSavingConfig(true);
    try {
      await saveFeishuConfigInternal(true);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // 测试飞书连接 - 修改为先保存后测试
  const testFeishuConnection = async () => {
    // 先检查输入是否完整
    if (!feishuConfig.app_id.trim() || !feishuConfig.app_secret.trim() || !feishuConfig.base_url.trim()) {
      toast.error('请填写完整的飞书配置信息');
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('testing');
    
    try {
      // 先保存配置（不显示保存成功的提示）
      const saveSuccess = await saveFeishuConfigInternal(false);
      
      if (!saveSuccess) {
        throw new Error('保存配置失败');
      }

      // 然后执行测试
      const result = await invoke<string>('test_feishu_connection');
      setConnectionStatus('success');
      toast.success(`配置已保存并测试成功：${result}`);
    } catch (error) {
      console.error('测试飞书连接失败:', error);
      setConnectionStatus('failed');
      toast.error(`连接测试失败: ${error}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  // 查看表格字段信息
  const checkTableFields = async () => {
    try {
      const result = await invoke<string>('get_feishu_table_fields');
      console.log('表格字段信息:', result);
      
      // 尝试解析JSON并显示字段名称
      try {
        const fieldsData = JSON.parse(result);
        if (fieldsData.code === 0 && fieldsData.data && fieldsData.data.items) {
          const fieldNames = fieldsData.data.items.map((field: any) => field.field_name);
          toast.success(`表格字段: ${fieldNames.join(', ')}`);
        } else {
          toast.info('查看控制台获取详细字段信息');
        }
      } catch (parseError) {
        toast.info('查看控制台获取详细字段信息');
      }
    } catch (error) {
      console.error('获取表格字段失败:', error);
      toast.error(`获取字段信息失败: ${error}`);
    }
  };

  // 打开系统辅助功能设置
  const openAccessibilitySettings = async () => {
    try {
      await invoke('open_accessibility_settings');
    } catch (err) {
      console.error('打开系统设置失败:', err);
      // 回退方案：显示说明
      alert('请打开系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能，并为PromptGenie启用权限');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-800">设置</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="关闭"
          >
            <XIcon size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6 overflow-y-auto">
          {/* 飞书云同步设置 */}
          <div>
            <div className="flex items-center mb-4">
              <CloudIcon size={20} className="text-blue-600 mr-2" />
              <h3 className="text-lg font-medium text-gray-800">飞书云同步</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  飞书 App ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={feishuConfig.app_id}
                  onChange={(e) => setFeishuConfig(prev => ({ ...prev, app_id: e.target.value }))}
                  placeholder="请输入飞书应用的 App ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  飞书 App Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={feishuConfig.app_secret}
                  onChange={(e) => setFeishuConfig(prev => ({ ...prev, app_secret: e.target.value }))}
                  placeholder="请输入飞书应用的 App Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  飞书多维表格 URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={feishuConfig.base_url}
                  onChange={(e) => setFeishuConfig(prev => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://yourdomain.feishu.cn/base/xxxxxxx?table=xxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  请从飞书多维表格中复制完整的URL地址
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={saveFeishuConfig}
                  disabled={isSavingConfig}
                  className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                >
                  <SaveIcon size={16} className="mr-2" />
                  {isSavingConfig ? '保存中...' : '保存配置'}
                </button>

                <button
                  onClick={testFeishuConnection}
                  disabled={isTestingConnection}
                  className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg transition-colors"
                  title="将自动保存配置后进行连接测试"
                >
                  <TestTubeIcon size={16} className="mr-2" />
                  {isTestingConnection ? '保存并测试中...' : '保存并测试'}
                </button>

                {/* 调试按钮，仅在开发环境显示 */}
                {import.meta.env.DEV && (
                  <button
                    onClick={checkTableFields}
                    className="flex items-center px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
                  >
                    <InfoIcon size={16} className="mr-2" />
                    查看字段
                  </button>
                )}
              </div>

              {/* 连接状态显示 */}
              {connectionStatus !== 'unknown' && (
                <div className={`flex items-center p-3 rounded-lg ${
                  connectionStatus === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : connectionStatus === 'failed'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {connectionStatus === 'success' && <CheckCircleIcon size={16} className="mr-2" />}
                  {connectionStatus === 'failed' && <AlertCircleIcon size={16} className="mr-2" />}
                  {connectionStatus === 'testing' && <div className="w-4 h-4 mr-2 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
                  
                  <span className="text-sm">
                    {connectionStatus === 'success' && '连接测试成功，配置有效'}
                    {connectionStatus === 'failed' && '连接测试失败，请检查配置信息'}
                    {connectionStatus === 'testing' && '正在测试连接...'}
                  </span>
                </div>
              )}

              {/* 配置说明 */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h4 className="text-sm font-medium text-blue-800 mb-2">配置说明</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• 需要先在飞书开放平台创建企业自建应用并获得App ID和App Secret</li>
                  <li>• 需要在飞书中创建多维表格，并确保应用有读写权限</li>
                  <li>• 表格需要包含：id、title、content、tags、isFavorite、createdAt、updatedAt、lastUsed字段</li>
                  <li>• 配置保存后，可以在主界面使用云同步功能</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 托盘菜单设置 */}
          <div>
            <h3 className="text-lg font-medium text-gray-800 mb-2">托盘菜单设置</h3>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-gray-800">自动插入提示词</p>
                <p className="text-sm text-gray-500">
                  从托盘菜单选择提示词时，自动插入到当前活动的输入框
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={trayAutoInsert}
                  onChange={(e) => handleTrayAutoInsertChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {trayAutoInsert && (
              <div className="mt-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                <p className="text-sm text-yellow-700 mb-2">
                  此功能需要系统辅助功能权限才能模拟键盘输入。
                </p>

                {accessibilityStatus === 'denied' && (
                  <button
                    onClick={openAccessibilitySettings}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
                  >
                    打开系统权限设置
                  </button>
                )}

                {accessibilityStatus === 'granted' && (
                  <p className="text-sm text-green-600">
                    已获得辅助功能权限，自动插入功能可正常工作。
                  </p>
                )}

                {accessibilityStatus === 'unknown' && (
                  <p className="text-sm text-yellow-600">
                    无法检查权限状态，功能可能无法正常工作。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings; 