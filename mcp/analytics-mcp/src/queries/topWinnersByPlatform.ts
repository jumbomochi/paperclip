import { db, type Platform } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface Winner {
  draftId: string;
  body: string;
  hookTag: string | null;
  signups: number;
  impressions: number;
}

export async function topWinnersByPlatform(input: {
  platform: Platform;
  days: number;
  limit?: number;
}): Promise<Winner[]> {
  const limit = input.limit ?? 5;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const r = (await db.execute(sql`
    SELECT d.id AS "draftId", d.body, d.hook_tag AS "hookTag",
           (SELECT COUNT(DISTINCT a.subscriber_id) FROM attributions a WHERE a.draft_id = d.id)::int AS signups,
           (SELECT COALESCE(SUM(s.impressions), 0) FROM post_metrics_snapshots s WHERE s.draft_id = d.id)::int AS impressions
    FROM drafts d
    WHERE d.platform = ${input.platform}
      AND d.posted_at IS NOT NULL AND d.posted_at >= ${cutoff}
    ORDER BY signups DESC, impressions DESC
    LIMIT ${limit}
  `)) as unknown as { rows: Winner[] };
  return r.rows;
}
