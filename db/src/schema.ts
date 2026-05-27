import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core';

export const themes = pgTable('themes', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  briefSummary: text('brief_summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const hooks = pgTable('hooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull(),
});

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentBriefId: uuid('parent_brief_id'),
    themeId: uuid('theme_id').references(() => themes.id),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    hookTag: text('hook_tag'),
    body: text('body').notNull().default(''),
    research: jsonb('research'),
    editorNotes: jsonb('editor_notes'),
    reworkCount: integer('rework_count').notNull().default(0),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    platformPostId: text('platform_post_id'),
    platformPostUrl: text('platform_post_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('drafts_status_idx').on(t.status),
    platformStatusIdx: index('drafts_platform_status_idx').on(t.platform, t.status),
  }),
);

export const draftTransitions = pgTable(
  'draft_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraftIdx: index('draft_transitions_by_draft_idx').on(t.draftId, t.at),
  }),
);

export const postHooks = pgTable(
  'post_hooks',
  {
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    hookId: uuid('hook_id').notNull().references(() => hooks.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.draftId, t.hookId] }),
  }),
);

export const postMetricsSnapshots = pgTable(
  'post_metrics_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    impressions: integer('impressions').notNull().default(0),
    engagement: integer('engagement').notNull().default(0),
    raw: jsonb('raw'),
  },
  (t) => ({
    byDraftIdx: index('post_metrics_snapshots_by_draft_idx').on(t.draftId, t.capturedAt),
  }),
);

export const attributions = pgTable(
  'attributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    subscriberId: text('subscriber_id').notNull(),
    signedUpAt: timestamp('signed_up_at', { withTimezone: true }).notNull(),
    utmPayload: jsonb('utm_payload'),
  },
  (t) => ({
    bySubscriber: unique('attributions_by_subscriber').on(t.draftId, t.subscriberId),
  }),
);

export const digests = pgTable('digests', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  contentMd: text('content_md').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account: text('account').notNull(),
    platform: text('platform').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    nonce: text('nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountPlatform: unique('oauth_tokens_account_platform').on(t.account, t.platform),
  }),
);

export const xReadCache = pgTable(
  'x_read_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    body: jsonb('body').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const metricsJobs = pgTable(
  'metrics_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => ({
    pendingIdx: index('metrics_jobs_pending_idx').on(t.status, t.runAt),
  }),
);
