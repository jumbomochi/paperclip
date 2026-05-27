import { makeLogger } from '@paperclip/shared';
const log = makeLogger('scheduler.notifyAwaitingPaste');

export async function notifyAwaitingPaste(): Promise<void> {
  // Implemented in Plan 3 — notifier worker handles ping cadence.
  log.debug('notifyAwaitingPaste: noop in scheduler tick');
}
