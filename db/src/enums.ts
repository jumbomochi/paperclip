export const DraftStatus = {
  Briefed: 'briefed',
  Researched: 'researched',
  Drafted: 'drafted',
  EditorReview: 'editor_review',
  ReworkRequested: 'rework_requested',
  ApprovalQueue: 'approval_queue',
  Rejected: 'rejected',
  EditorRejected: 'editor_rejected',
  Approved: 'approved',
  Scheduled: 'scheduled',
  AwaitingPaste: 'awaiting_paste',
  Posted: 'posted',
  Measuring: 'measuring',
  Archived: 'archived',
  PostFailed: 'post_failed',
} as const;

export type DraftStatus = typeof DraftStatus[keyof typeof DraftStatus];

export const Platform = {
  X: 'x',
  LinkedIn: 'linkedin',
} as const;

export type Platform = typeof Platform[keyof typeof Platform];
