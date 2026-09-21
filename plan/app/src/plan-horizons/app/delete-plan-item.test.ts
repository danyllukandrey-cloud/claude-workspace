// T6 -- unit-тест use-case "м'яко видалити пункт" (AC-04/AC-05).
// Той самий стиль, що ./update-plan-item.test.ts і
// cards/life-area-card/app/archive-card.test.ts: db підробляється через vi.fn().
//
// Окрім звичайного мока є ще й `fakeStore` -- крихітна підробка сховища, що
// тримає стан одного рядка й розуміє рівно два запити цієї фічі (м'яке
// видалення й читання активних). Вона потрібна для головного твердження
// AC-04: після виклику пункт зникає саме з РЕЗУЛЬТАТУ читання, а не просто
// "у SQL було слово removed". Перевірка тексту запиту довела б лише текст.

import { describe, it, expect, vi } from 'vitest';
import { deletePlanItem } from './delete-plan-item';
import { listActivePlanItems } from '../infra/postgres-repo';
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

/**
 * Підробка сховища зі станом: розуміє SELECT активних пунктів і UPDATE
 * м'якого видалення. Усе інше -- явна помилка, щоб тест не "мовчки проходив"
 * на запиті, якого він не очікував.
 */
function fakeStore(initial = [row()]) {
  const rows = initial.map((r) => ({ ...r }));
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/^SELECT/i.test(text.trim())) {
      const [ownerUserId] = params as string[];
      return { rows: rows.filter((r) => r.owner_user_id === ownerUserId && r.status === 'active') };
    }
    if (/UPDATE plan_item/.test(text) && /status = 'removed'/.test(text)) {
      const [updatedAt, id, ownerUserId] = params as string[];
      const hit = rows.find((r) => r.id === id && r.owner_user_id === ownerUserId && r.status === 'active');
      if (!hit) return { rows: [] };
      hit.status = 'removed';
      hit.updated_at = new Date(updatedAt);
      return { rows: [{ id: hit.id }] };
    }
    throw new Error(`fakeStore: неочікуваний запит -- ${text}`);
  });
  return { db: { query } as unknown as Db, query, rows };
}

describe('deletePlanItem use-case', () => {
  // AC-04, головне твердження: після виклику пункт відсутній серед активних.
  it('removes the plan-item from subsequent list reads', async () => {
    const { db } = fakeStore();

    await expect(listActivePlanItems(db, 'user-1')).resolves.toHaveLength(1);

    await deletePlanItem(db, 'user-1', 'plan-item-1');

    await expect(listActivePlanItems(db, 'user-1')).resolves.toEqual([]);
  });

  // AC-04: рядок технічно лишається в базі -- жодного DELETE FROM, лише
  // перехід status -> 'removed'. Це прямо про те, що "видалення" тут м'яке.
  it('never issues a physical delete and leaves the row in place as removed', async () => {
    const { db, query, rows } = fakeStore();

    await deletePlanItem(db, 'user-1', 'plan-item-1');

    const statements = query.mock.calls.map((call) => call[0] as string);
    expect(statements.some((sql) => /DELETE\s+FROM/i.test(sql))).toBe(false);
    expect(statements.some((sql) => /UPDATE plan_item/.test(sql))).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'plan-item-1', status: 'removed', plan_text: 'Пробігти півмарафон' });
  });

  // Мітка updated_at народжується тут (як у create/update) -- домен власного
  // годинника не має.
  it('stamps updated-at itself', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'plan-item-1' }] });
    const db: Db = { query };

    const before = new Date().toISOString();
    await deletePlanItem(db, 'user-1', 'plan-item-1');
    const after = new Date().toISOString();

    const params = query.mock.calls[0][1] as string[];
    const updatedAt = params[0];
    expect(updatedAt >= before && updatedAt <= after).toBe(true);
    expect(params).toEqual(expect.arrayContaining(['plan-item-1', 'user-1']));
  });

  // Non-disclosure (AC-07, успадковане): чужий, неіснуючий і вже прибраний
  // пункт -- однакова відповідь plan_item.not_found / 404, як в update.
  it('maps a missing, foreign or already-removed plan-item to plan_item.not_found 404', async () => {
    const { db } = fakeStore();

    await expect(deletePlanItem(db, 'user-2', 'plan-item-1')).rejects.toMatchObject({
      code: 'plan_item.not_found',
      httpStatus: 404,
    });
    await expect(deletePlanItem(db, 'user-1', 'plan-item-404')).rejects.toMatchObject({
      code: 'plan_item.not_found',
      httpStatus: 404,
    });

    await deletePlanItem(db, 'user-1', 'plan-item-1');
    await expect(deletePlanItem(db, 'user-1', 'plan-item-1')).rejects.toMatchObject({
      code: 'plan_item.not_found',
    });
  });

  // AC-05: прибирання пункту -- теж зміна, отже теж слід у Лозі дій.
  it('records a human-readable action after a successful removal', async () => {
    const { db } = fakeStore();
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await deletePlanItem(db, 'user-1', 'plan-item-1', recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(db, {
      ownerUserId: 'user-1',
      action: expect.stringMatching(/пункт плану/i),
    });
  });

  // Пункт не прибрано -- писати в Лог дій нічого.
  it('never records an action when the plan-item is not found', async () => {
    const { db } = fakeStore();
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await expect(deletePlanItem(db, 'user-2', 'plan-item-1', recordAction)).rejects.toMatchObject({
      code: 'plan_item.not_found',
    });
    expect(recordAction).not.toHaveBeenCalled();
  });

  // Колаборатор не переданий -- поведінка та сама, рівно один запит, без падіння.
  it('removes the plan-item unchanged when no recordAction is provided', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'plan-item-1' }] });
    const db: Db = { query };

    await expect(deletePlanItem(db, 'user-1', 'plan-item-1')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
