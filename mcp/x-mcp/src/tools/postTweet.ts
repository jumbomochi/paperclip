import { makeClient, type XCreds } from '../client.js';

export interface PostTweetInput {
  account: string;
  text: string;
  inReplyTo?: string;
  creds: XCreds;
}

export interface PostTweetOutput {
  id: string;
  url: string;
}

export async function postTweet(input: PostTweetInput): Promise<PostTweetOutput> {
  if (input.text.length > 280) {
    throw new Error(`tweet text too long: ${input.text.length} > 280`);
  }
  const client = makeClient(input.creds);
  const resp = await client.v2.tweet(
    input.text,
    input.inReplyTo ? { reply: { in_reply_to_tweet_id: input.inReplyTo } } : undefined,
  );
  if (!resp.data?.id) {
    throw new Error(`x post failed: ${JSON.stringify(resp)}`);
  }
  return { id: resp.data.id, url: `https://x.com/i/web/status/${resp.data.id}` };
}
