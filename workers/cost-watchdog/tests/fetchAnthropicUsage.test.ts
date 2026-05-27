import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchAnthropicUsage } from '../src/fetchAnthropicUsage.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchAnthropicUsage', () => {
  it('returns total spend USD for the month', async () => {
    server.use(
      http.get('https://api.anthropic.com/v1/organizations/usage_report/messages', () =>
        HttpResponse.json({
          data: [{ amount_usd: 12.34 }, { amount_usd: 5.66 }],
        }),
      ),
    );
    const r = await fetchAnthropicUsage({ adminKey: 'k', month: '2026-05' });
    expect(r.usdSpent).toBe(18);
  });

  it('returns 0 when no data', async () => {
    server.use(
      http.get('https://api.anthropic.com/v1/organizations/usage_report/messages', () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const r = await fetchAnthropicUsage({ adminKey: 'k', month: '2026-05' });
    expect(r.usdSpent).toBe(0);
  });
});
