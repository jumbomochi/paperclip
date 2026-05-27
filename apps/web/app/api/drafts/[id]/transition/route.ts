import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, drafts, draftTransitions, type DraftStatus, canTransition } from '@paperclip/db';
import { eq } from 'drizzle-orm';

const schema = z.object({
  to: z.string(),
  actor: z.string().default('human:web'),
  reason: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.format() }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id));
      if (!draft) throw new Error('not_found');
      const to = body.data.to as DraftStatus;
      if (!canTransition(draft.status as DraftStatus, to)) {
        throw new Error(`invalid_transition:${draft.status}->${to}`);
      }
      const [updated] = await tx
        .update(drafts)
        .set({ status: to, updatedAt: new Date() })
        .where(eq(drafts.id, id))
        .returning();
      await tx.insert(draftTransitions).values({
        draftId: id,
        fromStatus: draft.status,
        toStatus: to,
        actor: body.data.actor,
        reason: body.data.reason,
      });
      return updated!;
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
