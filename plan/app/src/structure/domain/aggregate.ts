// Доменна логіка "Структури" -- агрегація прогресу карток.
// Прогрес кожної картки вже обчислений самою карткою (spec.md §1):
// Структура не переобчислює формулу картки, лише усереднює вже готові
// значення (`share`, 0..1) і рахує, скільки карток не увійшло в середнє.

export interface CardAggregateInput {
  cardId: string;
  cellIndex: number;
  progress: number | null;
}

export interface StructureAggregate {
  average: number | null;
  excludedCount: number;
}

export function computeStructureAggregate(
  cards: CardAggregateInput[],
): StructureAggregate {
  const computable = cards.filter((card) => card.progress !== null);
  const excludedCount = cards.length - computable.length;

  if (computable.length === 0) {
    return { average: null, excludedCount };
  }

  const sum = computable.reduce((total, card) => total + (card.progress as number), 0);
  return { average: sum / computable.length, excludedCount };
}

// AC-06 -- у розкладці "за логікою" позиція (cellIndex) явно виражає
// заявлений пріоритет. Розрив = position-derived priority rank (0..1,
// менший cellIndex = вищий пріоритет) мінус фактичний прогрес. Жодного
// вердикту -- лише число (spec.md §3 Non-goals, D-60).
//
// Review 2026-09-11, Частина 1 [critical]: ранг нормалізувався по КІЛЬКОСТІ
// переданих карток (`cards.length - 1`), а не по СІТЦІ розкладки. Щойно
// cellIndex-и розріджені -- а це норма, бо викликач (../app/get-analytics.ts)
// відфільтровує картки без обчислюваного відсотка ДО цієї функції (AC-13) --
// дільник виходить меншим за найбільший cellIndex, і ранг вилітає за межі
// 0..1 у мінус: "розрив" ставав від'ємним числом без жодного сенсу (картка в
// останній клітинці сітки з 5 карток, з яких 2 без відсотка: rank = 1 - 4/2
// = -1). Тепер шкала -- окремий ЯВНИЙ аргумент (`LogicLayoutScale`):
//   1. ранг завжди лишається в 0..1 (а розрив -- у -1..1), незалежно від
//      того, яку підмножину карток передали;
//   2. ОДНУ шкалу можна передати і в поточний, і в минулий розрахунок
//      (AC-07's тренд, `computeCardGapTrend` нижче) -- інакше "зросло/спало"
//      міряється двома різними лінійками й напрямок стає довільним.

export interface LogicLayoutGapInput {
  cardId: string;
  /**
   * `null` -- картка без клітинки (трей нерозкладених, AC-11b/AC-16b/AC-17):
   * позиції немає, тож і рангу за позицією немає. Така картка НЕ отримує
   * розриву (її просто немає в результаті), а не розрив "як для клітинки 0":
   * нуль -- найвищий пріоритет, і видати його ненавмисно означало б
   * приписати користувачу заяву, якої він не робив.
   */
  cellIndex: number | null;
  progress: number;
}

export interface LogicLayoutGap {
  cardId: string;
  gap: number;
}

/**
 * Шкала нормалізації рангу -- сітка розкладки, а не набір карток, що
 * увійшли в конкретний розрахунок.
 */
export interface LogicLayoutScale {
  /** Найбільший cellIndex сітки -- дільник нормалізації. */
  maxCellIndex: number;
}

/**
 * Шкала з УСІХ активних позицій розкладки (включно з картками без
 * обчислюваного відсотка -- вони теж займають клітинки сітки).
 */
export function logicLayoutScale(positions: { cellIndex: number | null }[]): LogicLayoutScale {
  return {
    maxCellIndex: positions.reduce(
      (max, position) => (position.cellIndex === null ? max : Math.max(max, position.cellIndex)),
      0,
    ),
  };
}

/**
 * Ранг пріоритету за позицією: 1 -- найвищий (перша клітинка), 0 --
 * найнижчий (остання клітинка сітки). Завжди в межах 0..1: клітинка поза
 * відомою сіткою підтягується до її межі, єдина клітинка -- завжди 1
 * (порівнювати ні з чим).
 */
export function positionPriorityRank(cellIndex: number, scale: LogicLayoutScale): number {
  if (scale.maxCellIndex <= 0) {
    return 1;
  }
  const withinGrid = Math.min(Math.max(cellIndex, 0), scale.maxCellIndex);
  return 1 - withinGrid / scale.maxCellIndex;
}

export function computeLogicLayoutGaps(
  cards: LogicLayoutGapInput[],
  scale: LogicLayoutScale = logicLayoutScale(cards),
): LogicLayoutGap[] {
  return cards
    .filter((card): card is LogicLayoutGapInput & { cellIndex: number } => card.cellIndex !== null)
    .map((card) => ({
      cardId: card.cardId,
      gap: positionPriorityRank(card.cellIndex, scale) - card.progress,
    }));
}

