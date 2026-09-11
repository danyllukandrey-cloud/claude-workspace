import { describe, it, expect } from 'vitest';
import {
  computeStructureAggregate,
  computeLogicLayoutGaps,
  flagUnmaintainedCards,
  computeGapTrend,
} from './aggregate';
import type {
  CardAggregateInput,
  LogicLayoutGapInput,
  CardMaintenanceInput,
  GapObservation,
} from './aggregate';

// Структура не рахує прогрес картки сама -- отримує вже обчислений відсоток
// через доменну логіку `life-area-card` (spec.md §1, ADR-0001 тієї фічі).
// `progress: number | null` тут -- це вже готове `share` (0..1) від
// `computeProgress`/`computeAggregateProgress` картки, або `null`, коли
// картка не має обчислюваного відсотка (AC-13: ongoing-метрика без
// знаменника, чи чисто декларативна картка без метрик-блоку).

describe('computeStructureAggregate — AC-01/AC-13 (виключення некомпутованих карток)', () => {
  it('averages only cards with a computable progress percentage, excluding others', () => {
    const cards: CardAggregateInput[] = [
      { cardId: 'card-1', cellIndex: 0, progress: 0.2 },
      { cardId: 'card-2', cellIndex: 1, progress: 0.8 },
      { cardId: 'card-3', cellIndex: 2, progress: null }, // AC-13: ongoing без знаменника
    ];

    const result = computeStructureAggregate(cards);

    expect(result.average).toBeCloseTo(0.5); // (0.2 + 0.8) / 2, card-3 не входить
    expect(result.excludedCount).toBe(1);
  });

  it('reports every card excluded and a null average when none is computable', () => {
    const cards: CardAggregateInput[] = [
      { cardId: 'card-1', cellIndex: 0, progress: null },
      { cardId: 'card-2', cellIndex: 1, progress: null },
    ];

    const result = computeStructureAggregate(cards);

    expect(result.average).toBeNull();
    expect(result.excludedCount).toBe(2);
  });

  it('returns a null average and zero excluded count for an empty set of cards', () => {
    const result = computeStructureAggregate([]);

    expect(result.average).toBeNull();
    expect(result.excludedCount).toBe(0);
  });
});

describe('computeStructureAggregate — AC-04 (розкладка не впливає на результат)', () => {
  it('produces the identical average regardless of each card\'s layout position (cellIndex)', () => {
    const cards: CardAggregateInput[] = [
      { cardId: 'card-1', cellIndex: 5, progress: 0.1 }, // напр. позначена найважливішою в розкладці
      { cardId: 'card-2', cellIndex: 0, progress: 0.9 },
      { cardId: 'card-3', cellIndex: 2, progress: null },
    ];
    const reordered: CardAggregateInput[] = [
      { cardId: 'card-2', cellIndex: 99, progress: 0.9 }, // ті самі картки, інші cellIndex і порядок масиву
      { cardId: 'card-3', cellIndex: 1, progress: null },
      { cardId: 'card-1', cellIndex: 0, progress: 0.1 },
    ];

    const original = computeStructureAggregate(cards);
    const afterReorder = computeStructureAggregate(reordered);

    expect(afterReorder).toEqual(original);
    expect(original.average).toBeCloseTo(0.5); // (0.1 + 0.9) / 2, кожна врахована картка рівною вагою
  });
});

