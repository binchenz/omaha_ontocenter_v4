'use client';

import Link from 'next/link';

export default function QueryPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">数据查询</h1>
        <p className="text-sm text-gray-500 mt-0.5">使用 AI 对话查询数据</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <p className="text-gray-600 mb-4">数据查询已升级为 AI 对话模式，请前往对话页面。</p>
        <Link
          href="/chat"
          className="inline-flex items-center px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          前往 AI 对话
        </Link>
      </div>
    </div>
  );
}
