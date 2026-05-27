import { makeClient } from '../client.js';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('linkedin-mcp.searchTopPosts');

export interface SearchTopPostsInput {
  query: string;
  accessToken: string;
}

export interface NormalizedPost {
  id: string;
  text: string;
  reactions: number;
}

interface LinkedInSocialActionsResponse {
  elements?: Array<{
    id: string;
    commentary?: string;
    reactionsSummary?: { totalReactions?: number };
  }>;
}

export async function searchTopPosts(input: SearchTopPostsInput): Promise<NormalizedPost[]> {
  const c = makeClient(input.accessToken);
  try {
    const body = (await c.fetchJson(
      `/socialActions?q=search&query=${encodeURIComponent(input.query)}&count=20`,
    )) as LinkedInSocialActionsResponse;
    return (body.elements ?? []).map((e) => ({
      id: e.id,
      text: e.commentary ?? '',
      reactions: e.reactionsSummary?.totalReactions ?? 0,
    }));
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 403 || status === 401) {
      log.warn({ status }, 'linkedin search scope unavailable; returning empty list');
      return [];
    }
    throw err;
  }
}
