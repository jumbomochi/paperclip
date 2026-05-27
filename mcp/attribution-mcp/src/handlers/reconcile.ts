import type { NewsletterClient } from '../newsletterClients/types.js';
import { handleSignupEvent } from './webhook.js';

export interface ReconcileSummary {
  total: number;
  attributed: number;
  ignored: number;
}

export async function reconcile(deps: {
  client: NewsletterClient;
  since: Date;
}): Promise<ReconcileSummary> {
  const events = await deps.client.listRecentSignups(deps.since);
  const out: ReconcileSummary = { total: events.length, attributed: 0, ignored: 0 };
  for (const e of events) {
    const r = await handleSignupEvent({
      subscriberId: e.subscriberId,
      signedUpAt: e.signedUpAt,
      utm: e.utm ?? {},
      referrerUrl: e.referrerUrl,
    });
    if (r.attributed) out.attributed++;
    else out.ignored++;
  }
  return out;
}
