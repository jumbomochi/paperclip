import { db, drafts, DraftStatus } from '@paperclip/db';
import { eq, desc } from 'drizzle-orm';
import { DraftCard } from './DraftCard';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const rows = await db
    .select()
    .from(drafts)
    .where(eq(drafts.status, DraftStatus.ApprovalQueue))
    .orderBy(desc(drafts.updatedAt))
    .limit(50);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Approval queue</h1>
      <p className="text-sm text-zinc-500">{rows.length} drafts waiting</p>
      {rows.length === 0 && (
        <p className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-zinc-500">
          Nothing in the queue. Create a draft via POST /api/drafts with status=approval_queue.
        </p>
      )}
      <div className="space-y-3">
        {rows.map((d) => (
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
      </div>
    </main>
  );
}
