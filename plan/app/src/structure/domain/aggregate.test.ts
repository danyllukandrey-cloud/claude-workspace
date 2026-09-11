import { describe, it, expect } from 'vitest';
import {
  computeStructureAggregate,
  computeLogicLayoutGaps,
  logicLayoutScale,
  positionPriorityRank,
  flagUnmaintainedCards,
  computeGapTrend,
  computeCardGapTrend,
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

  // Review 2026-09-11, Частина 1 [critical]: РЕАЛЬНИЙ виклик (../app/
  // get-analytics.ts) передає сюди лише картки з обчислюваним відсотком --
  // решта клітинок сітки відфільтрована (AC-13). Тобто cellIndex-и приходять
  // РОЗРІДЖЕНІ, і нормалізація по кількості переданих карток
  // (`cards.length - 1`) дає дільник, менший за найбільший cellIndex: ранг
  // вилітає за 0..1 у мінус, а "розрив" стає числом, яке не означає нічого
  // (до фіксу: -1.5 при прогресі 0.5). Старий тест цього не ловив лише тому,
  // що його клітинки йшли підряд 0,1,2.
  it('keeps the rank inside 0..1 when the cell indexes are sparse (cards without a percentage filtered out)', () => {
    // Сітка з 5 клітинок (0..4); картки в клітинках 1 і 2 без відсотка, тож
    // викликач їх не передає -- лишаються 0, 3, 4.
    const cards: LogicLayoutGapInput[] = [
      { cardId: 'card-top', cellIndex: 0, progress: 0.5 },
      { cardId: 'card-late', cellIndex: 3, progress: 0.5 },
      { cardId: 'card-last', cellIndex: 4, progress: 0.5 },
    ];

    const gaps = computeLogicLayoutGaps(cards);

    const byId = Object.fromEntries(gaps.map((g) => [g.cardId, g.gap]));
    // Ранг -- 1, 0.25, 0 (нормалізація по сітці 0..4), тож розрив -- rank - 0.5.
    expect(byId['card-top']).toBeCloseTo(0.5);
    expect(byId['card-late']).toBeCloseTo(-0.25);
    expect(byId['card-last']).toBeCloseTo(-0.5);
    // Інваріант, який ламався: розрив не може вийти за -1..1, бо ранг -- 0..1,
    // а прогрес -- 0..1.
    for (const gap of gaps) {
      expect(gap.gap).toBeGreaterThanOrEqual(-1);
      expect(gap.gap).toBeLessThanOrEqual(1);
    }
  });

  it('uses the explicit grid scale, so the same card keeps the same rank whichever subset is computed', () => {
    const scale = logicLayoutScale([
      { cellIndex: 0 },
      { cellIndex: 1 },
      { cellIndex: 2 },
      { cellIndex: 3 },
      { cellIndex: 4 },
    ]);

    const wholeGrid = computeLogicLayoutGaps(
      [
        { cardId: 'card-a', cellIndex: 0, progress: 0.5 },
        { cardId: 'card-b', cellIndex: 2, progress: 0.5 },
        { cardId: 'card-c', cellIndex: 4, progress: 0.5 },
      ],
      scale,
    );
    // Та сама шкала, але передана лише ОДНА картка (решта без відсотка).
    const subset = computeLogicLayoutGaps([{ cardId: 'card-b', cellIndex: 2, progress: 0.5 }], scale);

    const fromWhole = wholeGrid.find((g) => g.cardId === 'card-b');
    expect(subset[0].gap).toBeCloseTo(fromWhole!.gap);
  });

  it('gives no rank gap at all to a card without a cell (unplaced tray) -- never the cell-0 rank', () => {
    // cell_index nullable після міграції 06 (AC-11b/AC-16b/AC-17): картка в
    // треї не заявила жодного пріоритету, тож розриву для неї не існує.
    // Коерція null -> 0 дала б їй ранг 1, тобто "найважливіша" -- заяву, якої
    // користувач не робив.
    const gaps = computeLogicLayoutGaps([
      { cardId: 'card-placed', cellIndex: 0, progress: 0.4 },
      { cardId: 'card-in-tray', cellIndex: null, progress: 0.4 },
      { cardId: 'card-last', cellIndex: 2, progress: 0.4 },
    ]);

    expect(gaps.map((g) => g.cardId)).toEqual(['card-placed', 'card-last']);
    // І трей не розтягує шкалу: maxCellIndex -- 2, тож остання клітинка -- ранг 0.
    expect(gaps.find((g) => g.cardId === 'card-last')!.gap).toBeCloseTo(-0.4);
  });

  it('ranks a single placed card highest (1) -- there is nothing to compare it against', () => {
    const gaps = computeLogicLayoutGaps([{ cardId: 'card-only', cellIndex: 0, progress: 0.25 }]);

    expect(gaps[0].gap).toBeCloseTo(0.75); // rank 1 - progress 0.25
  });

  it('positionPriorityRank never leaves 0..1, even for a cell outside the known grid', () => {
    const scale = logicLayoutScale([{ cellIndex: 0 }, { cellIndex: 1 }, { cellIndex: 2 }]);

    expect(positionPriorityRank(0, scale)).toBeCloseTo(1);
    expect(positionPriorityRank(2, scale)).toBeCloseTo(0);
    expect(positionPriorityRank(99, scale)).toBe(0); // за межами сітки -- підтягнуто до межі
    expect(positionPriorityRank(-3, scale)).toBe(1);
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
// показуємо ще й напрямок зміни (росте/меншає/стабільний), не лише поточне
// значення (spec.md AC-07). Порівнюємо найранішу і найпізнішу точку за
// МОДУЛЕМ розриву (|gap|) -- зростання модуля = розрив росте, зменшення =
// меншає; семантика зафіксована в одному місці, domain/aggregate.ts
// (review 2026-09-11: до фіксу код порівнював знакове значення, а цей
// коментар казав "за модулем" -- два різні правила на одне питання).
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
      // Дані виправлені (review 2026-09-11): раніше цей тест подавав
      // найраніший розрив -0.1 і найпізніший -0.4, тобто модуль ЗРОСТАВ --
      // тест називався "shrinking", а описував протилежне, і проходив лише
      // тому, що код порівнював знак. Тепер модуль справді меншає 0.4 -> 0.1.
      { gap: -0.1, occurredAt: '2026-09-05T00:00:00.000Z' },
      { gap: -0.4, occurredAt: '2026-09-01T00:00:00.000Z' }, // масив не обов'язково впорядкований
    ];

    expect(computeGapTrend(observations)).toBe('shrinking');
  });

  it('reports "growing" when a negative gap deepens -- the distance grew, however the sign reads', () => {
    // Той самий випадок, що розрізняє дві семантики: за знаком -0.1 -> -0.5 це
    // "меншає", за модулем (і за сенсом "відстань між заявленим і фактичним")
    // це "росте". Фіксуємо модуль.
    const observations: GapObservation[] = [
      { gap: -0.1, occurredAt: '2026-09-01T00:00:00.000Z' },
      { gap: -0.5, occurredAt: '2026-09-10T00:00:00.000Z' },
    ];

    expect(computeGapTrend(observations)).toBe('growing');
  });

  it('reports "stable" -- a known, unchanged gap -- distinctly from null ("no data to compare")', () => {
    const unchanged: GapObservation[] = [
      { gap: 0.2, occurredAt: '2026-09-01T00:00:00.000Z' },
      { gap: 0.2, occurredAt: '2026-09-10T00:00:00.000Z' },
    ];

    expect(computeGapTrend(unchanged)).toBe('stable');
    // І це НЕ те саме, що "точок менше двох" -- там відповідь null.
    expect(computeGapTrend([{ gap: 0.2, occurredAt: '2026-09-01T00:00:00.000Z' }])).toBeNull();
  });

  it('returns null -- not enough points in time to derive a direction -- when only one observation exists', () => {
    const observations: GapObservation[] = [
      { gap: 0.2, occurredAt: '2026-09-01T00:00:00.000Z' },
    ];

    expect(computeGapTrend(observations)).toBeNull();
  });

  it('returns null for no observation at all', () => {
    expect(computeGapTrend([])).toBeNull();
  });
});

