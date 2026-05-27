import Link from 'next/link';
import { db, digests } from '@paperclip/db';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function DigestsPage() {
  const rows = await db.select().from(digests).orderBy(desc(digests.createdAt)).limit(50);
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Digests</h1>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((d) => (
          <li key={d.id} className="py-3">
            <Link href={`/digests/${d.id}`} className="block hover:underline">
              <span className="text-xs uppercase text-zinc-500 mr-2">{d.kind}</span>
              <span className="font-mono text-xs">{d.createdAt.toISOString().slice(0, 16)}</span>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-2">
                {d.contentMd.replace(/[#*]/g, '').slice(0, 200)}
              </p>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-6 text-center text-zinc-500">No digests yet.</li>
        )}
      </ul>
    </main>
  );
}
