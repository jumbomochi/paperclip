#!/usr/bin/env tsx
import { storeToken } from '@paperclip/shared';

const need = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
for (const k of need) {
  if (!process.env[k]) {
    console.error(`missing env: ${k}`);
    process.exit(1);
  }
}

await storeToken({
  account: 'newsletter_main',
  platform: 'x',
  payload: {
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  },
});
console.log('x creds stored for account=newsletter_main');
