import nodemailer from 'nodemailer';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('notifier.send');

export interface Notification {
  subject: string;
  body: string;
}

export async function send(n: Notification): Promise<void> {
  const transportMode = process.env.NOTIFIER_TRANSPORT ?? 'console';
  if (transportMode === 'console') {
    log.info({ subject: n.subject, body: n.body }, 'NOTIFY');
    return;
  }
  if (transportMode === 'email') {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });
    await t.sendMail({
      from: process.env.NOTIFY_FROM ?? 'paperclip@localhost',
      to: process.env.NOTIFY_TO!,
      subject: n.subject,
      text: n.body,
    });
    log.info({ subject: n.subject }, 'email sent');
    return;
  }
  throw new Error(`unknown NOTIFIER_TRANSPORT: ${transportMode}`);
}
