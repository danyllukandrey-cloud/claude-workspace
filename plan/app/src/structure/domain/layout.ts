// Доменна логіка "Структури" -- вільне полотно розкладки (D-131-наступне
// рішення, Андрій у чаті, 2026-09-15). Чиста функція, без I/O (plan/app/
// CLAUDE.md, "domain -> НІЧОГО"): лише ЩО має статись (план), не ЯК він
// потрапляє в базу -- транзакційний запис лишається за app/apply-layout-mode.ts
// і app/move-card.ts.
//
// Вимоги (Андрій, чат, кілька повідомлень підряд):
// 1. "Схема не працює і вона жахлива. Пропоную прибрати повністю оті
//    клітинки." -- cellIndex/фіксована сітка/AC-02 (колізія клітинки)
//    прибрані повністю. Позиція картки -- {x, y}, відсотки (0-100) канви;
//    перекриття карток дозволене, нічого не блокує вільне позиціювання.
// 2. Купка нерозкладених ("трей") лишається -- {x: null, y: null}.
// 3. Кожен з 5 режимів (balance/focus/cause_effect/free/staging) дає СВІЙ
//    початковий авто-розклад (координати x/y + за потреби зв'язки) замість
//    старого "скинути все в трей і чекати ручного перетягування"
//    (switchLayoutMode/resetToBaseOrder -- обидва прибрані повністю).
//
// ПІДТВЕРДЖЕНА логіка кожного режиму (макет із реальних карток Андрія,
// підтверджено "все вірно" в чаті) -- без реального AI-аналізу "що
// статичне/головне" беремо розумний детермінований дефолт: порядок за
// createdAt (перша створена картка -- "ядро"/"корінь"/"центр").

export type LayoutMode = 'balance' | 'focus' | 'cause_effect' | 'free' | 'staging' | null;

/** Відсоток канви, 0..100. Клемпиться -- невалідне значення ніколи не долітає до БД як є. */
const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return MIN_PERCENT;
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface LayoutPosition {
  cardId: string;
  // NULL = "картка без позиції": лежить у купці нерозкладених унизу екрана
  // (вимога 2, той самий принцип "NULL = ще не обрано", що вже діяв для
  // cellIndex до цього переписування). x/null і y/null завжди разом --
  // немає стану "лише одна координата відома".
  x: number | null;
  y: number | null;
}

export interface DefaultPosition {
  x: number | null;
  y: number | null;
}

// Вільне позиціювання прибрало "наступну вільну клітинку" як поняття --
// нова картка завжди з'являється в купці нерозкладених, користувач сам
// перетягує її на канву (чи перезапускає авто-розклад режиму через
// "Конфігурація", який розставляє ВСІХ карток власника, і цю нову зокрема).
export function defaultPositionForNewCard(): DefaultPosition {
  return { x: null, y: null };
}

export type LayoutPositionStatus = 'active' | 'closed';

export interface LayoutPositionRow {
  cardId: string;
  x: number | null;
  y: number | null;
  status: LayoutPositionStatus;
}

// AC-08 / ADR-0002: дві мітки часу, що конфліктують після офлайн-
// синхронізації, вирішуються last-write-wins за positionUpdatedAt --
// пізніший запис перемагає, ранішній тихо відкидається, без злиття.
export interface TimestampedPosition {
  cardId: string;
  x: number | null;
  y: number | null;
  positionUpdatedAt: string;
}

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

// --- Авто-розклад режиму (вимога 6 в чаті) ----------------------------------
//
// "Кожен з варіантів конфігурації потрібно просто розташувати за логікою і
// все без якихось законів з клітинками." Вхід -- усі картки власника
// (розкладені й з купки, app/apply-layout-mode.ts читає їх усі), лише
// {cardId, createdAt} потрібно для детермінованого порядку. Вихід -- нові
// позиції для КОЖНОЇ переданої картки + (лише для деяких режимів) зв'язки
// між ними. `staging` -- єдиний виняток: повертає порожній план (нічого не
// міняти), сенс режиму саме в тому, що користувач розкладає сам.

