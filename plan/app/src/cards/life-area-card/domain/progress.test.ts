import { describe, it, expect } from 'vitest';
import { computeProgress, computeAggregateProgress, ProgressValidationError } from './progress';
import type { RawEntry, MetricBlockGoal, Progress } from './progress';

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

  // Межа системи (та сама дисципліна, що й T9): targetCount справді заданий,
  // але некоректний (0 чи від'ємне число) — ділити накопичену суму на такий
  // знаменник дало б Infinity/NaN замість чіткої помилки.
  it('rejects a bounded goal whose targetCount is zero or negative instead of dividing by it', () => {
    const goal: MetricBlockGoal = { targetCount: 0, isOngoing: false };
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

describe('computeProgress — purely frequency-based goal (ISS-34)', () => {
  // data-model.md: "target_count NULL для чисто частотних цілей без
  // фіксованого підсумку" -- ця комбінація (targetCount: null, isOngoing:
  // false) раніше кидала ProgressValidationError, хоча база даних її прямо
  // дозволяє (createMetricBlock, T16, нічим її не забороняє). Виправлено:
  // немає числа, з яким рахувати частку -- показуємо накопичену кількість,
  // той самий вигляд відповіді, що й для isOngoing.
  it('returns only the accumulated count, never a share, when targetCount is null even without isOngoing', () => {
    const goal: MetricBlockGoal = { targetCount: null, isOngoing: false };
    const entries: RawEntry[] = [
      { amount: 3, status: 'confirmed' },
      { amount: 1, status: 'confirmed' },
    ];
    const progress = computeProgress(goal, entries);
    expect(progress).toMatchObject({ kind: 'ongoing', accumulated: 4 });
  });
});

// T45 (review 2026-09-07 B8/C13): винесено з app/get-card.ts (був приватною
// функцією лише там) -- офлайн-розрахунок (main.tsx, QG-1) має рахувати
// АГРЕГАТ картки за ТІЄЮ САМОЮ формулою (D-105), не другою незалежною
// копією, яка з часом розійдеться (той самий клас ризику, що D-19 описує
// для документів -- тут для коду).
describe('computeAggregateProgress (D-105 -- просте середнє часток bounded-блоків)', () => {
  it('averages the share of bounded-progress blocks, ignoring ongoing blocks entirely', () => {
    const progresses: Progress[] = [
      { kind: 'bounded', share: 0.25, overGoal: 0 },
      { kind: 'bounded', share: 0.5, overGoal: 0 },
      { kind: 'ongoing', accumulated: 7 },
    ];
    expect(computeAggregateProgress(progresses)).toBeCloseTo(0.375); // (0.25 + 0.5) / 2
  });

  it('returns null when there is no bounded-progress block at all (declarative card or only ongoing blocks)', () => {
    expect(computeAggregateProgress([])).toBeNull();
    expect(computeAggregateProgress([{ kind: 'ongoing', accumulated: 3 }])).toBeNull();
  });
});
