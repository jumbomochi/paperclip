'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Draft {
  id: string;
  platform: string;
  body: string;
  hookTag: string | null;
  status: string;
}

export function LinkedInPasteCard({ draft }: { draft: Draft }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function copyAndOpen() {
    void navigator.clipboard.writeText(draft.body);
    window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank', 'noopener,noreferrer');
  }

  function markPosted() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/drafts/${draft.id}/mark-posted`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error?.toString() ?? 'unknown');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-400 dark:border-amber-600 p-4 space-y-3 bg-amber-50/40 dark:bg-amber-950/20">
      <div className="flex justify-between text-xs text-zinc-500">
        <span className="uppercase">LINKEDIN · awaiting paste</span>
        <span>{draft.hookTag ?? 'no hook tag'}</span>
      </div>
      <pre className="whitespace-pre-wrap text-sm font-sans">{draft.body}</pre>
      <button onClick={copyAndOpen} className="rounded bg-sky-700 px-3 py-1 text-sm text-white">
        Copy + open LinkedIn compose
      </button>
      <div className="space-y-2">
        <label className="block text-xs text-zinc-500">
          After posting, paste the LinkedIn post URL:
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/posts/..."
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-1 text-sm"
        />
        <button
          onClick={markPosted}
          disabled={pending || !url}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Mark as posted
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
