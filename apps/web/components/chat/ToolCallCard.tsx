'use client';

interface ToolCallCardProps {
  toolName: string;
}

export function ToolCallCard({ toolName }: ToolCallCardProps) {
  return (
    <div className="flex justify-start">
      <div className="bg-blue-50 text-blue-700 rounded-xl px-4 py-2.5 text-sm animate-pulse">
        {toolName}
      </div>
    </div>
  );
}
