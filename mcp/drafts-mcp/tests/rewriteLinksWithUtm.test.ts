import { describe, it, expect } from 'vitest';
import { rewriteLinksWithUtm } from '../src/tools/rewriteLinksWithUtm.js';

const NEWSLETTER = 'https://news.example.com';

describe('rewriteLinksWithUtm', () => {
  it('adds utm params to a bare newsletter link', () => {
    const out = rewriteLinksWithUtm({
      text: `Read it: ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'post_abc', content: 'question-opener' },
    });
    expect(out).toContain(
      `${NEWSLETTER}/?utm_source=x&utm_medium=social&utm_campaign=post_abc&utm_content=question-opener`,
    );
  });

  it('preserves an existing path and query on the newsletter URL', () => {
    const out = rewriteLinksWithUtm({
      text: `Try ${NEWSLETTER}/issue/42?foo=bar`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'post_xyz' },
    });
    expect(out).toMatch(
      /\/issue\/42\?foo=bar&utm_source=x&utm_medium=social&utm_campaign=post_xyz/,
    );
  });

  it('does not touch non-newsletter links', () => {
    const out = rewriteLinksWithUtm({
      text: `Comparison: https://other.example.com/x and ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    expect(out).toContain('https://other.example.com/x');
    expect(out).toContain(`${NEWSLETTER}/?utm_source=x`);
  });

  it('is idempotent — does not double-tag a previously rewritten link', () => {
    const first = rewriteLinksWithUtm({
      text: `Read ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    const second = rewriteLinksWithUtm({
      text: first,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    expect(second).toBe(first);
  });
});
