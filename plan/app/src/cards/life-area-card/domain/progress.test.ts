import { describe, it, expect } from 'vitest';
import { computeProgress, ProgressValidationError } from './progress';
import type { RawEntry, MetricBlockGoal } from './progress';

describe('computeProgress — bounded goal (targetCount set)', () => {
  // AC-09: Given a user has a card with one or more metric-blocks that have
  // recorded events, when the user opens the card, then the system shows
  // the computed share of completion per metric-block.
  it('computes share as sum of confirmed entries divided by targetCount, ignoring pending/rejected', () => {
    const goal: MetricBlockGoal = { targetCount: 12, isOngoing: false };
    const entries: RawEntry[] = [
      { amount: 2, status: 'confirmed' },
      { amount: 1, status: 'confirmed' },
      { amount: 5, status: 'pending' },
      { amount: 3, status: 'rejected' },
    ];
    const progress = computeProgress(goal, entries);
    expect(progress).toMatchObject({ kind: 'bounded', share: 3 / 12, overGoal: 0 });
  });

  // AC-09b: Given a user's metric-block count exceeds its stated goal, when
  // the system computes that metric-block's share, then the system caps the
  // displayed share at a full completion and separately notes the amount
  // over goal, rather than showing a share above full.
  it('caps the share at 1.0 and reports the amount over goal separately', () => {
    const goal: MetricBlockGoal = { targetCount: 10, isOngoing: false };
    const entries: RawEntry[] = [{ amount: 14, status: 'confirmed' }];
    const progress = computeProgress(goal, entries);
    expect(progress).toMatchObject({ kind: 'bounded', share: 1, overGoal: 4 });
  });

  // Межа системи (та сама дисципліна, що й T9): бекенд/PWA можуть передати
  // metric-block без targetCount і без isOngoing — ділити накопичену суму
  // на null/0 дало б Infinity/NaN замість чіткої помилки.
  it('rejects a bounded goal with no positive targetCount instead of dividing by a missing denominator', () => {
    const goal: MetricBlockGoal = { targetCount: null, isOngoing: false };
    expect(() => computeProgress(goal, [])).toThrow(ProgressValidationError);
  });
});

describe('computeProgress — ongoing goal (no deadline)', () => {
  // AC-05: Given a user has set a metric-block's goal as "постійний процес"
  // (no end date), when the system computes that metric-block's share of
  // completion, then the system shows it as an ongoing count rather than a
  // percentage computed against a missing deadline.
  it('returns only the accumulated count, never a share, when isOngoing', () => {
    const goal: MetricBlockGoal = { targetCount: null, isOngoing: true };
    const entries: RawEntry[] = [
      { amount: 4, status: 'confirmed' },
      { amount: 2, status: 'confirmed' },
      { amount: 9, status: 'pending' },
    ];
    const progress = computeProgress(goal, entries);
    expect(progress).toMatchObject({ kind: 'ongoing', accumulated: 6 });
  });
});
