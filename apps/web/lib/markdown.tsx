'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';

const components: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse border border-gray-200 rounded">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left px-3 py-2 border-b border-gray-200 font-medium text-gray-600">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 border-b border-gray-100 text-gray-700">{children}</td>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-gray-50">{children}</tr>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-xs">
          <code>{children}</code>
        </pre>
      );
    }
    return <code className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-sm">{children}</li>,
  p: ({ children }) => <p className="my-1">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 pl-3 my-2 text-gray-600 italic">{children}</blockquote>
  ),
};

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
