'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Pt {
  capturedAt: string;
  impressions: number;
  engagement: number;
}

export function SnapshotChart({ points }: { points: Pt[] }) {
  const data = points.map((p) => ({
    t: new Date(p.capturedAt).toLocaleString(),
    impressions: p.impressions,
    engagement: p.engagement,
  }));
  if (data.length === 0)
    return <p className="text-sm text-zinc-500">No snapshots yet.</p>;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="t" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="impressions" />
          <Line type="monotone" dataKey="engagement" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
