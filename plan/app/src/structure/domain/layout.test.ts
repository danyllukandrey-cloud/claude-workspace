import { describe, it, expect } from 'vitest';
import {
  defaultPositionForNewCard,
  assertLogicVariantAllowed,
  switchLayoutMode,
  switchLogicVariant,
  LayoutValidationError,
} from './layout';
import type { LayoutPosition } from './layout';

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
