import { postTweet, type PostTweetInput } from './postTweet.js';

export interface PostThreadInput {
  account: string;
  tweets: string[];
  creds: PostTweetInput['creds'];
}

export interface PostThreadOutput {
  ids: string[];
  rootUrl: string;
}

export async function postThread(input: PostThreadInput): Promise<PostThreadOutput> {
  if (input.tweets.length === 0) throw new Error('thread is empty');
  const ids: string[] = [];
  let inReplyTo: string | undefined;
  for (const text of input.tweets) {
    const r = await postTweet({ account: input.account, text, inReplyTo, creds: input.creds });
    ids.push(r.id);
    inReplyTo = r.id;
  }
  return { ids, rootUrl: `https://x.com/i/web/status/${ids[0]}` };
}
