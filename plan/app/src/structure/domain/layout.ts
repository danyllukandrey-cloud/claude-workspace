// Доменна логіка "Структури" -- розкладка карток (AC-09, AC-11, AC-11b).
// Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"): лише ЩО
// має статись (план), не ЯК він потрапляє в базу -- транзакційний запис
// лишається за T11 (App: updateStructure use-case).
//
// Вимоги 14/15 (Андрій, чат) -- ПЛОСКА модель, 5 значень в ОДНОМУ полі замість
// дворівневої комбінації layoutMode('logic') + logicVariant(X):
// - 'single' ("одна картка") скасований повністю -- навіщо режим "одна
//   картка", якщо картку й так можна створити рівно одну;
// - три підвиди "за логікою" (D-83) перестають бути вкладеними в 'logic' і
//   стають топ-рівневими режимами: 'balance' / 'focus' / 'cause_effect';
// - 'free' лишається тим самим режимом ("Вільна розкладка", перейменування
//   підпису, не поведінки);
// - 'staging' -- НОВИЙ режим ("Готово до розкладання"): картки з'являються
//   внизу екрана без клітинки, користувач сам розкладає (defaultPositionForNewCard
//   нижче навмисно НЕ дає нову клітинку автоматично, поки цей режим активний).
export type LayoutMode = 'balance' | 'focus' | 'cause_effect' | 'free' | 'staging' | null;

export class LayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutValidationError';
  }
}

export interface LayoutPosition {
  cardId: string;
  // NULL = "картка без клітинки": лежить у треї нерозкладених унизу екрана
  // (AC-11b після reset, AC-17 для відновленої з архіву картки).
  // Рев'ю 2026-09-11: міграція 06 зробила `cell_index` nullable, тож домен
  // мусить ЧИТАТИ цей стан, а не лише віддавати його в плані скидання --
  // інакше друге підряд перемикання режиму рахує NULL як нуль.
  cellIndex: number | null;
}

export interface DefaultPosition {
  // null -- 'staging' навмисно не дає клітинку одразу (див. defaultPositionForNewCard нижче).
  cellIndex: number | null;
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
//
// Виняток -- 'staging' ("Готово до розкладання", вимога 15): сенс цього
// режиму саме в тому, що картки з'являються внизу екрана БЕЗ клітинки, а
// користувач розкладає їх сам. Автоматичне присвоєння клітинки тут суперечило
// б самій ідеї режиму, тож нова картка йде просто в трей (той самий стан, що
// й після reset AC-11b), а не отримує номер.
export function defaultPositionForNewCard(
  existing: LayoutPosition[],
  layoutMode: LayoutMode,
): DefaultPosition {
  if (layoutMode === 'staging') {
    return { cellIndex: null };
  }

  // Картки без клітинки (трей) не зсувають наступну вільну клітинку: вони не
  // займають жодної, тому в підрахунку максимуму їх просто немає.
  const nextCellIndex = existing.reduce(
    (max, position) => (position.cellIndex === null ? max : Math.max(max, position.cellIndex + 1)),
    0,
  );

  return { cellIndex: nextCellIndex };
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
// розкладає картки по новому режиму сам. Плоска модель (вимоги 14/15) прибрала
// колишню окрему AC-16b (зміна підвиду ВСЕРЕДИНІ 'logic') -- перемикання між
// будь-якими двома з 5 режимів, зокрема між 'balance' і 'focus' (колишні
// підвиди одного 'logic'), тепер завжди йде саме цим шляхом, без окремої
// "підвид-у-підвиді" перевірки.
export function switchLayoutMode(
  positions: LayoutPosition[],
  _newMode: LayoutMode,
): LayoutResetPlan {
  return resetToBaseOrder(positions);
}

// AC-02 (D-62 -- одна клітинка = одна картка): у розкладках із фіксованою
// сіткою кожна активна клітинка тримає рівно одну картку. Перетягування на
// вже зайняту чужою карткою клітинку блокується, а не тихо переписує сусіда;
// картка, що вже тримає цю клітинку сама, не вважається колізією (переміщення
// "на себе" -- no-op, не помилка).
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
