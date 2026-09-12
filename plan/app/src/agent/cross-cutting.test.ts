// T30 -- Tests: cross-cutting integration (cross-user isolation + Claude-
// unavailable), AC-06.
//
// RED (unit level, stateful in-memory fake `Db` -- Docker/Neon unavailable in
// this sandbox, same fallback already established by structure/app/
// cross-cutting.test.ts, T25): a fake `Db.query` routed by SQL text, MUTABLE
// state shared within each scenario, since cross-user isolation needs a
// second user's write to exist before proving the first user's read never
// sees it.
//
// This file exists because T13 (postgres-repo), T18 (ask-agent) each already
// have their own unit tests scoped to ONE user / ONE Claude call -- nothing
// yet proves the cross-cutting guarantee AC-06 actually names: TWO users'
// data never crosses, and a Claude outage fails closed without corrupting or
// losing anything already in flight.

import { describe, it, expect } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  insertProposal,
  findActiveProposalByUser,
  insertRule,
  listRulesByScope,
  insertFact,
  findActiveFactsByTopic,
} from './infra/postgres-repo';
import type { Db } from './infra/postgres-repo';
import { askAgent } from './app/ask-agent';
import type { AskClaude } from './infra/claude-client';
import { AppError } from '../shared/errors';

const USER_A = 'user-a';
const USER_B = 'user-b';

/**
 * Один спільний, мутабельний фейковий Db -- обслуговує agent_proposal/
 * imperative_rule/long_term_memory_fact, той самий підхід (SQL-текст-як-
 * маршрутизатор), що structure/infra/postgres-repo.test.ts і сусідні файли
 * цього ж модуля (postgres-repo.test.ts).
 */
function fakeDb(): Db {
  const proposals: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];
  const facts: Record<string, unknown>[] = [];
  let counter = 0;

  const query = async <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> => {
    counter += 1;
    const now = new Date('2026-09-12T00:00:00.000Z');

    if (text.startsWith('INSERT INTO agent_proposal')) {
      const row = {
        id: params[0], user_id: params[1], card_id: params[2] ?? null, metric_block_id: params[3] ?? null,
        status: 'active', source_type: params[4], raw_input: params[5], proposed_amount: params[6] ?? null,
        proposed_summary: params[7], created_at: now, updated_at: now,
      };
      proposals.push(row);
      return { rows: [row] as unknown as T[] };
    }
    if (text.includes('FROM agent_proposal WHERE user_id')) {
      const [userId] = params as [string];
      const found = proposals.filter((r) => r.user_id === userId && r.status === 'active');
      return { rows: found as unknown as T[] };
    }

    if (text.startsWith('INSERT INTO imperative_rule')) {
      const row = {
        id: params[0], user_id: params[1], scope_card_id: params[2] ?? null,
        category: params[3] ?? null, rule_text: params[4] ?? null, created_at: now, updated_at: now,
      };
      rules.push(row);
      return { rows: [row] as unknown as T[] };
    }
    if (text.includes('FROM imperative_rule WHERE user_id')) {
      const [userId, scopeCardId] = params as [string, string | null];
      const found = rules.filter((r) => r.user_id === userId && r.scope_card_id === scopeCardId);
      return { rows: found as unknown as T[] };
    }

    if (text.startsWith('INSERT INTO long_term_memory_fact')) {
      const row = {
        id: params[0], user_id: params[1], fact_text: params[2], topic: params[3] ?? null,
        status: 'active', created_at: now, updated_at: now,
      };
      facts.push(row);
      return { rows: [row] as unknown as T[] };
    }
    if (text.includes('FROM long_term_memory_fact WHERE user_id')) {
      const [userId, topic] = params as [string, string];
      const found = facts.filter((r) => r.user_id === userId && r.topic === topic && r.status === 'active');
      return { rows: found as unknown as T[] };
    }

    throw new Error(`Непередбачений запит у T30 cross-cutting fake Db (виклик #${counter}): ${text}`);
  };

  return { query };
}

