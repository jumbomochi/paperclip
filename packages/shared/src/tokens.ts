import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db, oauthTokens } from '@paperclip/db';
import { and, eq } from 'drizzle-orm';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) throw new Error('TOKEN_ENC_KEY missing');
  if (!raw.startsWith('base64:')) throw new Error('TOKEN_ENC_KEY must start with base64:');
  const buf = Buffer.from(raw.slice('base64:'.length), 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_ENC_KEY must decode to 32 bytes');
  return buf;
}

function encrypt(plain: string): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

function decrypt(ciphertext: string, nonce: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export async function storeToken<T>(input: { account: string; platform: string; payload: T }): Promise<void> {
  const { ciphertext, nonce } = encrypt(JSON.stringify(input.payload));
  const existing = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.account, input.account), eq(oauthTokens.platform, input.platform)));
  if (existing.length > 0) {
    await db
      .update(oauthTokens)
      .set({ encryptedPayload: ciphertext, nonce, updatedAt: new Date() })
      .where(eq(oauthTokens.id, existing[0]!.id));
  } else {
    await db.insert(oauthTokens).values({
      account: input.account,
      platform: input.platform,
      encryptedPayload: ciphertext,
      nonce,
    });
  }
}

export async function loadToken<T>(input: { account: string; platform: string }): Promise<T | null> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.account, input.account), eq(oauthTokens.platform, input.platform)));
  if (!row) return null;
  return JSON.parse(decrypt(row.encryptedPayload, row.nonce)) as T;
}
