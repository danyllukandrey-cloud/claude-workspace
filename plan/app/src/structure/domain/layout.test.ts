import { describe, it, expect } from 'vitest';
import {
  defaultPositionForNewCard,
  assertLogicVariantAllowed,
  assertLogicVariantSwitchable,
  switchLayoutMode,
  switchLogicVariant,
  assertCellAvailable,
  resolvePositionConflict,
  closeLayoutPosition,
  LayoutValidationError,
} from './layout';
import type { LayoutPosition, LayoutPositionRow, TimestampedPosition } from './layout';

// T4 -- лише "ядро": чисті доменні правила без I/O. Реальний запис у БД
// (транзакційний reset одразу з layoutMode/logicVariant у самому рядку
// structure) -- предмет T11 (App: updateStructure use-case), тут
// перевіряється лише ЩО має статись (план), не ЯК він потрапляє в базу.

describe('defaultPositionForNewCard — AC-09 (немає обраного режиму -- не блокує)', () => {
  it('places a new card using a default position even when layoutMode is not chosen yet (null)', () => {
    const existing: LayoutPosition[] = [];
    const position = defaultPositionForNewCard(existing, null);

    expect(typeof position.cellIndex).toBe('number');
  });

  it('picks the next free cell after already-placed cards, regardless of layoutMode', () => {
    const existing: LayoutPosition[] = [
      { cardId: 'card-1', cellIndex: 0 },
      { cardId: 'card-2', cellIndex: 1 },
    ];
    const position = defaultPositionForNewCard(existing, 'free');

    expect(position.cellIndex).toBe(2);
  });

  // Рев'ю 2026-09-11 (міграція 06): cellIndex = null -- картка в треї
  // нерозкладених (AC-11b/AC-16b/AC-17). Вона не займає жодної клітинки, тож
  // НЕ має зсувати номер наступної вільної.
  it('ignores cards with no cell at all (tray) when picking the next free cell', () => {
    const onlyTray: LayoutPosition[] = [
      { cardId: 'card-1', cellIndex: null },
      { cardId: 'card-2', cellIndex: null },
    ];
    expect(defaultPositionForNewCard(onlyTray, 'free').cellIndex).toBe(0);

    const mixed: LayoutPosition[] = [
      { cardId: 'card-1', cellIndex: null },
      { cardId: 'card-2', cellIndex: 3 },
    ];
    expect(defaultPositionForNewCard(mixed, 'logic').cellIndex).toBe(4);
  });
});

describe('assertLogicVariantAllowed — AC-16 (logicVariant валідний лише коли layoutMode = logic)', () => {
  it('accepts a valid subvariant when layoutMode is logic', () => {
    expect(() => assertLogicVariantAllowed('logic', 'balance')).not.toThrow();
    expect(() => assertLogicVariantAllowed('logic', 'focus')).not.toThrow();
    expect(() => assertLogicVariantAllowed('logic', 'cause_effect')).not.toThrow();
  });

  it('accepts logicVariant left null regardless of layoutMode (not chosen yet)', () => {
    expect(() => assertLogicVariantAllowed('logic', null)).not.toThrow();
    expect(() => assertLogicVariantAllowed('single', null)).not.toThrow();
    expect(() => assertLogicVariantAllowed(null, null)).not.toThrow();
  });

  it('rejects a logicVariant set while layoutMode is not logic', () => {
    expect(() => assertLogicVariantAllowed('single', 'balance')).toThrow(LayoutValidationError);
    expect(() => assertLogicVariantAllowed('free', 'focus')).toThrow(LayoutValidationError);
    expect(() => assertLogicVariantAllowed(null, 'cause_effect')).toThrow(LayoutValidationError);
  });

  it('rejects an out-of-enum logicVariant value even when layoutMode is logic', () => {
    expect(() => assertLogicVariantAllowed('logic', 'made_up' as never)).toThrow(LayoutValidationError);
  });
});

describe('switchLayoutMode — AC-11 / AC-11b (зміна режиму -- reset у базовий порядок)', () => {
  it('applies a first-time mode choice with no existing positions to reset (AC-11 happy path)', () => {
    const plan = switchLayoutMode([], 'single');
    expect(plan.positions).toEqual([]);
  });

  it('moves every already-placed card to a fixed base order, unassigning its cell (AC-11b)', () => {
    const existing: LayoutPosition[] = [
      { cardId: 'card-a', cellIndex: 5 },
      { cardId: 'card-b', cellIndex: 0 },
      { cardId: 'card-c', cellIndex: 2 },
    ];

    const plan = switchLayoutMode(existing, 'logic');

    // Базовий порядок фіксований (за попереднім cellIndex зростанням) --
    // не довільний порядок вставки в масив, і жодна картка не лишає собі
    // стару клітинку нового режиму -- користувач тягне кожну сам.
    expect(plan.positions).toEqual([
      { cardId: 'card-b', baseOrder: 0, cellIndex: null },
      { cardId: 'card-c', baseOrder: 1, cellIndex: null },
      { cardId: 'card-a', baseOrder: 2, cellIndex: null },
    ]);
  });

  // Рев'ю 2026-09-11: ДРУГЕ підряд перемикання режиму читає позиції, що вже
  // без клітинки (міграція 06 дозволила NULL). Такі картки вже в треї -- вони
  // мусять лишитись у КІНЦІ базового порядку, а не вклинитись перед
  // розкладеними (пряме a.cellIndex - b.cellIndex рахувало NULL як 0).
  it('puts cards that already have no cell at the END of the base order, never before placed ones', () => {
    const existing: LayoutPosition[] = [
      { cardId: 'tray-1', cellIndex: null },
      { cardId: 'placed-2', cellIndex: 2 },
      { cardId: 'tray-2', cellIndex: null },
      { cardId: 'placed-0', cellIndex: 0 },
    ];

    const plan = switchLayoutMode(existing, 'free');

    expect(plan.positions).toEqual([
      { cardId: 'placed-0', baseOrder: 0, cellIndex: null },
      { cardId: 'placed-2', baseOrder: 1, cellIndex: null },
      { cardId: 'tray-1', baseOrder: 2, cellIndex: null },
      { cardId: 'tray-2', baseOrder: 3, cellIndex: null },
    ]);
  });
});

