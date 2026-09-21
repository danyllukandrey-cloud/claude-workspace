import { describe, it, expect } from 'vitest';
import {
  PLAN_HORIZONS,
  PlanItemValidationError,
  createPlanItem,
  isPlanHorizon,
  setDone,
  toggleDone,
} from './plan-item';
import type { PlanItem } from './plan-item';

// T2 -- доменні інваріанти пункту плану (spec.md AC-01/AC-02/AC-03/AC-03b).
// Чисті функції, без I/O: жодного звернення до БД чи годинника -- createdAt
// приходить ззовні (plan/app/CLAUDE.md, "domain -> НІЧОГО").

const CREATED_AT = '2026-09-20T10:00:00.000Z';

function build(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'plan-item-1',
    ownerUserId: 'user-1',
    horizon: 'tactical',
    planText: 'Записатись до лікаря',
    done: false,
    status: 'active',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('createPlanItem — AC-01/AC-02 (текст обовʼязковий лише при створенні)', () => {
  it('creates an unchecked active plan-item stamped with the date it was added', () => {
    const item = createPlanItem({
      id: 'plan-item-1',
      ownerUserId: 'user-1',
      horizon: 'operational',
      planText: '  Записатись до лікаря  ',
      createdAt: CREATED_AT,
    });

    expect(item).toEqual({
      id: 'plan-item-1',
      ownerUserId: 'user-1',
      horizon: 'operational',
      planText: 'Записатись до лікаря',
      done: false,
      status: 'active',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('rejects an empty text', () => {
    expect(() =>
      createPlanItem({
        id: 'plan-item-1',
        ownerUserId: 'user-1',
        horizon: 'tactical',
        planText: '',
        createdAt: CREATED_AT,
      }),
    ).toThrow(PlanItemValidationError);
  });

  it('rejects a whitespace-only text with a machine-readable code', () => {
    try {
      createPlanItem({
        id: 'plan-item-1',
        ownerUserId: 'user-1',
        horizon: 'tactical',
        planText: '   \t\n  ',
        createdAt: CREATED_AT,
      });
      expect.unreachable('whitespace-only text must not produce a plan-item');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanItemValidationError);
      expect((error as PlanItemValidationError).code).toBe('plan_item.text_required');
    }
  });

  it('rejects a horizon outside the three fixed values', () => {
    expect(() =>
      createPlanItem({
        id: 'plan-item-1',
        ownerUserId: 'user-1',
        // Значення з межі системи (HTTP body) -- тип сам по собі рантайм не гарантує.
        horizon: 'someday' as never,
        planText: 'Записатись до лікаря',
        createdAt: CREATED_AT,
      }),
    ).toThrow(PlanItemValidationError);
  });
});

describe('isPlanHorizon — AC-01 (три фіксовані горизонти)', () => {
  it('accepts exactly tactical/operational/strategic and nothing else', () => {
    expect(PLAN_HORIZONS).toEqual(['tactical', 'operational', 'strategic']);
    for (const horizon of PLAN_HORIZONS) {
      expect(isPlanHorizon(horizon)).toBe(true);
    }
    for (const value of ['', 'Tactical', 'someday', 'weekly', null, undefined, 1, {}]) {
      expect(isPlanHorizon(value)).toBe(false);
    }
  });
});

describe('toggleDone / setDone — AC-03/AC-03b (чекбокс реверсивний)', () => {
  it('marks a not-done plan-item done without removing it from its horizon', () => {
    const item = build({ done: false });

    const marked = toggleDone(item, '2026-09-21T08:00:00.000Z');

    expect(marked.done).toBe(true);
    expect(marked.status).toBe('active');
    expect(marked.horizon).toBe(item.horizon);
    expect(marked.updatedAt).toBe('2026-09-21T08:00:00.000Z');
    // Чиста функція: вихідний пункт не мутується.
    expect(item.done).toBe(false);
  });

  it('returns a done plan-item back to not-done — toggle is reversible, not one-way', () => {
    const item = build({ done: true });

    const back = toggleDone(item, '2026-09-21T09:00:00.000Z');

    expect(back.done).toBe(false);
    expect(back.status).toBe('active');
    expect(toggleDone(back, '2026-09-21T10:00:00.000Z').done).toBe(true);
  });

  it('sets an explicit done value idempotently (same state clicked twice stays that state)', () => {
    const item = build({ done: false });

    const done = setDone(item, true, '2026-09-21T08:00:00.000Z');
    const stillDone = setDone(done, true, '2026-09-21T08:30:00.000Z');

    expect(done.done).toBe(true);
    expect(stillDone.done).toBe(true);
    expect(setDone(stillDone, false, '2026-09-21T09:00:00.000Z').done).toBe(false);
  });
});