describe('AC-06 -- cross-user isolation (agent_proposal/imperative_rule/long_term_memory_fact)', () => {
  it("user A's active proposal is never returned by user B's read, and vice versa", async () => {
    const db = fakeDb();

    await insertProposal(db, {
      id: 'proposal-a', userId: USER_A, sourceType: 'text', rawInput: 'пробіг 5 км', proposedSummary: 'Спорт: 5 км',
    });
    await insertProposal(db, {
      id: 'proposal-b', userId: USER_B, sourceType: 'text', rawInput: 'прочитав 20 стор', proposedSummary: 'Читання: 20 стор',
    });

    const forA = await findActiveProposalByUser(db, USER_A);
    const forB = await findActiveProposalByUser(db, USER_B);

    expect(forA?.id).toBe('proposal-a');
    expect(forB?.id).toBe('proposal-b');
    expect(forA?.proposedSummary).not.toBe(forB?.proposedSummary);
  });

  it("user A's global imperative rule is never returned by user B's read of the same (global) scope", async () => {
    const db = fakeDb();

    await insertRule(db, { id: 'rule-a', userId: USER_A, category: 'reminder' });
    await insertRule(db, { id: 'rule-b', userId: USER_B, ruleText: 'не радь, якщо не питаю' });

    const forA = await listRulesByScope(db, USER_A, null);
    const forB = await listRulesByScope(db, USER_B, null);

    expect(forA.map((r) => r.id)).toEqual(['rule-a']);
    expect(forB.map((r) => r.id)).toEqual(['rule-b']);
  });

  it("user A's long-term memory fact is never returned by user B's topic search, even for the identical topic string", async () => {
    const db = fakeDb();

    await insertFact(db, { id: 'fact-a', userId: USER_A, factText: 'алергія на горіхи', topic: 'здоровʼя' });
    await insertFact(db, { id: 'fact-b', userId: USER_B, factText: 'бігає щоранку', topic: 'здоровʼя' });

    const forA = await findActiveFactsByTopic(db, USER_A, 'здоровʼя');
    const forB = await findActiveFactsByTopic(db, USER_B, 'здоровʼя');

    expect(forA.map((f) => f.id)).toEqual(['fact-a']);
    expect(forB.map((f) => f.id)).toEqual(['fact-b']);
  });
});

describe('sad.md §6 Flow 2 -- a stubbed Claude outage fails closed without losing the typed message', () => {
  it('askAgent throws AppError agent.llm_unavailable/503 on a Claude network failure, and the original input is untouched', async () => {
    const unavailable: AskClaude = async () => ({ ok: false, error: { code: 'claude.unavailable', message: 'мережева помилка' } });

    const input = { text: 'пробіг 5 км', activeRules: [] };
    const inputSnapshot = { ...input };

    await expect(askAgent(unavailable, input)).rejects.toMatchObject({ code: 'agent.llm_unavailable', httpStatus: 503 });
    await expect(askAgent(unavailable, input)).rejects.toBeInstanceOf(AppError);

    // "текст не втрачено" (sad.md §6 Flow 2) -- на цьому шарі означає: askAgent
    // нічого не мутує й не "споживає" з вхідних даних при відмові, той самий
    // виклик з тим самим текстом лишається придатним для повторної спроби
    // (retry з боку клієнта/composer, sad.md), а не одноразовим об'єктом.
    expect(input).toEqual(inputSnapshot);
  });

  it('an unexpected/malformed Claude response is ALSO mapped to agent.llm_unavailable/503, not a generic 500', async () => {
    const malformed: AskClaude = async () => ({ ok: false, error: { code: 'claude.unexpected_response', message: 'неочікувана форма відповіді' } });

    await expect(askAgent(malformed, { text: 'пробіг 5 км', activeRules: [] })).rejects.toMatchObject({
      code: 'agent.llm_unavailable',
      httpStatus: 503,
    });
  });

  it('a recovered Claude call after a prior failure succeeds normally -- the earlier failure left no lingering state', async () => {
    let callCount = 0;
    const flaky: AskClaude = async () => {
      callCount += 1;
      if (callCount === 1) return { ok: false, error: { code: 'claude.unavailable', message: 'тимчасово' } };
      return { ok: true, value: 'записати в картку "Спорт", 5 км?' };
    };

    await expect(askAgent(flaky, { text: 'пробіг 5 км', activeRules: [] })).rejects.toMatchObject({ code: 'agent.llm_unavailable' });

    const result = await askAgent(flaky, { text: 'пробіг 5 км', activeRules: [] });
    expect(result.reply).toBe('записати в картку "Спорт", 5 км?');
  });
});
