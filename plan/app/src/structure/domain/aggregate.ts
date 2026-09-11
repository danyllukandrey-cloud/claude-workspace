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
