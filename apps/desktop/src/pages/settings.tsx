export function SettingsPage() {
  return (
    <div className="settings-page space-y-6">
      <div className="mb-8">
        <h1 className="headline-lg text-on-surface">设置</h1>
        <p className="body-md text-on-surface-variant mt-2">
          配置应用偏好设置
        </p>
      </div>

      <div className="glass-card p-6">
        <h2 className="headline-sm text-on-surface mb-4">外观设置</h2>
        <div className="space-y-4">
          <div>
            <label className="label-md text-on-surface block mb-2">主题</label>
            <select className="w-full h-10 px-4 rounded-lg bg-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
              <option>浅色</option>
              <option>深色</option>
              <option>自动</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
