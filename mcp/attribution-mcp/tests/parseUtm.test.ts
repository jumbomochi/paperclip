import { describe, it, expect } from 'vitest';
import { parseUtmFromUrl, extractCampaignDraftId } from '../src/parseUtm.js';

describe('parseUtmFromUrl', () => {
  it('extracts all utm fields from a referrer', () => {
    const r = parseUtmFromUrl(
      'https://news.example.com/?utm_source=x&utm_medium=social&utm_campaign=post_abc-123&utm_content=question-opener',
    );
    expect(r).toEqual({
      source: 'x',
      medium: 'social',
      campaign: 'post_abc-123',
      content: 'question-opener',
    });
  });
  it('returns empty object when no utm present', () => {
    expect(parseUtmFromUrl('https://news.example.com/')).toEqual({});
  });
  it('extracts draft id from post_<id> campaign', () => {
    expect(extractCampaignDraftId('post_abc-123')).toBe('abc-123');
  });
  it('returns null for non-post campaigns', () => {
    expect(extractCampaignDraftId('newsletter_main')).toBeNull();
  });
  it('handles undefined campaign', () => {
    expect(extractCampaignDraftId(undefined)).toBeNull();
  });
});
