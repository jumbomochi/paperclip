import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db,
  drafts,
  draftTransitions,
  metricsJobs,
  DraftStatus,
  canTransition,
  Platform,
} from '@paperclip/db';
import { eq } from 'drizzle-orm';

const schema = z.object({ url: z.string().url() });
const SNAPSHOT_OFFSETS_MIN = [60, 6 * 60, 24 * 60, 72 * 60, 7 * 24 * 60];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const result = await db
    .transaction(async (tx) => {
      const [d] = await tx.select().from(drafts).where(eq(drafts.id, id));
      if (!d) return { error: 'not_found' as const };
      if (d.platform !== Platform.LinkedIn) return { error: 'not_linkedin' as const };
      if (!canTransition(d.status as DraftStatus, DraftStatus.Posted)) {
        return { error: `invalid_transition:${d.status}` as const };
      }
      const postedAt = new Date();
      const [updated] = await tx
        .update(drafts)
        .set({
          status: DraftStatus.Posted,
          platformPostUrl: parsed.data.url,
          postedAt,
          updatedAt: postedAt,
        })
        .where(eq(drafts.id, id))
        .returning();
      await tx.insert(draftTransitions).values({
        draftId: id,
        fromStatus: d.status,
        toStatus: DraftStatus.Posted,
        actor: 'human:web',
      });
      await tx.insert(metricsJobs).values(
        SNAPSHOT_OFFSETS_MIN.map((m) => ({
          draftId: id,
          runAt: new Date(postedAt.getTime() + m * 60_000),
        })),
      );
      return { ok: true as const, draft: updated };
    })
    .catch((err: Error) => ({ error: err.message }));

  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