// T7 (AC-06) -- у розкладці "за логікою" позиція (cellIndex) явно виражає
// заявлений пріоритет (spec.md AC-06: "an explicit priority scheme by
// position"). Розрив = position-derived priority rank (нормалізований
// 0..1, менший cellIndex = вищий пріоритет) мінус фактичний прогрес.
// Жодного вердикту -- лише число (spec.md §3 Non-goals, D-60).
describe('computeLogicLayoutGaps -- AC-06 (розрив ранг-за-позицією vs прогрес, без вердикту)', () => {
  it('returns, per card, the gap between its position-derived priority rank and its actual progress', () => {
    const cards: LogicLayoutGapInput[] = [
      { cardId: 'card-top', cellIndex: 0, progress: 0.9 }, // найважливіша позиція, прогрес майже наздоганяє
      { cardId: 'card-mid', cellIndex: 1, progress: 0.5 },
      { cardId: 'card-bottom', cellIndex: 2, progress: 0.1 }, // найменш пріоритетна позиція
    ];

    const gaps = computeLogicLayoutGaps(cards);

    const byId = Object.fromEntries(gaps.map((g) => [g.cardId, g.gap]));
    expect(byId['card-top']).toBeCloseTo(0.1); // rank 1 - progress 0.9
    expect(byId['card-mid']).toBeCloseTo(0); // rank 0.5 - progress 0.5
    expect(byId['card-bottom']).toBeCloseTo(-0.1); // rank 0 - progress 0.1

    // spec.md AC-06 -- "honestly, with no good/bad verdict attached": лише
    // числове значення розриву, жодного поля-етикетки якості/оцінки.
    for (const gap of gaps) {
      expect(gap).not.toHaveProperty('verdict');
      expect(gap).not.toHaveProperty('label');
    }
  });
});

// T7 (AC-06b) -- розкладки без явної схеми пріоритету (single / free) не
// мають рангу за позицією взагалі, тож ранг-розрив (AC-06) для них не
// показується. Замість цього -- сигнал "картку завели (заявили важливою),
// але реально не ведуть" для карток, що мали намір трекати (metric-block
// заявлений), проте не мають жодного запису.
describe('flagUnmaintainedCards -- AC-06b (розкладка без схеми: "заявлено -- не ведеться")', () => {
  it('flags a card that declared a metric-block but has zero recorded entries', () => {
    const cards: CardMaintenanceInput[] = [
      { cardId: 'card-declared-idle', hasMetricBlock: true, entryCount: 0 },
      { cardId: 'card-active', hasMetricBlock: true, entryCount: 5 },
      { cardId: 'card-declarative-only', hasMetricBlock: false, entryCount: 0 },
    ];

    const flagged = flagUnmaintainedCards(cards);

    expect(flagged).toEqual(['card-declared-idle']);
  });

  it('flags no card when every declared metric-block has at least one entry', () => {
    const cards: CardMaintenanceInput[] = [
      { cardId: 'card-active', hasMetricBlock: true, entryCount: 1 },
    ];

    expect(flagUnmaintainedCards(cards)).toEqual([]);
  });
});

// T7 (AC-07) -- коли розрив спостерігався в більш ніж одній точці часу,
// показуємо ще й напрямок зміни (росте/меншає), не лише поточне значення
// (spec.md AC-07). Порівнюємо найранішу і найпізнішу точку за модулем
// розриву (|gap|) -- зростання модуля = розрив росте, зменшення = меншає.
describe('computeGapTrend -- AC-07 (напрямок зміни розриву у часі)', () => {
  it('reports "growing" when the gap magnitude increased between the earliest and latest observation', () => {
    const observations: GapObservation[] = [
      { gap: 0.1, occurredAt: '2026-09-01T00:00:00.000Z' },
      { gap: 0.3, occurredAt: '2026-09-10T00:00:00.000Z' },
    ];

    expect(computeGapTrend(observations)).toBe('growing');
  });

  it('reports "shrinking" when the gap magnitude decreased between the earliest and latest observation', () => {
    const observations: GapObservation[] = [
      { gap: -0.4, occurredAt: '2026-09-05T00:00:00.000Z' },
      { gap: -0.1, occurredAt: '2026-09-01T00:00:00.000Z' }, // масив не обов'язково впорядкований
    ];

    expect(computeGapTrend(observations)).toBe('shrinking');
  });

  it('returns null -- not enough points in time to derive a direction -- when only one observation exists', () => {
    const observations: GapObservation[] = [
      { gap: 0.2, occurredAt: '2026-09-01T00:00:00.000Z' },
    ];

    expect(computeGapTrend(observations)).toBeNull();
  });
});
