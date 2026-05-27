export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
}

export interface RewriteInput {
  text: string;
  newsletterOrigin: string;
  utm: UtmParams;
}

const URL_RE = /https?:\/\/[^\s)]+/g;

export function rewriteLinksWithUtm(input: RewriteInput): string {
  const origin = new URL(input.newsletterOrigin).origin;
  return input.text.replace(URL_RE, (match) => {
    let u: URL;
    try {
      u = new URL(match);
    } catch {
      return match;
    }
    if (u.origin !== origin) return match;
    if (
      u.searchParams.get('utm_source') === input.utm.source &&
      u.searchParams.get('utm_campaign') === input.utm.campaign
    ) {
      return match;
    }
    u.searchParams.set('utm_source', input.utm.source);
    u.searchParams.set('utm_medium', input.utm.medium);
    u.searchParams.set('utm_campaign', input.utm.campaign);
    if (input.utm.content) u.searchParams.set('utm_content', input.utm.content);
    return u.toString();
  });
}
