import { TwitterApi } from 'twitter-api-v2';

export interface XCreds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export function makeClient(creds: XCreds): TwitterApi {
  return new TwitterApi(creds);
}
