import Parser from 'rss-parser';
import { cached } from '../cache.js';

const parser = new Parser();

export interface RssItem {
  title: string;
  link?: string;
  isoDate?: string;
  contentSnippet?: string;
}

export async function fetchRssFeed(input: {
  url: string;
  maxAgeSeconds?: number;
  max?: number;
}): Promise<RssItem[]> {
  const ttl = input.maxAgeSeconds ?? 1800;
  return cached(`rss:${input.url}`, ttl, async () => {
    const feed = await parser.parseURL(input.url);
    return (feed.items ?? []).slice(0, input.max ?? 20).map((i) => ({
      title: i.title ?? '',
      link: i.link,
      isoDate: i.isoDate,
      contentSnippet: i.contentSnippet,
    }));
  });
}
