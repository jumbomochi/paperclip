import { DraftStatus } from './enums.js';

const allowed: Record<DraftStatus, DraftStatus[]> = {
  [DraftStatus.Briefed]: [DraftStatus.Researched],
  [DraftStatus.Researched]: [DraftStatus.Drafted],
  [DraftStatus.Drafted]: [DraftStatus.EditorReview],
  [DraftStatus.EditorReview]: [
    DraftStatus.ApprovalQueue,
    DraftStatus.ReworkRequested,
    DraftStatus.EditorRejected,
  ],
  [DraftStatus.ReworkRequested]: [DraftStatus.Drafted],
  [DraftStatus.ApprovalQueue]: [DraftStatus.Approved, DraftStatus.Rejected],
  [DraftStatus.Approved]: [DraftStatus.Scheduled, DraftStatus.AwaitingPaste],
  [DraftStatus.Scheduled]: [DraftStatus.Posted, DraftStatus.PostFailed],
  [DraftStatus.AwaitingPaste]: [DraftStatus.Posted],
  [DraftStatus.Posted]: [DraftStatus.Measuring],
  [DraftStatus.Measuring]: [DraftStatus.Archived],
  [DraftStatus.PostFailed]: [DraftStatus.Approved],
  [DraftStatus.Rejected]: [],
  [DraftStatus.EditorRejected]: [DraftStatus.ApprovalQueue, DraftStatus.Rejected],
  [DraftStatus.Archived]: [],
};

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function assertTransition(from: DraftStatus, to: DraftStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid transition: ${from} -> ${to}`);
  }
}

export const allowedTransitions = allowed;
