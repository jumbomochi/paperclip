'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Draft {
  id: string;
  platform: string;
  body: string;
  hookTag: string | null;
  createdAt: Date;
}

export function DraftCard({ draft }: { draft: Draft }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function transition(to: string) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/drafts/${draft.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? 'unknown error');
        return;
      }
      router.refresh();
    });
  }

  const charCount = draft.body.length;
  const overLimit = draft.platform === 'x' && charCount > 280;

  return (
    <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="uppercase">{draft.platform}</span>
        <span>{draft.hookTag ?? 'no hook tag'}</span>
      </div>
      <pre className="whitespace-pre-wrap text-sm font-sans">{draft.body || '(empty)'}</pre>
      <div className={`text-xs ${overLimit ? 'text-red-600' : 'text-zinc-500'}`}>
        {charCount} chars
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => transition(draft.platform === 'linkedin' ? 'awaiting_paste' : 'approved')}
          disabled={isPending}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => transition('rejected')}
          disabled={isPending}
          className="rounded bg-zinc-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
