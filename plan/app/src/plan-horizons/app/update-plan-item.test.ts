// T5 -- unit-тест use-case "оновити текст і/чи чекбокс" (AC-03/AC-03b/AC-05).
// Той самий стиль, що ./create-plan-item.test.ts і
// cards/life-area-card/app/update-card.test.ts: db підробляється через vi.fn(),
// що повертає канонічний рядок бази (як реальний pg.Pool.query).

import { describe, it, expect, vi } from 'vitest';
import { updatePlanItem } from './update-plan-item';
import { PlanItemValidationError } from '../domain/plan-item';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-item-1',
    owner_user_id: 'user-1',
    horizon: 'tactical',
    plan_text: 'Пробігти півмарафон',
    done: false,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('updatePlanItem use-case', () => {
  // AC-03: чекбокс ставиться -- пункт лишається активним і у своєму горизонті.
  it('marks a plan-item done and keeps it active in the same horizon', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: true })] });
    const db: Db = { query };

    const item = await updatePlanItem(db, 'user-1', 'plan-item-1', { done: true });

    expect(item).toMatchObject({ id: 'plan-item-1', done: true, status: 'active', horizon: 'tactical' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/UPDATE plan_item/);
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([true, 'plan-item-1', 'user-1']));
  });

  // AC-03b: той самий виклик знімає позначку назад -- тумблер реверсивний,
  // а не односторонній перехід (на відміну від картки, що доходить до "filled").
  it('returns a done plan-item back to not-done', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: false })] });
    const db: Db = { query };

    const item = await updatePlanItem(db, 'user-1', 'plan-item-1', { done: false });

    expect(item.done).toBe(false);
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([false]));
  });

  // AC-04 (happy-редагування): непорожній текст зберігається, обрізаний по краях.
  it('updates the text trimmed', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ plan_text: 'Новий текст' })] });
    const db: Db = { query };

    const item = await updatePlanItem(db, 'user-1', 'plan-item-1', { planText: '  Новий текст  ' });

    expect(item.planText).toBe('Новий текст');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['Новий текст']));
  });

  // Мітка updated_at народжується тут (як createdAt у create-plan-item.ts) --
  // домен власного годинника не має.
  it('stamps updated-at itself', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: true })] });
    const db: Db = { query };

    const before = new Date().toISOString();
    await updatePlanItem(db, 'user-1', 'plan-item-1', { done: true });
    const after = new Date().toISOString();

    const params = query.mock.calls[0][1] as string[];
    // updated_at -- передостанній перед id/ownerUserId (див. infra/postgres-repo.ts).
    const updatedAt = params[params.length - 3];
    expect(updatedAt >= before && updatedAt <= after).toBe(true);
  });

  // Порожній текст при РЕДАГУВАННІ -- помилка, а не видалення: прибирання
  // пункту йде окремим use-case (T6), і жодного UPDATE тут статись не має.
  it('rejects an empty text before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      updatePlanItem(db, 'user-1', 'plan-item-1', { planText: '' })
    ).rejects.toBeInstanceOf(PlanItemValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only text before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      updatePlanItem(db, 'user-1', 'plan-item-1', { planText: '   ' })
    ).rejects.toMatchObject({ code: 'plan_item.text_required' });
    expect(query).not.toHaveBeenCalled();
  });

  // Non-disclosure (AC-07): чужий і неіснуючий пункт виглядають однаково --
  // той самий plan_item.not_found / 404, без натяку, що саме сталось.
  it('maps a missing or foreign plan-item to plan_item.not_found 404', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      updatePlanItem(db, 'user-2', 'plan-item-1', { done: true })
    ).rejects.toMatchObject({ code: 'plan_item.not_found', httpStatus: 404 });
    await expect(
      updatePlanItem(db, 'user-2', 'plan-item-1', { done: true })
    ).rejects.toBeInstanceOf(AppError);
  });

  // AC-05: зміна чекбокса лишає слід у Лозі дій -- людською мовою.
  it('records a human-readable action when the checkbox is set', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: true })] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updatePlanItem(db, 'user-1', 'plan-item-1', { done: true }, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(db, {
      ownerUserId: 'user-1',
      action: expect.stringContaining('Пробігти півмарафон'),
    });
    expect(recordAction.mock.calls[0][1].action).toMatch(/виконан/i);
  });

  it('records a distinct action when the checkbox is cleared', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: false })] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updatePlanItem(db, 'user-1', 'plan-item-1', { done: false }, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    const setAction = 'Позначено виконаним пункт плану «Пробігти півмарафон»';
    expect(recordAction.mock.calls[0][1].action).not.toBe(setAction);
  });

  // AC-05: редагування тексту -- теж окремий слід у Лозі дій.
  it('records a human-readable action when the text changes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ plan_text: 'Новий текст' })] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updatePlanItem(db, 'user-1', 'plan-item-1', { planText: 'Новий текст' }, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction.mock.calls[0][1].action).toContain('Новий текст');
  });

  // Обидві правки в одному виклику -- два окремі рядки Логу дій: це дві різні
  // зміни, і користувач має бачити обидві (той самий підхід, що update-card.ts).
  it('records both changes when text and checkbox change together', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ plan_text: 'Новий текст', done: true })] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updatePlanItem(db, 'user-1', 'plan-item-1', { planText: 'Новий текст', done: true }, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
  });

  // Пункт не знайдено -- писати в Лог дій нічого.
  it('never records an action when the plan-item is not found', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await expect(
      updatePlanItem(db, 'user-1', 'plan-item-1', { done: true }, recordAction)
    ).rejects.toMatchObject({ code: 'plan_item.not_found' });
    expect(recordAction).not.toHaveBeenCalled();
  });

  // Колаборатор не переданий -- поведінка та сама, рівно один запит, без падіння.
  it('updates the plan-item unchanged when no recordAction is provided', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ done: true })] });
    const db: Db = { query };

    await expect(
      updatePlanItem(db, 'user-1', 'plan-item-1', { done: true })
    ).resolves.toMatchObject({ done: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  // Порожній патч -- нічого міняти, отже й до бази ходити нема за чим
  // (інакше репозиторій написав би лише updated_at і збрехав би Логу дій).
  it('rejects an empty patch before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      updatePlanItem(db, 'user-1', 'plan-item-1', {})
    ).rejects.toMatchObject({ code: 'plan_item.nothing_to_update' });
    expect(query).not.toHaveBeenCalled();
  });
});
