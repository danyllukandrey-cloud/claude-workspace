import { describe, it, expect } from 'vitest';
import { createEntry, confirmEntry, rejectEntry } from './entry';
import { computeProgress } from './progress';

describe('createEntry', () => {
  // AC-01: Given an authorized user has an existing filled card with an
  // active metric-block goal, when the user tells the agent about a
  // relevant event through direct input and confirms the agent's proposed
  // record, then the system updates the card's tracked count.
  it('happy path creates a confirmed entry', () => {
    const entry = createEntry({ id: 'entry-1', metricBlockId: 'block-1', amount: 2 });
    expect(entry.status).toBe('confirmed');
  });

  // AC-06/AC-11: a conflicted or not-yet-verified record is created pending,
  // and (via T6's computeProgress) must not count toward progress yet.
  it('a conflicted/unverified record is created pending and does not count toward progress', () => {
    const entry = createEntry({ id: 'entry-2', metricBlockId: 'block-1', amount: 5, needsReview: true });
    expect(entry.status).toBe('pending');

    const progress = computeProgress({ targetCount: 10, isOngoing: false }, [entry]);
    expect(progress).toMatchObject({ kind: 'bounded', share: 0, overGoal: 0 });
  });
});

describe('rejectEntry', () => {
  // AC-12: Given a user opens a card's history of recent entries, when the
  // user flags one they believe is wrong, then the agent walks through
  // correcting or rolling it back — never a physical delete, the row stays
  // available for history (ADR-0002).
  it('marks the entry rejected without deleting it — the row stays available for history', () => {
    const entry = createEntry({ id: 'entry-3', metricBlockId: 'block-1', amount: 3 });
    const rejected = rejectEntry(entry);
    expect(rejected.status).toBe('rejected');
    expect(rejected).toMatchObject({ id: entry.id, metricBlockId: entry.metricBlockId, amount: entry.amount });
  });
});

describe('confirmEntry', () => {
  it('moves a pending entry to confirmed', () => {
    const entry = createEntry({ id: 'entry-4', metricBlockId: 'block-1', amount: 1, needsReview: true });
    expect(entry.status).toBe('pending');
    const confirmed = confirmEntry(entry);
    expect(confirmed.status).toBe('confirmed');
  });
});
