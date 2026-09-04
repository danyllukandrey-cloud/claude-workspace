export type CardStatus = 'active' | 'archived';
export type LifecycleState = 'created' | 'filled' | 'in_use';

export interface Card {
  id: string;
  name: string;
  description: string | null;
  status: CardStatus;
}

export class CardValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CardValidationError';
    this.code = code;
  }
}

function assertNonEmpty(value: string, code: string, message: string): void {
  if (!value.trim()) {
    throw new CardValidationError(code, message);
  }
}

export function createCard(input: { id: string; name: string }): Card {
  assertNonEmpty(input.name, 'card.name_required', 'Назва картки обовʼязкова');
  return { id: input.id, name: input.name, description: null, status: 'active' };
}

export function markFilled(card: Card, description: string): Card {
  assertNonEmpty(description, 'card.description_required', 'Опис обовʼязковий перед позначенням "заповнена"');
  return { ...card, description };
}

export function getLifecycleState(card: Card, metricBlockCount: number): LifecycleState {
  if (card.description && metricBlockCount > 0) {
    return 'in_use';
  }
  if (card.description) {
    return 'filled';
  }
  return 'created';
}

export function archiveCard(card: Card): Card {
  return { ...card, status: 'archived' };
}
