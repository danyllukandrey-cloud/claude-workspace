export type CardStatus = 'active' | 'archived';
export type LifecycleState = 'created' | 'filled' | 'in_use' | 'archived';

// CH-02 (docs/features/life-area-card/changes.md), розширено CH-10: режим
// відстеження картки. 'state' -- "картка: стан без вимірювань" -- НІЯКОГО
// блоку-метрики, замість прогресу картка несе один із трьох станів
// (healthState), кольоровий м'ячик (ui/CardFace.tsx) -- той самий підхід,
// що вже EntryHistoryList.tsx's STATUS_DOT/chip-gloss (D-120/D-126).
//
// CH-10 (живе тестування 2026-09-21): колишній єдиний 'metrics' розведено
// на два окремі режими -- та сама назва "Постійний процес з метриками (без
// дати)" одночасно позначала і режим картки, і чекбокс у формі окремого
// блоку-метрики, плутало.
//   'ongoing' -- блоки без цілі/дати взагалі (форма показує лише "Що
//                рахуємо"+"Одиниця").
//   'goals'   -- те, чим був старий 'metrics': блок несе ціль+дату.
//
// Назва поля -- healthState, НЕ "state": card.status (active/archived,
// життєвий цикл) уже займає найочевидніше ім'я, друге "state"-поле поруч із
// "status" плутало б навіть у коментарях, не кажучи вже про код.
export type CardTrackingMode = 'state' | 'ongoing' | 'goals';
export type CardHealthState = 'active' | 'critical' | 'paused';

export const CARD_HEALTH_STATES: readonly CardHealthState[] = ['active', 'critical', 'paused'];

/** Рантайм-перевірка значення з межі системи (HTTP body) -- тип сам по собі рантайм не гарантує. */
export function isCardHealthState(value: unknown): value is CardHealthState {
  return typeof value === 'string' && (CARD_HEALTH_STATES as readonly string[]).includes(value);
}

export interface Card {
  id: string;
  name: string;
  description: string | null;
  status: CardStatus;
  /** CH-02/CH-10: за замовчуванням 'goals' -- усі картки, створені до CH-10, лишаються з ціллю+датою (колишній 'metrics'). */
  trackingMode: CardTrackingMode;
  /** Ненульове лише коли trackingMode === 'state' (CH-02). */
  healthState: CardHealthState | null;
}

export class CardValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CardValidationError';
    this.code = code;
  }
}

// Експортовано (T27 should-fix): ui/CreateCardForm.tsx перевикористовує цю
// саму перевірку для інлайн-помилки ДО виклику onCreate, замість дублювання
// власного тексту -- один рядок правди про "що таке порожня назва".
export function assertNonEmpty(value: string, code: string, message: string): void {
  if (value == null || !value.trim()) {
    throw new CardValidationError(code, message);
  }
}

export function createCard(input: { id: string; name: string }): Card {
  assertNonEmpty(input.name, 'card.name_required', 'Назва картки обовʼязкова');
  return {
    id: input.id,
    name: input.name.trim(),
    description: null,
    status: 'active',
    trackingMode: 'goals',
    healthState: null,
  };
}

// CH-02/CH-10: перемикання режиму відстеження -- чисті функції, той самий
// стиль, що markFilled/archiveCard вище (нова копія картки, жодного
// мутування). Use-case (app/update-card.ts) викликає їх, а не будує патч
// вручну -- "healthState завжди null у режимах без стану" лишається ОДНИМ
// правилом, тут, а не повтореним у кожному викликачі.
//
// Review-fix (CH-10): 'ongoing' і 'goals' раніше були двома окремими
// функціями, що відрізнялись лише літералом -- одна спільна, параметризована
// режимом, той самий підхід, що міграція вже застосувала до health_state
// CHECK (булева еквівалентність, а не перелік значень) -- наступний
// не-'state' режим не вимагатиме нової функції.

export function setTrackingModeNonState(card: Card, mode: Exclude<CardTrackingMode, 'state'>): Card {
  return { ...card, trackingMode: mode, healthState: null };
}

export function setTrackingModeState(card: Card, healthState: CardHealthState): Card {
  return { ...card, trackingMode: 'state', healthState };
}

export function markFilled(card: Card, description: string): Card {
  assertNonEmpty(description, 'card.description_required', 'Опис обовʼязковий перед позначенням "заповнена"');
  return { ...card, description };
}

export function getLifecycleState(card: Card, metricBlockCount: number): LifecycleState {
  if (card.status === 'archived') {
    return 'archived';
  }
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
