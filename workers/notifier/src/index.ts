import cron from 'node-cron';
import { makeLogger } from '@paperclip/shared';
import { findStaleAwaitingPaste } from './findStale.js';
import { send } from './send.js';

const log = makeLogger('notifier');
const THRESHOLD_MIN = Number(process.env.NOTIFIER_STALE_MIN ?? 60);
const URL_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

async function tick() {
  const stale = await findStaleAwaitingPaste({ thresholdMinutes: THRESHOLD_MIN });
  if (stale.length === 0) return;
  await send({
    subject: `${stale.length} LinkedIn draft(s) awaiting your paste`,
    body:
      `The following drafts have been sitting in awaiting_paste for > ${THRESHOLD_MIN} minutes:\n\n` +
      stale.map((d) => `- ${d.id}: ${d.body.slice(0, 80)}…`).join('\n') +
      `\n\nReview at ${URL_BASE}/queue`,
  });
}

cron.schedule('*/15 * * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'notifier tick error'));
});
log.info({ thresholdMinutes: THRESHOLD_MIN }, 'notifier started');
tick().catch((err: Error) => log.error({ err }, 'startup tick error'));
