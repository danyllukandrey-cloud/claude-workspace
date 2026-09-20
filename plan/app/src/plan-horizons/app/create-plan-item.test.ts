// T4 -- unit-тест use-case "створити пункт плану" (AC-01/AC-02/AC-05).
// Той самий стиль, що cards/life-area-card/app/create-card.test.ts: db
// підробляється через vi.fn(), що повертає канонічний рядок бази (як реальний
// pg.Pool.query). Інтеграція проти справжньої Neon -- справа T3/T8, не цього шару.

import { describe, it, expect, vi } from 'vitest';
import { createPlanItem } from './create-plan-item';
import { PlanItemValidationError } from '../domain/plan-item';
import type { Db } from '../infra/postgres-repo';

const PLAN_ITEM_ROW = {
  id: 'plan-item-1',
  owner_user_id: 'user-1',
  horizon: 'tactical',
  plan_text: 'Пробігти півмарафон',
  done: false,
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

describe('createPlanItem use-case', () => {
  // AC-01: валідний текст -> рядок у plan_item, невідмічений, з датою додавання.
  it('creates an active, not-done plan-item in the given horizon', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [PLAN_ITEM_ROW] });
    const db: Db = { query };

    const item = await createPlanItem(db, 'user-1', {
      horizon: 'tactical',
      planText: 'Пробігти півмарафон',
    });

    expect(item).toMatchObject({
      ownerUserId: 'user-1',
      horizon: 'tactical',
      planText: 'Пробігти півмарафон',
      done: false,
      status: 'active',
    });
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO plan_item/);

    // owner_user_id пише САМЕ use-case зі свого параметра -- клієнт не може
    // підсунути чужого власника в тілі запиту (AC-07 вбудовано в цей шар).
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['user-1', 'tactical']));
  });

  // AC-01: id і createdAt народжуються тут, а не приходять ззовні -- викликач
  // (ports) оперує лише горизонтом і текстом, як у контракті POST /plan-items.
  it('generates the id and the created-at stamp itself', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [PLAN_ITEM_ROW] });
    const db: Db = { query };

    const before = new Date().toISOString();
    await createPlanItem(db, 'user-1', { horizon: 'strategic', planText: 'Написати книгу' });
    const after = new Date().toISOString();

    const params = query.mock.calls[0][1] as unknown[];
    const [id, , , , , , createdAt, updatedAt] = params as string[];

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdAt >= before && createdAt <= after).toBe(true);
    // Свіжий пункт ще не змінювався -- обидві мітки той самий момент.
    expect(updatedAt).toBe(createdAt);
  });

  // AC-01: текст зберігається без зайвих пробілів по краях (trim домену).
  it('stores the text trimmed', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [PLAN_ITEM_ROW] });
    const db: Db = { query };

    await createPlanItem(db, 'user-1', { horizon: 'operational', planText: '  Знайти тренера  ' });

    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['Знайти тренера']));
  });

  // AC-02: порожній текст відхиляється ДО будь-якого звернення до бази.
  it('rejects an empty text before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      createPlanItem(db, 'user-1', { horizon: 'tactical', planText: '' })
    ).rejects.toBeInstanceOf(PlanItemValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only text before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      createPlanItem(db, 'user-1', { horizon: 'tactical', planText: '   ' })
    ).rejects.toMatchObject({ code: 'plan_item.text_required' });
    expect(query).not.toHaveBeenCalled();
  });

  // Горизонт приходить з межі системи (HTTP body) -- рантайм-перевірка домену
  // теж має спрацювати до бази.
  it('rejects an unknown horizon before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      createPlanItem(db, 'user-1', { horizon: 'someday' as never, planText: 'Текст' })
    ).rejects.toMatchObject({ code: 'plan_item.horizon_invalid' });
    expect(query).not.toHaveBeenCalled();
  });

  // AC-05: факт зміни лишає слід у Лозі дій -- людською мовою, з ПРАВИЛЬНИМ
  // ownerUserId і тим самим db (та сама транзакція, яку відкриває composition root).
  it('records a human-readable action for the owner when recordAction is provided', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [PLAN_ITEM_ROW] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await createPlanItem(db, 'user-1', { horizon: 'tactical', planText: 'Пробігти півмарафон' }, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(db, {
      ownerUserId: 'user-1',
      action: expect.stringContaining('Пробігти півмарафон'),
    });
  });

  // AC-02 + AC-05: текст не пройшов валідацію -- пункту немає, отже й писати
  // в Лог дій нічого.
  it('never records an action when the text is rejected', async () => {
    const query = vi.fn();
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await expect(
      createPlanItem(db, 'user-1', { horizon: 'tactical', planText: ' ' }, recordAction)
    ).rejects.toBeInstanceOf(PlanItemValidationError);
    expect(query).not.toHaveBeenCalled();
    expect(recordAction).not.toHaveBeenCalled();
  });

  // Колаборатор не переданий (наявні тести/викликачі, поки composition root не
  // задротує Лог дій) -- поведінка та сама, рівно один запит, без падіння.
  it('creates the plan-item unchanged when no recordAction is provided', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [PLAN_ITEM_ROW] });
    const db: Db = { query };

    await expect(
      createPlanItem(db, 'user-1', { horizon: 'tactical', planText: 'Пробігти півмарафон' })
    ).resolves.toMatchObject({ id: 'plan-item-1', status: 'active' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
