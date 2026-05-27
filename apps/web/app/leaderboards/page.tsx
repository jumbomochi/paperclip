import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface HookRow {
  hookTag: string | null;
  signups: number;
  impressions: number;
}

export default async function LeaderboardsPage() {
  const hookRows = (await db.execute(sql`
    SELECT d.hook_tag AS "hookTag",
           COUNT(DISTINCT a.subscriber_id)::int AS signups,
           COALESCE(SUM(s.impressions), 0)::int AS impressions
    FROM drafts d
    LEFT JOIN attributions a ON a.draft_id = d.id
    LEFT JOIN post_metrics_snapshots s ON s.draft_id = d.id
    WHERE d.status IN ('posted', 'measuring', 'archived')
    GROUP BY d.hook_tag
    ORDER BY signups DESC NULLS LAST
    LIMIT 25
  `)) as unknown as { rows: HookRow[] };

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Hook leaderboard</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-300 dark:border-zinc-700 text-xs uppercase text-zinc-500">
            <th className="py-2 text-left">Hook tag</th>
            <th className="py-2 text-right">Signups</th>
            <th className="py-2 text-right">Impressions</th>
            <th className="py-2 text-right">Signups/1k imp.</th>
          </tr>
        </thead>
        <tbody>
          {hookRows.rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-2">{r.hookTag ?? '(none)'}</td>
              <td className="py-2 text-right tabular-nums">{r.signups}</td>
              <td className="py-2 text-right tabular-nums">{r.impressions}</td>
              <td className="py-2 text-right tabular-nums">
                {r.impressions > 0 ? ((r.signups / r.impressions) * 1000).toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