// AC-07 на рівні однієї картки -- обидві точки міряються ОДНІЄЮ шкалою
// (review 2026-09-11, Частина 2 [major]: "поточний і минулий gap рахуються в
// різних шкалах рангу -- growing/shrinking стає довільним, щойно є хоч одна
// картка без відсотка").
describe('computeCardGapTrend -- AC-07 (минулий і поточний розрив по одній шкалі)', () => {
  const FIVE_CELL_GRID = logicLayoutScale([
    { cellIndex: 0 },
    { cellIndex: 1 },
    { cellIndex: 2 },
    { cellIndex: 3 },
    { cellIndex: 4 },
  ]);

  it('reports "growing" when the card was moved UP in priority while its progress stayed put', () => {
    // Клітинка 4 (ранг 0) -> клітинка 0 (ранг 1) при прогресі 0.2:
    // розрив -0.2 -> 0.8, модуль зріс.
    const trend = computeCardGapTrend(
      {
        pastCellIndex: 4,
        pastObservedAt: '2026-09-01T00:00:00.000Z',
        currentCellIndex: 0,
        currentObservedAt: '2026-09-10T00:00:00.000Z',
        progress: 0.2,
      },
      FIVE_CELL_GRID,
    );

    expect(trend).toBe('growing');
  });

  it('reports "shrinking" when the card moved to the cell its progress actually matches', () => {
    // Клітинка 0 (ранг 1) -> клітинка 3 (ранг 0.25) при прогресі 0.25:
    // розрив 0.75 -> 0, модуль упав.
    const trend = computeCardGapTrend(
      {
        pastCellIndex: 0,
        pastObservedAt: '2026-09-01T00:00:00.000Z',
        currentCellIndex: 3,
        currentObservedAt: '2026-09-10T00:00:00.000Z',
        progress: 0.25,
      },
      FIVE_CELL_GRID,
    );

    expect(trend).toBe('shrinking');
  });

  it('reports "stable" when the card never left its cell -- known, not "no data"', () => {
    const trend = computeCardGapTrend(
      {
        pastCellIndex: 2,
        pastObservedAt: '2026-09-01T00:00:00.000Z',
        currentCellIndex: 2,
        currentObservedAt: '2026-09-10T00:00:00.000Z',
        progress: 0.5,
      },
      FIVE_CELL_GRID,
    );

    expect(trend).toBe('stable');
  });

  it('measures both points with ONE scale -- a wider grid changes the size, never the direction', () => {
    const input = {
      pastCellIndex: 4,
      pastObservedAt: '2026-09-01T00:00:00.000Z',
      currentCellIndex: 1,
      currentObservedAt: '2026-09-10T00:00:00.000Z',
      progress: 0.3,
    };
    const widerGrid = logicLayoutScale([{ cellIndex: 0 }, { cellIndex: 9 }]);

    expect(computeCardGapTrend(input, FIVE_CELL_GRID)).toBe('growing');
    expect(computeCardGapTrend(input, widerGrid)).toBe('growing');
  });
});
