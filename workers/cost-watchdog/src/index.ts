import cron from 'node-cron';
import { makeLogger } from '@paperclip/shared';
import { fetchAnthropicUsage } from './fetchAnthropicUsage.js';

const log = makeLogger('cost-watchdog');

const CAP_USD = Number(process.env.MONTHLY_LLM_CAP_USD ?? 180);
const WARN_PCT = 0.7;
const STOP_PCT = 1.0;
const KEY = process.env.ANTHROPIC_ADMIN_KEY;
const NOTIFY_URL = process.env.WATCHDOG_NOTIFY_URL;

async function notify(level: 'info' | 'warn' | 'critical', message: string) {
  log.info({ level, message }, 'notification');
  if (!NOTIFY_URL) return;
  await fetch(NOTIFY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: `[${level.toUpperCase()}] paperclip cost-watchdog: ${message}`,
    }),
  }).catch((err: Error) => log.error({ err }, 'webhook failed'));
}

async function tick() {
  if (!KEY) {
    log.warn('ANTHROPIC_ADMIN_KEY missing; skipping');
    return;
  }
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const { usdSpent } = await fetchAnthropicUsage({ adminKey: KEY, month: ym });
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = (usdSpent / dayOfMonth) * daysInMonth;
  log.info({ usdSpent, projected, capUsd: CAP_USD }, 'cost tick');

  if (projected >= CAP_USD * STOP_PCT) {
    await notify(
      'critical',
      `projected $${projected.toFixed(2)} >= cap $${CAP_USD}. PAUSE PAPERCLIP NOW.`,
    );
  } else if (projected >= CAP_USD * WARN_PCT) {
    await notify(
      'warn',
      `projected $${projected.toFixed(2)} >= ${WARN_PCT * 100}% of cap. Investigate.`,
    );
  }
}

cron.schedule('0 8 * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'cost-watchdog tick failed'));
});
tick().catch((err: Error) => log.error({ err }, 'startup tick failed'));
log.info({ capUsd: CAP_USD }, 'cost-watchdog started (daily 08:00 UTC)');
