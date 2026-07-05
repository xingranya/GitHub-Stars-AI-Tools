export function AISearchPage() {
  return (
    <div className="ai-search-page space-y-6">
      <div className="mb-8">
        <h1 className="headline-lg text-on-surface">AI 智能搜索</h1>
        <p className="body-md text-on-surface-variant mt-2">
          使用自然语言搜索你的知识库
        </p>
      </div>

      <div className="glass-card p-6">
        <textarea
          placeholder="例如：找出所有关于机器学习的 Python 项目..."
          className="w-full h-32 p-4 rounded-lg bg-surface-container text-on-surface placeholder:text-on-surface-variant resize-none focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex justify-end mt-4">
          <button className="px-6 py-3 rounded-xl bg-primary text-white btn-scale-hover">
            搜索
          </button>
        </div>
      </div>
    </div>
  );
}
