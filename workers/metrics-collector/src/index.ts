import { db, metricsJobs } from '@paperclip/db';
import { and, eq, lte, asc } from 'drizzle-orm';
import { makeLogger, loadToken } from '@paperclip/shared';
import { readTweetMetrics, type XCreds } from '@paperclip/x-mcp';
import { runOne } from './runOne.js';

const log = makeLogger('metrics-collector');
const ACCOUNT = 'newsletter_main';
const POLL_MS = 30_000;

async function loop() {
  const creds = await loadToken<XCreds>({ account: ACCOUNT, platform: 'x' });
  if (!creds) {
    log.error('no creds');
    return;
  }
  while (true) {
    const due = await db
      .select()
      .from(metricsJobs)
      .where(and(eq(metricsJobs.status, 'pending'), lte(metricsJobs.runAt, new Date())))
      .orderBy(asc(metricsJobs.runAt))
      .limit(10);

    for (const j of due) {
      await runOne({
        jobId: j.id,
        readX: ({ tweetId }) => readTweetMetrics({ tweetId, creds }),
      }).catch((err: Error) => log.error({ err, jobId: j.id }, 'runOne crashed'));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop().catch((err: Error) => {
  log.error({ err }, 'metrics-collector died');
  process.exit(1);
});
log.info('metrics-collector started');
