import { makeClient, type XCreds } from '../client.js';
import { cached } from '../readCache.js';

export interface ReadTweetMetricsInput {
  tweetId: string;
  creds: XCreds;
  maxAgeSeconds?: number;
}

export interface ReadTweetMetricsOutput {
  tweetId: string;
  impressions: number;
  engagement: number;
  raw: unknown;
}

export async function readTweetMetrics(input: ReadTweetMetricsInput): Promise<ReadTweetMetricsOutput> {
  const ttl = input.maxAgeSeconds ?? 600;
  const body = await cached(`tweet:${input.tweetId}`, ttl, async () => {
    const client = makeClient(input.creds);
    return client.v2.singleTweet(input.tweetId, { 'tweet.fields': ['public_metrics'] });
  });
  const m = (body as { data?: { public_metrics?: Record<string, number> } }).data?.public_metrics ?? {};
  return {
    tweetId: input.tweetId,
    impressions: m.impression_count ?? 0,
    engagement:
      (m.like_count ?? 0) + (m.retweet_count ?? 0) + (m.reply_count ?? 0) + (m.quote_count ?? 0),
    raw: body,
  };
}
