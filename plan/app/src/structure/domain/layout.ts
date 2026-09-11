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
  // NULL = "картка без клітинки": лежить у треї нерозкладених унизу екрана
  // (AC-11b/AC-16b після reset, AC-17 для відновленої з архіву картки).
  // Рев'ю 2026-09-11: міграція 06 зробила `cell_index` nullable, тож домен
  // мусить ЧИТАТИ цей стан, а не лише віддавати його в плані скидання --
  // інакше друге підряд перемикання режиму рахує NULL як нуль.
  cellIndex: number | null;
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
  // Картки без клітинки (трей) не зсувають наступну вільну клітинку: вони не
  // займають жодної, тому в підрахунку максимуму їх просто немає.
  const nextCellIndex = existing.reduce(
    (max, position) => (position.cellIndex === null ? max : Math.max(max, position.cellIndex + 1)),
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

/**
 * Базовий порядок: спершу розкладені картки за зростанням клітинки, потім ті,
 * що клітинки не мали (трей) -- у порядку, в якому прийшли. Пряме
 * `a.cellIndex - b.cellIndex` коерціює NULL у 0 і вклинює трей на ПОЧАТОК
 * (NaN/0-порівняння), через що друге підряд перемикання режиму перемішувало
 * порядок (рев'ю 2026-09-11).
 */
function compareByCellIndexNullsLast(a: LayoutPosition, b: LayoutPosition): number {
  if (a.cellIndex === null && b.cellIndex === null) return 0;
  if (a.cellIndex === null) return 1;
  if (b.cellIndex === null) return -1;
  return a.cellIndex - b.cellIndex;
}

function resetToBaseOrder(positions: LayoutPosition[]): LayoutResetPlan {
  const baseOrdered = [...positions].sort(compareByCellIndexNullsLast);

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

// AC-16b: підвид перемикають лише ВСЕРЕДИНІ режиму 'logic'. Окрема від
// switchLogicVariant перевірка, щоб use-case міг відмовити ДО будь-якого запису,
// а не з середини reset-циклу -- і щоб помилка лишалась доменною
// (LayoutValidationError -> 422), а не невідомою серверу 500 (рев'ю 2026-09-11:
// PATCH {logicVariant: null} на вже-'free' Структурі давав саме 500).
export function assertLogicVariantSwitchable(currentLayoutMode: LayoutMode): void {
  if (currentLayoutMode !== 'logic') {
    throw new LayoutValidationError('logicVariant can only be switched while layoutMode is "logic"');
  }
}

// AC-16b: зміна підвиду "за логікою" -- той самий reset-план, що й зміна
// layoutMode (AC-11b), і дозволена лише коли Структура вже в режимі 'logic'.
export function switchLogicVariant(
  currentLayoutMode: LayoutMode,
  positions: LayoutPosition[],
  _newVariant: LogicVariant,
): LayoutResetPlan {
  assertLogicVariantSwitchable(currentLayoutMode);

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
