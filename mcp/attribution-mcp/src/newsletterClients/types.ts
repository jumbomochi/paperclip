export interface SignupEvent {
  subscriberId: string;
  signedUpAt: Date;
  referrerUrl?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
  };
}

export interface NewsletterClient {
  listRecentSignups(since: Date): Promise<SignupEvent[]>;
}
