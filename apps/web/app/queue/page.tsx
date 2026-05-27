import { db, drafts, DraftStatus } from '@paperclip/db';
import { inArray, desc } from 'drizzle-orm';
import { DraftCard } from './DraftCard';
import { LinkedInPasteCard } from './LinkedInPasteCard';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const rows = await db
    .select()
    .from(drafts)
    .where(inArray(drafts.status, [DraftStatus.ApprovalQueue, DraftStatus.AwaitingPaste]))
    .orderBy(desc(drafts.updatedAt))
    .limit(50);

  const pending = rows.filter((r) => r.status === DraftStatus.ApprovalQueue);
  const awaiting = rows.filter((r) => r.status === DraftStatus.AwaitingPaste);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Queue</h1>
      {awaiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-amber-700 dark:text-amber-300">
            LinkedIn — {awaiting.length} awaiting your paste
          </h2>
          {awaiting.map((d) => (
            <LinkedInPasteCard
              key={d.id}
              draft={{
                id: d.id,
                platform: d.platform,
                body: d.body,
                hookTag: d.hookTag,
                status: d.status,
              }}
            />
          ))}
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Approval queue — {pending.length}</h2>
        {pending.length === 0 && (
          <p className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-zinc-500">
            Nothing waiting.
          </p>
        )}
        {pending.map((d) => (
          <DraftCard
            key={d.id}
            draft={{
              id: d.id,
              platform: d.platform,
              body: d.body,
              hookTag: d.hookTag,
              createdAt: d.createdAt,
            }}
          />
        ))}
      </section>
    </main>
  );
}
