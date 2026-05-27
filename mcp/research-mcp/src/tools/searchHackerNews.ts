import { cached } from '../cache.js';

export interface HNHit {
  id: string;
  title: string;
  url?: string;
  points: number;
  comments: number;
  createdAt: number;
}

interface AlgoliaResponse {
  hits: Array<{
    objectID: string;
    title?: string;
    url?: string;
    points?: number;
    num_comments?: number;
    created_at_i?: number;
  }>;
}

export async function searchHackerNews(input: {
  query: string;
  maxAgeSeconds?: number;
}): Promise<HNHit[]> {
  const ttl = input.maxAgeSeconds ?? 3600;
  return cached(`hn:${input.query}`, ttl, async () => {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(input.query)}&tags=story&hitsPerPage=20`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`hn ${r.status}`);
    const body = (await r.json()) as AlgoliaResponse;
    return body.hits.map((h) => ({
      id: h.objectID,
      title: h.title ?? '',
      url: h.url,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      createdAt: h.created_at_i ?? 0,
    }));
  });
}
