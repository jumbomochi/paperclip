import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, draftTransitions, DraftStatus, Platform } from '@paperclip/db';
import { createDraft } from '../src/tools/createDraft.js';
import { updateDraft } from '../src/tools/updateDraft.js';
import { getDraft } from '../src/tools/getDraft.js';
import { listByStatus } from '../src/tools/listByStatus.js';

describe('crud tools', () => {
  beforeEach(async () => {
    await db.delete(draftTransitions);
    await db.delete(drafts);
  });

  it('createDraft inserts with initial status briefed by default', async () => {
    const draft = await createDraft({ platform: Platform.X });
    expect(draft.status).toBe(DraftStatus.Briefed);
    expect(draft.platform).toBe(Platform.X);
  });

  it('createDraft accepts initial status (e.g., for tests)', async () => {
    const draft = await createDraft({ platform: Platform.X, status: DraftStatus.Drafted, body: 'hi' });
    expect(draft.status).toBe(DraftStatus.Drafted);
    expect(draft.body).toBe('hi');
  });

  it('updateDraft updates allowed fields but never status', async () => {
    const draft = await createDraft({ platform: Platform.X, body: 'a' });
    const updated = await updateDraft({ id: draft.id, body: 'b', hookTag: 'question-opener' });
    expect(updated.body).toBe('b');
    expect(updated.hookTag).toBe('question-opener');
  });

  it('updateDraft refuses to set status field', async () => {
    const draft = await createDraft({ platform: Platform.X });
    await expect(
      // @ts-expect-error intentionally bad input
      updateDraft({ id: draft.id, status: DraftStatus.Posted }),
    ).rejects.toThrow(/use transitionStatus/i);
  });

  it('getDraft returns the draft', async () => {
    const created = await createDraft({ platform: Platform.X, body: 'x' });
    const got = await getDraft({ id: created.id });
    expect(got?.id).toBe(created.id);
  });

  it('getDraft returns null if not found', async () => {
    const got = await getDraft({ id: '00000000-0000-0000-0000-000000000000' });
    expect(got).toBeNull();
  });

  it('listByStatus returns only matching rows', async () => {
    await createDraft({ platform: Platform.X, status: DraftStatus.ApprovalQueue });
    await createDraft({ platform: Platform.X, status: DraftStatus.ApprovalQueue });
    await createDraft({ platform: Platform.LinkedIn, status: DraftStatus.Drafted });

    const queue = await listByStatus({ status: DraftStatus.ApprovalQueue });
    expect(queue).toHaveLength(2);
  });

  it('listByStatus filters by platform when provided', async () => {
    await createDraft({ platform: Platform.X, status: DraftStatus.ApprovalQueue });
    await createDraft({ platform: Platform.LinkedIn, status: DraftStatus.ApprovalQueue });

    const x = await listByStatus({ status: DraftStatus.ApprovalQueue, platform: Platform.X });
    expect(x).toHaveLength(1);
    expect(x[0]!.platform).toBe(Platform.X);
  });
});
