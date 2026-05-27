import { db, drafts, draftTransitions, postMetricsSnapshots, attributions } from '@paperclip/db';
import { eq, desc, asc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { SnapshotChart } from './SnapshotChart';

export const dynamic = 'force-dynamic';

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!row) notFound();
  const [history, snaps, atts] = await Promise.all([
    db
      .select()
      .from(draftTransitions)
      .where(eq(draftTransitions.draftId, id))
      .orderBy(desc(draftTransitions.at)),
    db
      .select()
      .from(postMetricsSnapshots)
      .where(eq(postMetricsSnapshots.draftId, id))
      .orderBy(asc(postMetricsSnapshots.capturedAt)),
    db
      .select()
      .from(attributions)
      .where(eq(attributions.draftId, id))
      .orderBy(desc(attributions.signedUpAt)),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Draft</h1>
        <p className="text-xs text-zinc-500">{row.id}</p>
      </header>
      <section className="rounded border border-zinc-300 dark:border-zinc-700 p-4">
        <div className="flex justify-between text-xs text-zinc-500 mb-2">
          <span>
            {row.platform.toUpperCase()} · {row.hookTag ?? 'no hook'}
          </span>
          <span>status: {row.status}</span>
        </div>
        <pre className="whitespace-pre-wrap text-sm font-sans">{row.body}</pre>
      </section>
      <section>
        <h2 className="text-lg font-medium mb-2">Performance ({atts.length} attributed signups)</h2>
        <SnapshotChart
          points={snaps.map((s) => ({
            capturedAt: s.capturedAt.toISOString(),
            impressions: s.impressions,
            engagement: s.engagement,
          }))}
        />
      </section>
      <section>
        <h2 className="text-lg font-medium mb-2">History</h2>
        <ol className="text-sm space-y-1">
          {history.map((h) => (
            <li key={h.id} className="font-mono">
              <span className="text-zinc-500">{h.at.toISOString()}</span>{' '}
              <span>
                {h.fromStatus ?? '∅'} → {h.toStatus}
              </span>{' '}
              <span className="text-zinc-500">({h.actor})</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
