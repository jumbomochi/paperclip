import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db, oauthTokens } from '@paperclip/db';
import { storeToken, loadToken } from '../src/tokens.js';

const key = randomBytes(32).toString('base64');

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = `base64:${key}`;
});

beforeEach(async () => {
  await db.delete(oauthTokens);
});

describe('tokens', () => {
  it('round-trips a token through storeToken/loadToken', async () => {
    await storeToken({ account: 'newsletter_main', platform: 'x', payload: { accessToken: 'abc', refreshToken: 'def' } });
    const loaded = await loadToken({ account: 'newsletter_main', platform: 'x' });
    expect(loaded).toEqual({ accessToken: 'abc', refreshToken: 'def' });
  });

  it('updates existing token on second store', async () => {
    await storeToken({ account: 'a', platform: 'x', payload: { v: 1 } });
    await storeToken({ account: 'a', platform: 'x', payload: { v: 2 } });
    expect(await loadToken({ account: 'a', platform: 'x' })).toEqual({ v: 2 });
  });

  it('loadToken returns null when missing', async () => {
    expect(await loadToken({ account: 'missing', platform: 'x' })).toBeNull();
  });

  it('throws when TOKEN_ENC_KEY is missing', async () => {
    const old = process.env.TOKEN_ENC_KEY;
    delete process.env.TOKEN_ENC_KEY;
    await expect(storeToken({ account: 'a', platform: 'x', payload: { v: 1 } })).rejects.toThrow(
      /TOKEN_ENC_KEY/,
    );
    process.env.TOKEN_ENC_KEY = old;
  });
});
