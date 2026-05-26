import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, draftTransitions, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { transitionStatus } from '../src/tools/transitionStatus.js';

async function seedDraft(status: DraftStatus = DraftStatus.Briefed) {
  const [row] = await db
    .insert(drafts)
    .values({ platform: Platform.X, status, body: 'seed' })
    .returning();
  return row!;
}

describe('transitionStatus', () => {
  beforeEach(async () => {
    await db.delete(draftTransitions);
    await db.delete(drafts);
  });

  it('transitions a draft and records a draft_transitions row', async () => {
    const draft = await seedDraft(DraftStatus.Briefed);
    const result = await transitionStatus({
      draftId: draft.id,
      to: DraftStatus.Researched,
      actor: 'agent:researcher',
      reason: 'test',
    });
    expect(result.status).toBe(DraftStatus.Researched);

    const transitions = await db
      .select()
      .from(draftTransitions)
      .where(eq(draftTransitions.draftId, draft.id));
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.fromStatus).toBe(DraftStatus.Briefed);
    expect(transitions[0]!.toStatus).toBe(DraftStatus.Researched);
    expect(transitions[0]!.actor).toBe('agent:researcher');
  });

  it('throws on invalid transition', async () => {
    const draft = await seedDraft(DraftStatus.Briefed);
    await expect(
      transitionStatus({
        draftId: draft.id,
        to: DraftStatus.Posted,
        actor: 'agent:scheduler',
      }),
    ).rejects.toThrow(/invalid transition/i);
  });

  it('throws when draft does not exist', async () => {
    await expect(
      transitionStatus({
        draftId: '00000000-0000-0000-0000-000000000000',
        to: DraftStatus.Researched,
        actor: 'test',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('enforces the rework cycle cap', async () => {
    const draft = await seedDraft(DraftStatus.Drafted);
    await transitionStatus({ draftId: draft.id, to: DraftStatus.EditorReview, actor: 'agent:editor' });
    await transitionStatus({ draftId: draft.id, to: DraftStatus.ReworkRequested, actor: 'agent:editor' });
    await transitionStatus({ draftId: draft.id, to: DraftStatus.Drafted, actor: 'agent:copywriter' });

    await transitionStatus({ draftId: draft.id, to: DraftStatus.EditorReview, actor: 'agent:editor' });
    await transitionStatus({ draftId: draft.id, to: DraftStatus.ReworkRequested, actor: 'agent:editor' });
    await transitionStatus({ draftId: draft.id, to: DraftStatus.Drafted, actor: 'agent:copywriter' });

    await transitionStatus({ draftId: draft.id, to: DraftStatus.EditorReview, actor: 'agent:editor' });
    await expect(
      transitionStatus({ draftId: draft.id, to: DraftStatus.ReworkRequested, actor: 'agent:editor' }),
    ).rejects.toThrow(/rework cap/i);
  });
});
