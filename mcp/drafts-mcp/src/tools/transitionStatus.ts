import { db, drafts, draftTransitions, DraftStatus } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { assertTransition } from '../stateMachine.js';

export const REWORK_CAP = 2;

export interface TransitionStatusInput {
  draftId: string;
  to: DraftStatus;
  actor: string;
  reason?: string;
}

export async function transitionStatus(input: TransitionStatusInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(drafts).where(eq(drafts.id, input.draftId));
    if (!current) throw new Error(`draft not found: ${input.draftId}`);

    assertTransition(current.status as DraftStatus, input.to);

    let newReworkCount = current.reworkCount;
    if (input.to === DraftStatus.ReworkRequested) {
      if (current.reworkCount >= REWORK_CAP) {
        throw new Error(
          `rework cap exceeded (${REWORK_CAP}); editor must transition to editor_rejected instead`,
        );
      }
      newReworkCount = current.reworkCount + 1;
    }

    const [updated] = await tx
      .update(drafts)
      .set({
        status: input.to,
        reworkCount: newReworkCount,
        updatedAt: new Date(),
      })
      .where(eq(drafts.id, input.draftId))
      .returning();

    await tx.insert(draftTransitions).values({
      draftId: input.draftId,
      fromStatus: current.status,
      toStatus: input.to,
      actor: input.actor,
      reason: input.reason,
    });

    return updated!;
  });
}
