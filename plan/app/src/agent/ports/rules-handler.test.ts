// Unit-тест (без мережі) для T22 -- ports-хендлери GET/POST /rules
// (docs/features/agent/contracts/openapi.yaml). Той самий підхід, що
// cards/life-area-card/ports/entry-handlers.test.ts -- підробляємо `db` через
// vi.fn(), що повертає канонічні рядки-об'єкти (як реальний pg.Pool.query).
//
// DoD (tasks.json T22): "Handlers return 200/201/409/422 exactly per contract
// (agent.rule_conflict, agent.rule_empty)".

import { describe, it, expect, vi } from 'vitest';
import { listRules, createRule } from './rules-handler';
import type { Db } from '../infra/postgres-repo';

function ruleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    scope_card_id: null,
    category: 'reminder',
    rule_text: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('listRules handler (AC-08 "відкрив налаштування правил")', () => {
  it('returns a contract-shaped RulePage for the global scope (no scopeCardId)', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [ruleRow()] }); // listRulesByScope
    const db: Db = { query };

    const result = await listRules(db, 'user-1', {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'rule-1', scopeCardId: null, category: 'reminder', ruleText: null });
    expect(typeof result.items[0].createdAt).toBe('string');
    expect(result.has_next).toBe(false);
    expect(result.has_prev).toBe(false);
    // Exact-scope match, not merged with global (AC-12/AC-14 scope isolation).
    expect(query.mock.calls[0][1]).toEqual(['user-1', null]);
  });

  it('filters to a card-override scope when scopeCardId is passed', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [ruleRow({ id: 'rule-2', scope_card_id: 'card-1' })] });
    const db: Db = { query };

    const result = await listRules(db, 'user-1', { scopeCardId: 'card-1' });

    expect(result.items[0].scopeCardId).toBe('card-1');
    expect(query.mock.calls[0][1]).toEqual(['user-1', 'card-1']);
  });
});

describe('createRule handler (AC-07/AC-08/AC-12/AC-14)', () => {
  // AC-08 happy path -- категорія з готового меню, без конфлікту.
  it('returns 201-shaped Rule for a category-menu rule with no conflict', async () => {
    const insertedRow = ruleRow({ id: 'rule-new', category: 'data' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // listRulesByScope -- жодного наявного правила цієї області
      .mockResolvedValueOnce({ rows: [insertedRow] }); // insertRule
    const db: Db = { query };

    const result = await createRule(db, 'user-1', { category: 'data', ruleText: null, scopeCardId: null });

    expect(result.id).toBe('rule-new');
    expect(result.category).toBe('data');
    expect(typeof result.createdAt).toBe('string');
  });

  // AC-14 happy path -- власний текст, картка-scope, без конфлікту.
  it('returns 201-shaped Rule for a free-text card-override rule with no conflict', async () => {
    const insertedRow = ruleRow({ id: 'rule-new-2', scope_card_id: 'card-1', category: null, rule_text: 'не радь, якщо не питаю' });
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [insertedRow] });
    const db: Db = { query };

    const result = await createRule(db, 'user-1', { ruleText: 'не радь, якщо не питаю', scopeCardId: 'card-1' });

    expect(result.scopeCardId).toBe('card-1');
    expect(result.ruleText).toBe('не радь, якщо не питаю');
  });

  // AC-14 -- перевірка на несуперечливість (409 agent.rule_conflict), скоуп-ізольована.
  it('throws AppError agent.rule_conflict (409) when a same-scope rule already has this category', async () => {
    const existing = ruleRow({ id: 'rule-existing', category: 'reminder' });
    const query = vi.fn().mockResolvedValueOnce({ rows: [existing] }); // listRulesByScope
    const db: Db = { query };

    await expect(createRule(db, 'user-1', { category: 'reminder', scopeCardId: null })).rejects.toMatchObject({
      code: 'agent.rule_conflict',
      httpStatus: 409,
    });
  });

  // AC-12/AC-14 -- перевизначення картки НЕ звіряється з глобальними правилами
  // тієї самої категорії (scope isolation) -- тут глобальне 'reminder' існує,
  // але кандидат -- card-override, тож жодного конфлікту.
  it('does not conflict with a global rule of the same category when the candidate is a card override (AC-12 scope isolation)', async () => {
    const insertedRow = ruleRow({ id: 'rule-new-3', scope_card_id: 'card-1', category: 'reminder' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // listRulesByScope(userId, 'card-1') -- порожньо, глобальні сюди не потрапляють
      .mockResolvedValueOnce({ rows: [insertedRow] });
    const db: Db = { query };

    const result = await createRule(db, 'user-1', { category: 'reminder', scopeCardId: 'card-1' });

    expect(result.scopeCardId).toBe('card-1');
    expect(query.mock.calls[0][1]).toEqual(['user-1', 'card-1']);
  });

  // 422 agent.rule_empty -- ні category, ні ruleText не задано (data-model.md CHECK).
  it('throws AppError agent.rule_empty (422) when neither category nor ruleText is given', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(createRule(db, 'user-1', {})).rejects.toMatchObject({
      code: 'agent.rule_empty',
      httpStatus: 422,
    });
    expect(query).not.toHaveBeenCalled();
  });
});