export interface LayoutCardInput {
  cardId: string;
  /** ISO 8601 -- лише для сортування (перша створена = "ядро"/"корінь"/"центр"). */
  createdAt: string;
}

export interface AutoLayoutPosition {
  cardId: string;
  x: number;
  y: number;
}

export interface AutoLayoutConnection {
  cardIdA: string;
  cardIdB: string;
  /** true -- стрілка cardIdA -> cardIdB; false -- звичайна лінія (порядок не несе сенсу). */
  directed: boolean;
}

export interface AutoLayoutPlan {
  positions: AutoLayoutPosition[];
  connections: AutoLayoutConnection[];
}

/** Стабільне сортування за createdAt (тай-брейк -- cardId, щоб порядок був відтворюваним). */
function sortByCreatedAt(cards: LayoutCardInput[]): LayoutCardInput[] {
  return [...cards].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
  });
}

/** Рівномірний розподіл `count` елементів по вертикалі канви (10%..90%), один елемент -- по центру. */
function evenlySpacedY(index: number, count: number): number {
  if (count <= 1) return 50;
  return round2(10 + (index * 80) / (count - 1));
}

const DEG2RAD = Math.PI / 180;

function emptyPlan(): AutoLayoutPlan {
  return { positions: [], connections: [] };
}

// balance ("Баланс навколо ядра"): зліва вертикально -- статичні/рутинні
// картки; по центру -- ядро (перша за created_at); праворуч -- решта,
// розгалужена від ядра лініями. Без реального AI-аналізу "що статичне" --
// решта (після ядра) ділиться навпіл за created_at: перша половина -- ліва
// колонка (без зв'язків, "статичні"), друга половина -- праве розгалуження
// (кожна з'єднана лінією до ядра).
function computeBalanceLayout(cards: LayoutCardInput[]): AutoLayoutPlan {
  const sorted = sortByCreatedAt(cards);
  if (sorted.length === 0) return emptyPlan();

  const [core, ...rest] = sorted;
  const positions: AutoLayoutPosition[] = [{ cardId: core.cardId, x: 50, y: 50 }];
  const connections: AutoLayoutConnection[] = [];

  const half = Math.ceil(rest.length / 2);
  const left = rest.slice(0, half);
  const right = rest.slice(half);

  left.forEach((card, index) => {
    positions.push({ cardId: card.cardId, x: 15, y: evenlySpacedY(index, left.length) });
  });

  right.forEach((card, index) => {
    const x = round2(70 + (index % 2) * 15);
    positions.push({ cardId: card.cardId, x, y: evenlySpacedY(index, right.length) });
    connections.push({ cardIdA: core.cardId, cardIdB: card.cardId, directed: false });
  });

  return { positions, connections };
}

// focus ("Фокус і спостереження"): одна картка в центрі (перша за
// created_at), решта -- рівновіддалені по колу навколо неї, кожна з'єднана
// лінією до центру. Коло -- однаковий радіус по X і Y (на відміну від free,
// яка явно еліпс), центр -- середина канви.
function computeFocusLayout(cards: LayoutCardInput[]): AutoLayoutPlan {
  const sorted = sortByCreatedAt(cards);
  if (sorted.length === 0) return emptyPlan();

  const [center, ...rest] = sorted;
  const positions: AutoLayoutPosition[] = [{ cardId: center.cardId, x: 50, y: 50 }];
  const connections: AutoLayoutConnection[] = [];

  const radius = 35;
  rest.forEach((card, index) => {
    const angle = (-90 + (index * 360) / rest.length) * DEG2RAD;
    const x = clampPercent(round2(50 + radius * Math.cos(angle)));
    const y = clampPercent(round2(50 + radius * Math.sin(angle)));
    positions.push({ cardId: card.cardId, x, y });
    connections.push({ cardIdA: center.cardId, cardIdB: card.cardId, directed: false });
  });

  return { positions, connections };
}