describe('switchLogicVariant — AC-16b (зміна підвиду "за логікою" -- той самий reset-план)', () => {
  it('resets active positions to the same fixed-base-order shape as a layoutMode switch', () => {
    const existing: LayoutPosition[] = [
      { cardId: 'card-a', cellIndex: 3 },
      { cardId: 'card-b', cellIndex: 1 },
    ];

    const fromModeSwitch = switchLayoutMode(existing, 'logic');
    const fromVariantSwitch = switchLogicVariant('logic', existing, 'focus');

    // AC-16b: "the system treats the switch the same way as AC-11b" --
    // однаковий механізм має віддати однакову форму плану для тих самих
    // вхідних позицій.
    expect(fromVariantSwitch.positions).toEqual(fromModeSwitch.positions);
  });

  it('rejects switching logicVariant when the Structure is not currently in logic layout mode', () => {
    const existing: LayoutPosition[] = [{ cardId: 'card-a', cellIndex: 0 }];
    expect(() => switchLogicVariant('free', existing, 'balance')).toThrow(LayoutValidationError);
  });
});

// Рев'ю 2026-09-11 (похідний дефект AC-16): та сама перевірка окремо від
// побудови плану -- use-case мусить мати чим відмовити ДО будь-якого запису,
// і саме доменною помилкою (LayoutValidationError -> 422), а не невідомою
// серверу 500 із середини reset-циклу.
describe('assertLogicVariantSwitchable — AC-16b (підвид перемикають лише всередині режиму "за логікою")', () => {
  it('passes while the Structure is in logic mode', () => {
    expect(() => assertLogicVariantSwitchable('logic')).not.toThrow();
  });

  it('throws the typed domain error for every non-logic mode, including "ще не обрано" (null)', () => {
    expect(() => assertLogicVariantSwitchable('free')).toThrow(LayoutValidationError);
    expect(() => assertLogicVariantSwitchable('single')).toThrow(LayoutValidationError);
    expect(() => assertLogicVariantSwitchable(null)).toThrow(LayoutValidationError);
  });
});

// T5 -- AC-02: у "за логікою" (D-62 -- одна клітинка = одна картка) кожна
// активна клітинка тримає рівно одну картку; перетягування картки на вже
// зайняту клітинку блокується, а не переписує сусіда.
describe('assertCellAvailable — AC-02 (колізія активної клітинки блокується)', () => {
  it('rejects placing a card onto a cell already occupied by a different active card', () => {
    const activePositions: LayoutPosition[] = [
      { cardId: 'card-a', cellIndex: 4 },
      { cardId: 'card-b', cellIndex: 7 },
    ];

    expect(() => assertCellAvailable(activePositions, 4, 'card-c')).toThrow(LayoutValidationError);
  });

  it('allows a card to be placed on a free cell', () => {
    const activePositions: LayoutPosition[] = [{ cardId: 'card-a', cellIndex: 4 }];

    expect(() => assertCellAvailable(activePositions, 9, 'card-c')).not.toThrow();
  });

  it('does not treat a card moving onto its own already-held cell as a collision', () => {
    const activePositions: LayoutPosition[] = [{ cardId: 'card-a', cellIndex: 4 }];

    expect(() => assertCellAvailable(activePositions, 4, 'card-a')).not.toThrow();
  });
});

// T5 -- AC-08 (edge case, test-plan.md §Edge cases): дві мітки часу, що
// конфліктують після офлайн-синхронізації, вирішуються last-write-wins за
// positionUpdatedAt (ADR-0002) -- пізніший запис перемагає, ранішній тихо
// відкидається, без злиття.
describe('resolvePositionConflict — AC-08 / ADR-0002 (last-write-wins за positionUpdatedAt)', () => {
  it('keeps the position with the later positionUpdatedAt timestamp when two devices moved the same card', () => {
    const earlier: TimestampedPosition = {
      cardId: 'card-a',
      cellIndex: 2,
      positionUpdatedAt: '2026-09-11T09:00:00.000Z',
    };
    const later: TimestampedPosition = {
      cardId: 'card-a',
      cellIndex: 5,
      positionUpdatedAt: '2026-09-11T09:05:00.000Z',
    };

    expect(resolvePositionConflict(earlier, later)).toEqual(later);
    // Порядок аргументів не має значення -- перемагає пізніша мітка часу,
    // а не той, хто прийшов першим/другим у виклику.
    expect(resolvePositionConflict(later, earlier)).toEqual(later);
  });
});

// T5 -- AC-12: закриття напрямку позначає рядок статусом 'closed'
// (D-66 -- ніколи фізичне видалення), рядок і його card_id лишаються
// доступні для історії/переносу метрик.
describe('closeLayoutPosition — AC-12 (закриття позначає статус, не видаляє рядок)', () => {
  it('marks an active position as closed without deleting the row', () => {
    const active: LayoutPositionRow = {
      cardId: 'card-a',
      cellIndex: 3,
      status: 'active',
    };

    const closed = closeLayoutPosition(active);

    expect(closed.status).toBe('closed');
    expect(closed.cardId).toBe('card-a');
    expect(closed.cellIndex).toBe(3);
  });
});
