// Доменна логіка "Структури" -- розкладка карток (AC-09, AC-11, AC-11b,
// AC-16, AC-16b). Чиста функція, без I/O (plan/app/CLAUDE.md, "domain ->
// НІЧОГО"): лише ЩО має статись (план), не ЯК він потрапляє в базу --
// транзакційний запис лишається за T11 (App: updateStructure use-case).

export type LayoutMode = 'free' | 'single' | 'logic' | null;
export type LogicVariant = 'balance' | 'focus' | 'cause_effect' | null;

const LOGIC_VARIANTS: ReadonlyArray<Exclude<LogicVariant, null>> = [
  'balance',
  'focus',
  'cause_effect',
];

export class LayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutValidationError';
  }
}

export interface LayoutPosition {
  cardId: string;
  cellIndex: number;
}

export interface DefaultPosition {
  cellIndex: number;
}

export interface ResetLayoutPosition {
  cardId: string;
  baseOrder: number;
  cellIndex: null;
}

export interface LayoutResetPlan {
  positions: ResetLayoutPosition[];
}

export interface TimestampedPosition {
  cardId: string;
  cellIndex: number;
  positionUpdatedAt: string;
}

export type LayoutPositionStatus = 'active' | 'closed';

export interface LayoutPositionRow {
  cardId: string;
  cellIndex: number;
  status: LayoutPositionStatus;
}

// AC-09: новій картці дається клітинка за замовчуванням навіть коли режим
// розкладки ще не обрано (null) -- це ніколи не блокує створення картки.
export function defaultPositionForNewCard(
  existing: LayoutPosition[],
  _layoutMode: LayoutMode,
): DefaultPosition {
  const nextCellIndex = existing.reduce(
    (max, position) => Math.max(max, position.cellIndex + 1),
    0,
  );

  return { cellIndex: nextCellIndex };
}

// AC-16: logicVariant валідний лише коли layoutMode = 'logic'; null завжди
// дозволено (підвид ще не обрано).
export function assertLogicVariantAllowed(
  layoutMode: LayoutMode,
  logicVariant: LogicVariant,
): void {
  if (logicVariant === null) {
    return;
  }

  if (!LOGIC_VARIANTS.includes(logicVariant as Exclude<LogicVariant, null>)) {
    throw new LayoutValidationError(`invalid logicVariant: ${String(logicVariant)}`);
  }

  if (layoutMode !== 'logic') {
    throw new LayoutValidationError('logicVariant is only allowed when layoutMode is "logic"');
  }
}

function resetToBaseOrder(positions: LayoutPosition[]): LayoutResetPlan {
  const baseOrdered = [...positions].sort((a, b) => a.cellIndex - b.cellIndex);

  return {
    positions: baseOrdered.map((position, index) => ({
      cardId: position.cardId,
      baseOrder: index,
      cellIndex: null,
    })),
  };
}

// AC-11 / AC-11b: зміна режиму розкладки скидає кожну вже розміщену картку
// у фіксований базовий порядок, знімаючи стару клітинку -- користувач
// розкладає картки по новому режиму сам.
export function switchLayoutMode(
  positions: LayoutPosition[],
  _newMode: LayoutMode,
): LayoutResetPlan {
  return resetToBaseOrder(positions);
}

// AC-16b: зміна підвиду "за логікою" -- той самий reset-план, що й зміна
// layoutMode (AC-11b), і дозволена лише коли Структура вже в режимі 'logic'.
export function switchLogicVariant(
  currentLayoutMode: LayoutMode,
  positions: LayoutPosition[],
  _newVariant: LogicVariant,
): LayoutResetPlan {
  if (currentLayoutMode !== 'logic') {
    throw new LayoutValidationError('logicVariant can only be switched while layoutMode is "logic"');
  }

  return resetToBaseOrder(positions);
}

// AC-02 (D-62 -- одна клітинка = одна картка): у режимі "за логікою" кожна
// активна клітинка тримає рівно одну картку. Перетягування на вже зайняту
// чужою карткою клітинку блокується, а не тихо переписує сусіда; картка,
// що вже тримає цю клітинку сама, не вважається колізією (переміщення "на
// себе" -- no-op, не помилка).
export function assertCellAvailable(
  activePositions: LayoutPosition[],
  cellIndex: number,
  cardId: string,
): void {
  const occupant = activePositions.find((position) => position.cellIndex === cellIndex);

  if (occupant && occupant.cardId !== cardId) {
    throw new LayoutValidationError(`cell ${cellIndex} is already occupied by a different card`);
  }
}

// AC-08 / ADR-0002: дві мітки часу, що конфліктують після офлайн-
// синхронізації, вирішуються last-write-wins за positionUpdatedAt --
// пізніший запис перемагає, ранішній тихо відкидається, без злиття.
export function resolvePositionConflict(
  a: TimestampedPosition,
  b: TimestampedPosition,
): TimestampedPosition {
  return a.positionUpdatedAt >= b.positionUpdatedAt ? a : b;
}

// AC-12 (D-66 -- ніколи фізичне видалення): закриття напрямку позначає
// рядок статусом 'closed', рядок і його card_id лишаються доступні для
// історії/переносу метрик.
export function closeLayoutPosition(position: LayoutPositionRow): LayoutPositionRow {
  return { ...position, status: 'closed' };
}
