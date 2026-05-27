import cron from 'node-cron';
import { Platform } from '@paperclip/db';
import { makeLogger, loadToken } from '@paperclip/shared';
import { postTweet, type XCreds } from '@paperclip/x-mcp';
import { postReady } from './postReady.js';
import { notifyAwaitingPaste } from './notifyAwaitingPaste.js';

const log = makeLogger('scheduler');
const ACCOUNT = 'newsletter_main';
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

async function tick() {
  log.info('tick');
  const creds = await loadToken<XCreds>({ account: ACCOUNT, platform: 'x' });
  if (!creds) {
    log.warn('no X creds; LinkedIn-only mode');
  }
  await postReady({
    now: new Date(),
    platforms: [Platform.X, Platform.LinkedIn],
    postX: ({ account, text }) =>
      creds
        ? postTweet({ account, text, creds })
        : Promise.reject(new Error('no X creds')),
  });
  await notifyAwaitingPaste();
  if (HEARTBEAT_URL) {
    await fetch(HEARTBEAT_URL).catch((err: Error) => log.warn({ err }, 'heartbeat failed'));
  }
}

cron.schedule('*/15 * * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'scheduler tick error'));
});

tick().catch((err: Error) => log.error({ err }, 'scheduler startup tick error'));

log.info('scheduler started (every 15m)');
