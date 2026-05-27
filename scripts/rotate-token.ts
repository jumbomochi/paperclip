#!/usr/bin/env tsx
// Re-encrypts all oauth_tokens with a new TOKEN_ENC_KEY.
// Usage:
//   OLD_TOKEN_ENC_KEY=base64:... NEW_TOKEN_ENC_KEY=base64:... tsx scripts/rotate-token.ts
import { db, oauthTokens } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw || !raw.startsWith('base64:')) throw new Error(`${envName} missing or malformed`);
  const buf = Buffer.from(raw.slice('base64:'.length), 'base64');
  if (buf.length !== 32) throw new Error(`${envName} must be 32 bytes`);
  return buf;
}

const oldKey = loadKey('OLD_TOKEN_ENC_KEY');
const newKey = loadKey('NEW_TOKEN_ENC_KEY');

function decrypt(ct: string, nonce: string, key: Buffer): string {
  const data = Buffer.from(ct, 'base64');
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

function encrypt(plain: string, key: Buffer): { ct: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ct: Buffer.concat([ct, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

const rows = await db.select().from(oauthTokens);
console.log(`re-encrypting ${rows.length} rows...`);
for (const r of rows) {
  const plain = decrypt(r.encryptedPayload, r.nonce, oldKey);
  const { ct, nonce } = encrypt(plain, newKey);
  await db
    .update(oauthTokens)
    .set({ encryptedPayload: ct, nonce, updatedAt: new Date() })
    .where(eq(oauthTokens.id, r.id));
}
console.log('done. Update TOKEN_ENC_KEY in .env, restart all services.');