// cause_effect ("Причина і наслідок"): дерево ЗЛІВА НАПРАВО -- корінь
// (перша за created_at) зліва, кожен вузол розгалужується на 2 (бінарне
// дерево за порядком created_at, індекс i має дітей 2i+1/2i+2 -- той самий
// підхід, що бінарна купа). Зв'язки МІЖ УСІМА рівнями -- СТРІЛКИ
// (directed: true), єдиний режим, де авто-розклад сам створює напрямлені
// зв'язки (Андрій, чат: "якщо ми робимо стрілки, то нам потрібно буде
// додати їх як інструментарій можливого з'єднання").
function computeCauseEffectLayout(cards: LayoutCardInput[]): AutoLayoutPlan {
  const sorted = sortByCreatedAt(cards);
  const n = sorted.length;
  if (n === 0) return emptyPlan();

  const levelOf = (index: number): number => Math.floor(Math.log2(index + 1));
  const maxLevel = levelOf(n - 1);

  const levelCounts: number[] = new Array(maxLevel + 1).fill(0);
  for (let i = 0; i < n; i += 1) levelCounts[levelOf(i)] += 1;

  const seenAtLevel: number[] = new Array(maxLevel + 1).fill(0);
  const positions: AutoLayoutPosition[] = [];
  const connections: AutoLayoutConnection[] = [];

  for (let i = 0; i < n; i += 1) {
    const level = levelOf(i);
    const x = maxLevel === 0 ? 10 : round2(10 + (level * 80) / maxLevel);
    const y = evenlySpacedY(seenAtLevel[level], levelCounts[level]);
    seenAtLevel[level] += 1;

    positions.push({ cardId: sorted[i].cardId, x, y });

    if (i > 0) {
      const parentIndex = Math.floor((i - 1) / 2);
      connections.push({ cardIdA: sorted[parentIndex].cardId, cardIdB: sorted[i].cardId, directed: true });
    }
  }

  return { positions, connections };
}

// free ("Вільна розкладка"): картки розкидані рівномірно ЕЛІПСОМ (не
// сіткою, не хаотично) -- рівний кут (360/N градусів) на картку, радіус по X
// ширший за радіус по Y (еліпс, не коло -- на відміну від focus). БЕЗ
// жодних зв'язків.
function computeFreeLayout(cards: LayoutCardInput[]): AutoLayoutPlan {
  const sorted = sortByCreatedAt(cards);
  const n = sorted.length;
  if (n === 0) return emptyPlan();
  if (n === 1) return { positions: [{ cardId: sorted[0].cardId, x: 50, y: 50 }], connections: [] };

  const radiusX = 38;
  const radiusY = 28;
  const positions = sorted.map((card, index) => {
    const angle = ((index * 360) / n) * DEG2RAD;
    const x = clampPercent(round2(50 + radiusX * Math.cos(angle)));
    const y = clampPercent(round2(50 + radiusY * Math.sin(angle)));
    return { cardId: card.cardId, x, y };
  });

  return { positions, connections: [] };
}

// staging ("Готово до розкладання"): авто-розклад НІЧОГО не робить -- усі
// картки лишаються де є (нерозкладені -- в купці знизу), користувач сам
// перетягує на канву. Той самий сенс, що й раніше.
function computeStagingLayout(_cards: LayoutCardInput[]): AutoLayoutPlan {
  return emptyPlan();
}

/**
 * Диспетчер за режимом (app/apply-layout-mode.ts викликає цю єдину точку
 * входу, не окремі функції режимів напряму). `null` (режим ще не обрано)
 * трактується як `staging` -- жодної формули для "немає режиму" не існує,
 * найбезпечніший дефолт -- нічого не чіпати.
 */
export function computeAutoLayout(mode: LayoutMode, cards: LayoutCardInput[]): AutoLayoutPlan {
  switch (mode) {
    case 'balance':
      return computeBalanceLayout(cards);
    case 'focus':
      return computeFocusLayout(cards);
    case 'cause_effect':
      return computeCauseEffectLayout(cards);
    case 'free':
      return computeFreeLayout(cards);
    case 'staging':
    case null:
      return computeStagingLayout(cards);
    default:
      return computeStagingLayout(cards);
  }
}
