import { makeClient, type XCreds } from '../client.js';
import { cached } from '../readCache.js';

export interface SearchTopPostsInput {
  query: string;
  creds: XCreds;
  maxAgeSeconds?: number;
}

export async function searchTopPosts(input: SearchTopPostsInput) {
  const ttl = input.maxAgeSeconds ?? 3600;
  return cached(`search:${input.query}`, ttl, async () => {
    const client = makeClient(input.creds);
    const r = await client.v2.search(input.query, {
      'tweet.fields': ['public_metrics', 'created_at'],
      max_results: 20,
      sort_order: 'relevancy',
    });
    return r.data?.data ?? [];
  });
}
