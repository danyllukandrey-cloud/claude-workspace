import { describe, it, expect } from 'vitest';
import {
  defaultPositionForNewCard,
  resolvePositionConflict,
  closeLayoutPosition,
  computeAutoLayout,
  clampPercent,
} from './layout';
import type { LayoutPositionRow, TimestampedPosition, LayoutCardInput } from './layout';

// Переписано повністю (D-131-наступне рішення, Андрій у чаті, 2026-09-15):
// "Пропоную прибрати повністю оті клітинки." cellIndex/сітка/AC-02
// (колізія клітинки)/switchLayoutMode (reset-у-трей) прибрані — позиція
// картки тепер {x, y} відсотки канви (0-100), а зміна режиму розкладки
// рахує РЕАЛЬНИЙ авто-розклад (computeAutoLayout), не скидає все в трей.

describe('clampPercent — відсоток канви завжди в межах 0..100', () => {
  it('leaves an in-range value untouched', () => {
    expect(clampPercent(42.5)).toBe(42.5);
  });

  it('clamps a value below 0 up to 0', () => {
    expect(clampPercent(-15)).toBe(0);
  });

  it('clamps a value above 100 down to 100', () => {
    expect(clampPercent(140)).toBe(100);
  });

  it('treats NaN as 0 rather than propagating it', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('defaultPositionForNewCard — нова картка завжди в купці нерозкладених', () => {
  it('always returns {x: null, y: null} — no more "next free cell"', () => {
    expect(defaultPositionForNewCard()).toEqual({ x: null, y: null });
  });
});

describe('resolvePositionConflict — AC-08 / ADR-0002 (last-write-wins за positionUpdatedAt)', () => {
  it('keeps the position with the later positionUpdatedAt timestamp when two devices moved the same card', () => {
    const earlier: TimestampedPosition = {
      cardId: 'card-a',
      x: 20,
      y: 30,
      positionUpdatedAt: '2026-09-11T09:00:00.000Z',
    };
    const later: TimestampedPosition = {
      cardId: 'card-a',
      x: 60,
      y: 70,
      positionUpdatedAt: '2026-09-11T09:05:00.000Z',
    };

    expect(resolvePositionConflict(earlier, later)).toEqual(later);
    // Порядок аргументів не має значення -- перемагає пізніша мітка часу,
    // а не той, хто прийшов першим/другим у виклику.
    expect(resolvePositionConflict(later, earlier)).toEqual(later);
  });
});

describe('closeLayoutPosition — AC-12 (закриття позначає статус, не видаляє рядок)', () => {
  it('marks an active position as closed without deleting the row', () => {
    const active: LayoutPositionRow = {
      cardId: 'card-a',
      x: 42,
      y: 17,
      status: 'active',
    };

    const closed = closeLayoutPosition(active);

    expect(closed.status).toBe('closed');
    expect(closed.cardId).toBe('card-a');
    expect(closed.x).toBe(42);
    expect(closed.y).toBe(17);
  });
});

// --- computeAutoLayout — вимога 6 (чат): кожен режим дає СВІЙ авто-розклад ---

function card(cardId: string, createdAt: string): LayoutCardInput {
  return { cardId, createdAt };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('computeAutoLayout — спільне для всіх режимів', () => {
  it('returns an empty plan for zero cards, no matter the mode', () => {
    for (const mode of ['balance', 'focus', 'cause_effect', 'free', 'staging', null] as const) {
      expect(computeAutoLayout(mode, [])).toEqual({ positions: [], connections: [] });
    }
  });

  it('every produced position lands inside the 0..100 canvas', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04')];
    for (const mode of ['balance', 'focus', 'cause_effect', 'free'] as const) {
      const plan = computeAutoLayout(mode, cards);
      for (const position of plan.positions) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThanOrEqual(100);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('computeAutoLayout("staging") — нічого не робить (вимога 6)', () => {
  it('returns an empty plan even with several cards — the point of this mode is "leave it to the user"', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03')];
    expect(computeAutoLayout('staging', cards)).toEqual({ positions: [], connections: [] });
  });
});

describe('computeAutoLayout(null) — режим ще не обрано, трактується як "нічого не робити"', () => {
  it('returns an empty plan — no formula exists for "no mode chosen"', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02')];
    expect(computeAutoLayout(null, cards)).toEqual({ positions: [], connections: [] });
  });
});

describe('computeAutoLayout("balance") — ядро в центрі, ліва колонка без зв\'язків, праве розгалуження зі зв\'язками до ядра', () => {
  it('places the earliest-created card as the core, dead centre', () => {
    const cards = [card('core', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03')];
    const plan = computeAutoLayout('balance', cards);

    const core = plan.positions.find((p) => p.cardId === 'core');
    expect(core).toEqual({ cardId: 'core', x: 50, y: 50 });
  });

  it('a single card is just the core, no connections', () => {
    const plan = computeAutoLayout('balance', [card('only', '2026-01-01')]);
    expect(plan.positions).toEqual([{ cardId: 'only', x: 50, y: 50 }]);
    expect(plan.connections).toEqual([]);
  });

  it('splits the remaining cards into a left column (no connections) and a right branch (connected to the core)', () => {
    // core + 4 rest -> half = 2 left, 2 right (rest sorted by createdAt, first half left).
    const cards = [
      card('core', '2026-01-01'),
      card('left-1', '2026-01-02'),
      card('left-2', '2026-01-03'),
      card('right-1', '2026-01-04'),
      card('right-2', '2026-01-05'),
    ];
    const plan = computeAutoLayout('balance', cards);

    const byId = new Map(plan.positions.map((p) => [p.cardId, p]));
    // Ліва колонка -- крайня зліва (x менший за ядро).
    expect(byId.get('left-1')!.x).toBeLessThan(50);
    expect(byId.get('left-2')!.x).toBeLessThan(50);
    // Праве розгалуження -- правіше за ядро.
    expect(byId.get('right-1')!.x).toBeGreaterThan(50);
    expect(byId.get('right-2')!.x).toBeGreaterThan(50);

    // Лише праві картки мають зв'язок до ядра -- ліві жодного.
    expect(plan.connections).toHaveLength(2);
    for (const connection of plan.connections) {
      expect(connection.cardIdA).toBe('core');
      expect(['right-1', 'right-2']).toContain(connection.cardIdB);
      expect(connection.directed).toBe(false);
    }
  });
});

describe('computeAutoLayout("focus") — одна картка в центрі, решта рівновіддалені по колу', () => {
  it('places the earliest-created card in the centre', () => {
    const cards = [card('center', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04')];
    const plan = computeAutoLayout('focus', cards);

    expect(plan.positions.find((p) => p.cardId === 'center')).toEqual({ cardId: 'center', x: 50, y: 50 });
  });

  it('every surrounding card sits at (approximately) the same distance from the centre — a circle', () => {
    const cards = [card('center', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04')];
    const plan = computeAutoLayout('focus', cards);
    const center = plan.positions.find((p) => p.cardId === 'center')!;
    const distances = plan.positions.filter((p) => p.cardId !== 'center').map((p) => distance(center, p));

    for (const d of distances) {
      expect(d).toBeCloseTo(distances[0], 0);
    }
  });

  it('connects every surrounding card to the centre with an undirected line', () => {
    const cards = [card('center', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03')];
    const plan = computeAutoLayout('focus', cards);

    expect(plan.connections).toHaveLength(2);
    for (const connection of plan.connections) {
      expect(connection.cardIdA).toBe('center');
      expect(connection.directed).toBe(false);
    }
  });
});

describe('computeAutoLayout("cause_effect") — дерево зліва направо, стрілки між усіма рівнями', () => {
  it('places the root at the leftmost x and every other card strictly to its right', () => {
    const cards = [
      card('root', '2026-01-01'),
      card('c2', '2026-01-02'),
      card('c3', '2026-01-03'),
      card('c4', '2026-01-04'),
      card('c5', '2026-01-05'),
    ];
    const plan = computeAutoLayout('cause_effect', cards);
    const root = plan.positions.find((p) => p.cardId === 'root')!;

    for (const position of plan.positions) {
      if (position.cardId === 'root') continue;
      expect(position.x).toBeGreaterThan(root.x);
    }
  });

  it('every connection is a directed arrow, one per non-root card (a tree has n-1 edges)', () => {
    const cards = [
      card('root', '2026-01-01'),
      card('c2', '2026-01-02'),
      card('c3', '2026-01-03'),
      card('c4', '2026-01-04'),
      card('c5', '2026-01-05'),
      card('c6', '2026-01-06'),
      card('c7', '2026-01-07'),
    ];
    const plan = computeAutoLayout('cause_effect', cards);

    expect(plan.connections).toHaveLength(cards.length - 1);
    for (const connection of plan.connections) {
      expect(connection.directed).toBe(true);
    }

    // Корінь розгалужується рівно на 2 (бінарне дерево за порядком created_at).
    const fromRoot = plan.connections.filter((c) => c.cardIdA === 'root');
    expect(fromRoot).toHaveLength(2);
    expect(fromRoot.map((c) => c.cardIdB).sort()).toEqual(['c2', 'c3']);
  });

  it('a single card is just the root, no connections', () => {
    const plan = computeAutoLayout('cause_effect', [card('only', '2026-01-01')]);
    expect(plan.connections).toEqual([]);
    expect(plan.positions).toEqual([{ cardId: 'only', x: 10, y: 50 }]);
  });
});

describe('computeAutoLayout("free") — розкидані рівномірно еліпсом, без зв\'язків', () => {
  it('produces no connections at all', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04')];
    expect(computeAutoLayout('free', cards).connections).toEqual([]);
  });

  it('spreads x further than y from the centre — an ellipse, not a circle', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04')];
    const plan = computeAutoLayout('free', cards);

    const xs = plan.positions.map((p) => p.x);
    const ys = plan.positions.map((p) => p.y);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);

    expect(xSpread).toBeGreaterThan(ySpread);
  });

  it('a single card lands dead centre', () => {
    expect(computeAutoLayout('free', [card('only', '2026-01-01')])).toEqual({
      positions: [{ cardId: 'only', x: 50, y: 50 }],
      connections: [],
    });
  });

  it('places every card at a distinct position for a handful of cards', () => {
    const cards = [card('c1', '2026-01-01'), card('c2', '2026-01-02'), card('c3', '2026-01-03'), card('c4', '2026-01-04'), card('c5', '2026-01-05')];
    const plan = computeAutoLayout('free', cards);
    const unique = new Set(plan.positions.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(cards.length);
  });
});
