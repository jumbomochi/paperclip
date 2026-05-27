import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface ThemeRanking {
  themeSlug: string | null;
  signups: number;
  impressions: number;
  signupsPer1kImpressions: number;
}

export async function topThemesLastNDays(input: {
  days: number;
  limit?: number;
}): Promise<ThemeRanking[]> {
  const limit = input.limit ?? 10;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const r = (await db.execute(sql`
    WITH posted AS (
      SELECT d.id, t.slug AS theme_slug FROM drafts d
      LEFT JOIN themes t ON t.id = d.theme_id
      WHERE d.posted_at IS NOT NULL AND d.posted_at >= ${cutoff}
    ),
    per_post AS (
      SELECT p.id, p.theme_slug,
             (SELECT COUNT(DISTINCT a.subscriber_id) FROM attributions a WHERE a.draft_id = p.id)::int AS signups,
             (SELECT COALESCE(SUM(s.impressions), 0) FROM post_metrics_snapshots s WHERE s.draft_id = p.id)::int AS impressions
      FROM posted p
    ),
    by_theme AS (
      SELECT theme_slug,
             SUM(signups)::int AS signups,
             SUM(impressions)::int AS impressions
      FROM per_post
      GROUP BY theme_slug
    )
    SELECT theme_slug AS "themeSlug", signups, impressions,
           CASE WHEN impressions > 0
                THEN (signups::float / impressions) * 1000
                ELSE 0 END AS "signupsPer1kImpressions"
    FROM by_theme
    ORDER BY "signupsPer1kImpressions" DESC, signups DESC
    LIMIT ${limit}
  `)) as unknown as { rows: ThemeRanking[] };
  return r.rows;
}
