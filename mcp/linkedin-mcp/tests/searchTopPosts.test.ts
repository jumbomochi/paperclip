import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { searchTopPosts } from '../src/tools/searchTopPosts.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('searchTopPosts', () => {
  it('returns empty list on 403 (scope unavailable)', async () => {
    server.use(
      http.get('https://api.linkedin.com/v2/socialActions', () =>
        HttpResponse.json({ message: 'forbidden' }, { status: 403 }),
      ),
    );
    const r = await searchTopPosts({ query: 'agentic', accessToken: 'x' });
    expect(r).toEqual([]);
  });

  it('returns normalized posts when API responds 200', async () => {
    server.use(
      http.get('https://api.linkedin.com/v2/socialActions', () =>
        HttpResponse.json({
          elements: [
            {
              id: 'urn:li:share:1',
              commentary: 'cool post',
              reactionsSummary: { totalReactions: 100 },
            },
          ],
        }),
      ),
    );
    const r = await searchTopPosts({ query: 'agentic', accessToken: 'x' });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('urn:li:share:1');
  });
});
