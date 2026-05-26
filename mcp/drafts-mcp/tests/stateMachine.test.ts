import { describe, it, expect } from 'vitest';
import { DraftStatus } from '@paperclip/db';
import { canTransition, assertTransition } from '../src/stateMachine.js';

describe('stateMachine', () => {
  it('allows briefed -> researched', () => {
    expect(canTransition(DraftStatus.Briefed, DraftStatus.Researched)).toBe(true);
  });
  it('allows drafted -> editor_review', () => {
    expect(canTransition(DraftStatus.Drafted, DraftStatus.EditorReview)).toBe(true);
  });
  it('allows editor_review -> approval_queue', () => {
    expect(canTransition(DraftStatus.EditorReview, DraftStatus.ApprovalQueue)).toBe(true);
  });
  it('allows editor_review -> rework_requested', () => {
    expect(canTransition(DraftStatus.EditorReview, DraftStatus.ReworkRequested)).toBe(true);
  });
  it('allows rework_requested -> drafted', () => {
    expect(canTransition(DraftStatus.ReworkRequested, DraftStatus.Drafted)).toBe(true);
  });
  it('allows approval_queue -> approved', () => {
    expect(canTransition(DraftStatus.ApprovalQueue, DraftStatus.Approved)).toBe(true);
  });
  it('allows approval_queue -> rejected', () => {
    expect(canTransition(DraftStatus.ApprovalQueue, DraftStatus.Rejected)).toBe(true);
  });
  it('allows approved -> scheduled', () => {
    expect(canTransition(DraftStatus.Approved, DraftStatus.Scheduled)).toBe(true);
  });
  it('allows approved -> awaiting_paste', () => {
    expect(canTransition(DraftStatus.Approved, DraftStatus.AwaitingPaste)).toBe(true);
  });
  it('allows scheduled -> posted', () => {
    expect(canTransition(DraftStatus.Scheduled, DraftStatus.Posted)).toBe(true);
  });
  it('allows awaiting_paste -> posted', () => {
    expect(canTransition(DraftStatus.AwaitingPaste, DraftStatus.Posted)).toBe(true);
  });
  it('allows posted -> measuring', () => {
    expect(canTransition(DraftStatus.Posted, DraftStatus.Measuring)).toBe(true);
  });
  it('allows measuring -> archived', () => {
    expect(canTransition(DraftStatus.Measuring, DraftStatus.Archived)).toBe(true);
  });
  it('rejects briefed -> posted (skipping states)', () => {
    expect(canTransition(DraftStatus.Briefed, DraftStatus.Posted)).toBe(false);
  });
  it('rejects rejected -> approved (rejected is terminal)', () => {
    expect(canTransition(DraftStatus.Rejected, DraftStatus.Approved)).toBe(false);
  });
  it('rejects archived -> anything (archived is terminal)', () => {
    expect(canTransition(DraftStatus.Archived, DraftStatus.Posted)).toBe(false);
  });
  it('assertTransition throws on invalid', () => {
    expect(() => assertTransition(DraftStatus.Briefed, DraftStatus.Posted)).toThrow(
      /invalid transition/i,
    );
  });
  it('assertTransition does not throw on valid', () => {
    expect(() => assertTransition(DraftStatus.Briefed, DraftStatus.Researched)).not.toThrow();
  });
});
