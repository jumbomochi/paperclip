import { db, metricsJobs } from '@paperclip/db';

export const SNAPSHOT_OFFSETS_MIN = [60, 6 * 60, 24 * 60, 72 * 60, 7 * 24 * 60];

export async function enqueueSnapshots(draftId: string, postedAt: Date) {
  await db.insert(metricsJobs).values(
    SNAPSHOT_OFFSETS_MIN.map((m) => ({
      draftId,
      runAt: new Date(postedAt.getTime() + m * 60_000),
    })),
  );
}
