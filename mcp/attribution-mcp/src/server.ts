import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import cron from 'node-cron';
import { z } from 'zod';
import { makeLogger } from '@paperclip/shared';
import { handleSignupEvent } from './handlers/webhook.js';
import { parseUtmFromUrl } from './parseUtm.js';
import { BeehiivClient } from './newsletterClients/beehiiv.js';
import { reconcile } from './handlers/reconcile.js';

const log = makeLogger('attribution-mcp');
const app = new Hono();

const beehiivSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string(),
    email: z.string().email().optional(),
    created: z.number(),
    referring_site: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
  }),
});

app.get('/health', (c) => c.json({ ok: true }));

app.post('/webhook/newsletter', async (c) => {
  const expected = process.env.ATTRIBUTION_WEBHOOK_SECRET;
  if (!expected) return c.json({ error: 'webhook secret not configured' }, 500);
  const auth = c.req.header('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = beehiivSchema.safeParse(body);
  if (!parsed.success) {
    log.warn({ body }, 'unrecognized webhook shape');
    return c.json({ error: 'invalid payload' }, 400);
  }

  const d = parsed.data.data;
  if (parsed.data.type !== 'subscription.created') {
    return c.json({ ignored: true, reason: 'not a signup' });
  }

  const utmFromUrl = d.referring_site ? parseUtmFromUrl(d.referring_site) : {};
  const result = await handleSignupEvent({
    subscriberId: d.id,
    signedUpAt: new Date(d.created * 1000),
    utm: {
      source: d.utm_source ?? utmFromUrl.source,
      medium: d.utm_medium ?? utmFromUrl.medium,
      campaign: d.utm_campaign ?? utmFromUrl.campaign,
      content: d.utm_content ?? utmFromUrl.content,
    },
    referrerUrl: d.referring_site,
  });
  log.info({ result, subscriberId: d.id }, 'signup handled');
  return c.json(result);
});

if (process.env.BEEHIIV_API_KEY && process.env.BEEHIIV_PUBLICATION_ID) {
  const client = new BeehiivClient({
    apiKey: process.env.BEEHIIV_API_KEY,
    publicationId: process.env.BEEHIIV_PUBLICATION_ID,
  });
  cron.schedule('17 3 * * *', async () => {
    const since = new Date(Date.now() - 36 * 3600_000);
    try {
      const r = await reconcile({ client, since });
      log.info(r, 'daily reconcile');
    } catch (err) {
      log.error({ err }, 'reconcile failed');
    }
  });
  log.info('beehiiv reconcile cron registered (03:17 UTC daily)');
}

const port = Number(process.env.ATTRIBUTION_PORT ?? 4001);
serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port }, 'attribution-mcp listening');
});
