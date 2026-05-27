export async function fetchAnthropicUsage(input: {
  adminKey: string;
  month: string;
}): Promise<{ usdSpent: number }> {
  const url = `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${input.month}-01&ending_at=${nextMonth(input.month)}-01`;
  const r = await fetch(url, {
    headers: {
      'x-api-key': input.adminKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!r.ok) throw new Error(`anthropic usage ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data: Array<{ amount_usd?: number }> };
  const usdSpent = body.data.reduce((sum, d) => sum + (d.amount_usd ?? 0), 0);
  return { usdSpent };
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
