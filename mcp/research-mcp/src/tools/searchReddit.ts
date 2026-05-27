import { cached } from '../cache.js';

export interface RedditHit {
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  score: number;
  comments: number;
  createdAt: number;
}

interface RedditResponse {
  data: {
    children: Array<{
      data: {
        id: string;
        subreddit: string;
        title: string;
        permalink: string;
        score: number;
        num_comments: number;
        created_utc: number;
      };
    }>;
  };
}

export async function searchReddit(input: {
  query: string;
  subreddit?: string;
  maxAgeSeconds?: number;
}): Promise<RedditHit[]> {
  const ttl = input.maxAgeSeconds ?? 3600;
  const key = `reddit:${input.subreddit ?? '*'}:${input.query}`;
  return cached(key, ttl, async () => {
    const base = input.subreddit
      ? `https://www.reddit.com/r/${encodeURIComponent(input.subreddit)}/search.json`
      : 'https://www.reddit.com/search.json';
    const url = `${base}?q=${encodeURIComponent(input.query)}&restrict_sr=${input.subreddit ? '1' : '0'}&sort=top&t=week&limit=20`;
    const r = await fetch(url, { headers: { 'user-agent': 'paperclip-research-mcp/0.0.0' } });
    if (!r.ok) throw new Error(`reddit ${r.status}`);
    const body = (await r.json()) as RedditResponse;
    return body.data.children.map((c) => ({
      id: c.data.id,
      subreddit: c.data.subreddit,
      title: c.data.title,
      permalink: `https://www.reddit.com${c.data.permalink}`,
      score: c.data.score,
      comments: c.data.num_comments,
      createdAt: c.data.created_utc,
    }));
  });
}
