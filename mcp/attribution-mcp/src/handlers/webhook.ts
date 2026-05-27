import { db, drafts, attributions } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { extractCampaignDraftId, type UtmFields } from '../parseUtm.js';

export interface SignupEventInput {
  subscriberId: string;
  signedUpAt: Date;
  utm: UtmFields;
  referrerUrl?: string;
}

export type SignupResult =
  | { attributed: true; draftId: string }
  | { attributed: false; reason: 'no_campaign' | 'draft_not_found' };

export async function handleSignupEvent(input: SignupEventInput): Promise<SignupResult> {
  const draftId = extractCampaignDraftId(input.utm.campaign);
  if (!draftId) return { attributed: false, reason: 'no_campaign' };

  const [d] = await db.select().from(drafts).where(eq(drafts.id, draftId));
  if (!d) return { attributed: false, reason: 'draft_not_found' };

  await db
    .insert(attributions)
    .values({
      draftId,
      subscriberId: input.subscriberId,
      signedUpAt: input.signedUpAt,
      utmPayload: input.utm,
    })
    .onConflictDoNothing();
  return { attributed: true, draftId };
}
