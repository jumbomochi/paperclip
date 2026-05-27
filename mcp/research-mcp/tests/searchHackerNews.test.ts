import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { db, researchCache } from '@paperclip/db';
import { searchHackerNews } from '../src/tools/searchHackerNews.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  await db.delete(researchCache);
});

describe('searchHackerNews', () => {
  it('queries Algolia API and normalizes results', async () => {
    server.use(
      http.get('https://hn.algolia.com/api/v1/search', () =>
        HttpResponse.json({
          hits: [
            {
              objectID: '1',
              title: 'agentic dev tools',
              url: 'https://ex.com/a',
              points: 200,
              num_comments: 50,
              created_at_i: 1700000000,
            },
          ],
        }),
      ),
    );
    const r = await searchHackerNews({ query: 'agentic dev', maxAgeSeconds: 60 });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('1');
    expect(r[0]!.title).toBe('agentic dev tools');
    expect(r[0]!.points).toBe(200);
  });
});