// AC-06b -- розкладки без явної схеми пріоритету (single / free) не мають
// рангу за позицією, тож ранг-розрив (AC-06) для них не показується.
// Замість цього -- сигнал "заявлено (metric-block є) -- не ведеться
// (нуль записів)".

export interface CardMaintenanceInput {
  cardId: string;
  hasMetricBlock: boolean;
  entryCount: number;
}

export function flagUnmaintainedCards(cards: CardMaintenanceInput[]): string[] {
  return cards
    .filter((card) => card.hasMetricBlock && card.entryCount === 0)
    .map((card) => card.cardId);
}

// AC-07 -- коли розрив спостерігався в більш ніж одній точці часу, показуємо
// ще й напрямок зміни (росте/меншає/стабільний).
//
// СЕМАНТИКА ЗАФІКСОВАНА ТУТ І ЛИШЕ ТУТ (review 2026-09-11, Частина 1
// [major]: код порівнював ЗНАКОВЕ значення розриву, а коментар тесту казав
// "за модулем" -- дві несумісні відповіді на те саме питання, тож "росте"
// означало різне залежно від того, що читаєш).
//
// Напрямок міряється МОДУЛЕМ розриву |gap|, не знаком. Чому: розрив -- це
// ВІДСТАНЬ між заявленим і фактичним (CONTEXT.md: "gap -- різниця між
// заявленим і фактичним"), а AC-07 питає саме про розмір цієї відстані
// ("whether the gap is growing or shrinking, not only its current size").
// Розрив -0.4 -- БІЛЬША неузгодженість, ніж -0.1, хоч і менше число: знак
// каже лише, у який бік перекос (заявлено більше, ніж зроблено, чи навпаки),
// і сам по собі показується окремо як число розриву (AC-06), без вердикту.
//
// Три окремі відповіді, не дві:
// - 'growing'/'shrinking' -- модуль розриву зріс / зменшився;
// - 'stable' -- точки Є, і розрив між ними не змінився (це ЗНАННЯ про
//   картку);
// - null -- точок менше двох, напрямок невідомий (ДАНИХ НЕМА). До цього
//   фіксу "не змінився" і "нема з чим порівняти" віддавали однакове null,
//   тож UI не міг їх розрізнити.

export interface GapObservation {
  gap: number;
  occurredAt: string;
}

export type GapTrend = 'growing' | 'shrinking' | 'stable' | null;

/**
 * Допуск порівняння модулів -- ранг нормалізується діленням, тож два
 * математично однакові розриви можуть відрізнятись на 1e-17 через
 * double-арифметику; без допуску 'stable' ніколи б не спрацьовував стабільно.
 */
const GAP_TREND_EPSILON = 1e-9;

export function computeGapTrend(observations: GapObservation[]): GapTrend {
  if (observations.length < 2) {
    return null;
  }

  const sorted = [...observations].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const earliest = Math.abs(sorted[0].gap);
  const latest = Math.abs(sorted[sorted.length - 1].gap);

  if (Math.abs(latest - earliest) < GAP_TREND_EPSILON) {
    return 'stable';
  }
  return latest > earliest ? 'growing' : 'shrinking';
}

/**
 * AC-07 для однієї картки -- обидві точки (минула клітинка з Літопису й
 * поточна) перераховуються в розрив ОДНІЄЮ шкалою (`scale`), тим самим
 * набором карток. Без цього "зросло/спало" порівнювало два числа, зняті
 * різними лінійками (review 2026-09-11, Частина 2 [major]: "поточний і
 * минулий gap рахуються в різних шкалах рангу").
 *
 * Прогрес один на обидві точки: минулого прогресу Структура не зберігає
 * (ADR-0001 -- жодного кешу похідних чисел), тож у часі змінюється лише
 * ранг-за-позицією, і тренд відповідає саме на питання "чи заявлений
 * пріоритет віддаляється від фактичного стану".
 */
export interface CardGapTrendInput {
  /** Клітинка, у якій картка стояла в минулій точці часу (подія 'moved'). */
  pastCellIndex: number;
  pastObservedAt: string;
  /** Клітинка, у якій картка стоїть у поточній точці. */
  currentCellIndex: number;
  currentObservedAt: string;
  /** Фактичний прогрес картки (0..1). */
  progress: number;
}

export function computeCardGapTrend(input: CardGapTrendInput, scale: LogicLayoutScale): GapTrend {
  return computeGapTrend([
    {
      gap: positionPriorityRank(input.pastCellIndex, scale) - input.progress,
      occurredAt: input.pastObservedAt,
    },
    {
      gap: positionPriorityRank(input.currentCellIndex, scale) - input.progress,
      occurredAt: input.currentObservedAt,
    },
  ]);
}
