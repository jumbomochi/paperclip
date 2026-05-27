export interface UtmFields {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export function parseUtmFromUrl(referrerUrl: string): UtmFields {
  try {
    const u = new URL(referrerUrl);
    const out: UtmFields = {};
    const s = u.searchParams.get('utm_source');
    if (s) out.source = s;
    const m = u.searchParams.get('utm_medium');
    if (m) out.medium = m;
    const c = u.searchParams.get('utm_campaign');
    if (c) out.campaign = c;
    const k = u.searchParams.get('utm_content');
    if (k) out.content = k;
    return out;
  } catch {
    return {};
  }
}

export function extractCampaignDraftId(campaign: string | undefined): string | null {
  if (!campaign) return null;
  if (!campaign.startsWith('post_')) return null;
  return campaign.slice('post_'.length);
}
