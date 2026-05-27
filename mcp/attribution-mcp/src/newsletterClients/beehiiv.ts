import type { NewsletterClient, SignupEvent } from './types.js';

interface BeehiivSubscription {
  id: string;
  created: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referring_site?: string;
}

interface BeehiivListResponse {
  data: BeehiivSubscription[];
}

export interface BeehiivConfig {
  apiKey: string;
  publicationId: string;
  baseUrl?: string;
}

export class BeehiivClient implements NewsletterClient {
  constructor(private readonly cfg: BeehiivConfig) {}

  async listRecentSignups(since: Date): Promise<SignupEvent[]> {
    const base = this.cfg.baseUrl ?? 'https://api.beehiiv.com/v2';
    const url = `${base}/publications/${this.cfg.publicationId}/subscriptions?status=active&created_after=${Math.floor(since.getTime() / 1000)}&limit=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
    if (!res.ok) throw new Error(`beehiiv ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as BeehiivListResponse;
    return body.data.map((s) => ({
      subscriberId: s.id,
      signedUpAt: new Date(s.created * 1000),
      utm: {
        source: s.utm_source,
        medium: s.utm_medium,
        campaign: s.utm_campaign,
        content: s.utm_content,
      },
      referrerUrl: s.referring_site,
    }));
  }
}
