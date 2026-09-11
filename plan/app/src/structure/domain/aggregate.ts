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

export interface LogicLayoutGapInput {
  cardId: string;
  cellIndex: number;
  progress: number;
}

export interface LogicLayoutGap {
  cardId: string;
  gap: number;
}

export function computeLogicLayoutGaps(
  cards: LogicLayoutGapInput[],
): LogicLayoutGap[] {
  const maxIndex = cards.length - 1;

  return cards.map((card) => {
    const rank = maxIndex > 0 ? 1 - card.cellIndex / maxIndex : 1;
    return { cardId: card.cardId, gap: rank - card.progress };
  });
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
// ще й напрямок зміни (росте/меншає), порівнюючи значення розриву (gap,
// зі знаком) у найранішій і найпізнішій точці за часом. Замало точок --
// null (недостатньо даних для напрямку).

export interface GapObservation {
  gap: number;
  occurredAt: string;
}

export type GapTrend = 'growing' | 'shrinking' | null;

export function computeGapTrend(observations: GapObservation[]): GapTrend {
  if (observations.length < 2) {
    return null;
  }

  const sorted = [...observations].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const earliest = sorted[0].gap;
  const latest = sorted[sorted.length - 1].gap;

  if (latest > earliest) {
    return 'growing';
  }
  if (latest < earliest) {
    return 'shrinking';
  }
  return null;
}
