'use client';

interface InputBarProps {
  input: string;
  isLoading: boolean;
  attachedFile: { fileId: string; name: string; size: number } | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFile: () => void;
}

export function InputBar({
  input,
  isLoading,
  attachedFile,
  fileInputRef,
  onInputChange,
  onSubmit,
  onFileSelect,
  onClearFile,
}: InputBarProps) {
  return (
    <div>
      {attachedFile && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center gap-2">
          <span className="text-xs text-gray-600">
            📎 {attachedFile.name} ({(attachedFile.size / 1024).toFixed(0)} KB)
          </span>
          <button onClick={onClearFile} className="text-xs text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      <form onSubmit={onSubmit} className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="上传文件"
          >
            📎
          </button>
          <input
            ref={fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFileSelect}
            className="hidden"
          />
          <input
            type="text"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            placeholder="输入你的问题..."
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || (!input.trim() && !attachedFile)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {isLoading ? '...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  );
}
