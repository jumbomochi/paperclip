import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface HookRanking {
  hookTag: string | null;
  signups: number;
  impressions: number;
  signupsPer1kImpressions: number;
}

export async function topHooksLastNDays(input: {
  days: number;
  limit?: number;
}): Promise<HookRanking[]> {
  const limit = input.limit ?? 10;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const result = (await db.execute(sql`
    WITH posted AS (
      SELECT id, hook_tag FROM drafts
      WHERE posted_at IS NOT NULL AND posted_at >= ${cutoff}
    ),
    per_post AS (
      SELECT p.id, p.hook_tag,
             (SELECT COUNT(DISTINCT a.subscriber_id) FROM attributions a WHERE a.draft_id = p.id)::int AS signups,
             (SELECT COALESCE(SUM(s.impressions), 0) FROM post_metrics_snapshots s WHERE s.draft_id = p.id)::int AS impressions
      FROM posted p
    ),
    by_hook AS (
      SELECT hook_tag,
             SUM(signups)::int AS signups,
             SUM(impressions)::int AS impressions
      FROM per_post
      GROUP BY hook_tag
    )
    SELECT hook_tag AS "hookTag", signups, impressions,
           CASE WHEN impressions > 0
                THEN (signups::float / impressions) * 1000
                ELSE 0 END AS "signupsPer1kImpressions"
    FROM by_hook
    ORDER BY "signupsPer1kImpressions" DESC NULLS LAST, signups DESC
    LIMIT ${limit}
  `)) as unknown as { rows: HookRanking[] };
  return result.rows;
}
