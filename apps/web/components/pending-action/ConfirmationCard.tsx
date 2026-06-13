'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

interface ConfirmationCardProps {
  actionId: string;
  summary: string;
  previewRows?: Record<string, unknown>[];
  onConfirmed?: () => void;
  onCancelled?: () => void;
}

export function ConfirmationCard({ actionId, summary, previewRows, onConfirmed, onCancelled }: ConfirmationCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: 'confirm' | 'cancel') {
    setLoading(true);
    setError(null);
    try {
      if (action === 'confirm') {
        await api.confirmAction(actionId);
        onConfirmed?.();
      } else {
        await api.cancelAction(actionId);
        onCancelled?.();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  const columns = previewRows?.length ? Object.keys(previewRows[0]) : [];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-sm">{summary}</p>

      {previewRows && previewRows.length > 0 && (
        <div className="overflow-auto max-h-48">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className="border px-2 py-1 text-left font-medium bg-muted">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} className="border px-2 py-1">{String(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => handle('confirm')}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          onClick={() => handle('cancel')}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded border disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
