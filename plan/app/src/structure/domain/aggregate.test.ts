import { describe, it, expect } from 'vitest';
import { computeStructureAggregate } from './aggregate';
import type { CardAggregateInput } from './aggregate';

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
