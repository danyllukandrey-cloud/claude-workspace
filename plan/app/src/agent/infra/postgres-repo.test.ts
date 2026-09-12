// T13 -- Infra: Postgres repo (proposal, rules, memory, chat, audit).
// RED (unit level, mocked Db): AC-01/AC-02 (agent_proposal), AC-07/AC-08/AC-12/AC-14
// (imperative_rule), AC-09 (long_term_memory_fact), AC-15 (chat_message), plus
// agent_audit_event (DoD: all 5 tables read/write, scoped to user_id).
//
// Real DB round-trip is out of scope for this task's files_hint (postgres-repo.ts
// only) and unavailable in this sandbox (no live Postgres/.env) -- this suite
// documents the intended real-DB behaviour against a mocked Db, the same
// convention already used in ../../structure/infra/postgres-repo.test.ts and
// ../../cards/life-area-card/infra/postgres-repo.test.ts: a fake `Db.query`
// (vi.fn), asserted by SQL text and params.
//
// DoD focus repeated in every read: "a mismatched user_id is never returned" --
// each read is scoped by user_id in the WHERE clause, and the fake DB
// reproduces a real mismatch by resolving zero rows.

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './postgres-repo';
import {
  insertProposal,
  findActiveProposalByUser,
  updateProposal,
  insertRule,
  listRulesByScope,
  listEffectiveRulesForCard,
  insertFact,
  findActiveFactsByTopic,
  updateFact,
  softDeleteFact,
  insertChatMessage,
  listMessagesForSession,
  hasAnyChatMessage,
  countRecentUserMessages,
  findAllMessagesByUser,
  insertAuditEvent,
  listAuditEventsByUser,
} from './postgres-repo';

function rawProposalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proposal-1',
    user_id: 'user-1',
    card_id: 'card-1',
    metric_block_id: 'metric-1',
    status: 'active',
    source_type: 'text',
    raw_input: 'пробіг 5 км',
    proposed_amount: '5',
    proposed_summary: '5 км бігу',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function rawRuleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    scope_card_id: null,
    category: 'owner_impact',
    rule_text: 'не радь, якщо не питаю',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function rawFactRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fact-1',
    user_id: 'user-1',
    fact_text: 'проходить фізичну терапію по вівторках',
    topic: 'здоров-я',
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function rawChatMessageRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'message-1',
    user_id: 'user-1',
    role: 'user',
    content: 'пробіг 5 км',
    session_date: '2026-01-01',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function rawAuditEventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'audit-1',
    user_id: 'user-1',
    event_type: 'proposal_confirmed',
    subject_type: 'proposal',
    subject_id: 'proposal-1',
    detail: null,
    occurred_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// --- agent_proposal (AC-01/AC-02) -----------------------------------------

describe('insertProposal -- AC-01 happy path', () => {
  it('writes a new active proposal and returns the camelCase, numeric-converted record', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawProposalRow()] });
    const db: Db = { query };

    const created = await insertProposal(db, {
      id: 'proposal-1',
      userId: 'user-1',
      cardId: 'card-1',
      metricBlockId: 'metric-1',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedAmount: 5,
      proposedSummary: '5 км бігу',
    });

    expect(created).toEqual({
      id: 'proposal-1',
      userId: 'user-1',
      cardId: 'card-1',
      metricBlockId: 'metric-1',
      status: 'active',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedAmount: 5,
      proposedSummary: '5 км бігу',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO agent_proposal/);
    expect(sql).toMatch(/user_id/);
    expect(params).toContain('user-1');
  });
});

describe('findActiveProposalByUser -- AC-02 (read the pending proposal before confirming)', () => {
  it('scopes the SELECT by user_id and status = active', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawProposalRow()] });
    const db: Db = { query };

    const found = await findActiveProposalByUser(db, 'user-1');

    expect(found?.status).toBe('active');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(sql).toMatch(/status = 'active'/);
    expect(params).toEqual(['user-1']);
  });

  it('a mismatched user_id is never returned -- same outcome as "no active proposal"', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(findActiveProposalByUser(db, 'someone-elses-user-id')).resolves.toBeNull();
  });
});

describe('updateProposal -- AC-02 confirm, scoped by user_id (DoD non-disclosure)', () => {
  it('moves an active proposal to confirmed for its own owner', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawProposalRow({ status: 'confirmed' })] });
    const db: Db = { query };

    const updated = await updateProposal(db, 'user-1', 'proposal-1', { status: 'confirmed' });

    expect(updated?.status).toBe('confirmed');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE agent_proposal/);
    expect(sql).toMatch(/user_id/);
    expect(params).toContain('user-1');
    expect(params).toContain('proposal-1');
  });

  it('a mismatched user_id never moves nor discloses another user\'s proposal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      updateProposal(db, 'attacker-user-id', 'proposal-1', { status: 'confirmed' })
    ).resolves.toBeNull();
  });
});

// --- imperative_rule (AC-07/AC-08/AC-12/AC-14) -----------------------------

describe('insertRule -- AC-08 category rule / AC-14 free-text rule', () => {
  it('writes a global rule (scopeCardId undefined -> NULL) and returns the camelCase record', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawRuleRow()] });
    const db: Db = { query };

    const created = await insertRule(db, {
      id: 'rule-1',
      userId: 'user-1',
      category: 'owner_impact',
      ruleText: 'не радь, якщо не питаю',
    });

    expect(created.scopeCardId).toBeNull();
    expect(created.ruleText).toBe('не радь, якщо не питаю');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO imperative_rule/);
    expect(params).toContain('user-1');
  });

  it('writes a card-scoped override (AC-12)', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawRuleRow({ scope_card_id: 'card-1', category: null, rule_text: 'тут інакше' })],
    });
    const db: Db = { query };

    const created = await insertRule(db, {
      id: 'rule-2',
      userId: 'user-1',
      scopeCardId: 'card-1',
      ruleText: 'тут інакше',
    });

    expect(created.scopeCardId).toBe('card-1');
    const [, params] = query.mock.calls[0];
    expect(params).toContain('card-1');
  });
});

describe('listRulesByScope -- AC-14 same-scope conflict check', () => {
  it('an exact scope match (global vs global) queries scope_card_id IS NOT DISTINCT FROM the given value', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawRuleRow()] });
    const db: Db = { query };

    const rules = await listRulesByScope(db, 'user-1', null);

    expect(rules).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/scope_card_id IS NOT DISTINCT FROM/);
    expect(params).toEqual(['user-1', null]);
  });

  it('a card-scoped conflict check never mixes in another card\'s override rules', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawRuleRow({ scope_card_id: 'card-1' })],
    });
    const db: Db = { query };

    const rules = await listRulesByScope(db, 'user-1', 'card-1');

    expect(rules[0].scopeCardId).toBe('card-1');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['user-1', 'card-1']);
  });

  it('a mismatched user_id is never returned', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(listRulesByScope(db, 'someone-elses-user-id', null)).resolves.toEqual([]);
  });
});

describe('listEffectiveRulesForCard -- AC-07/AC-12 guard reads global + card-override before a reply', () => {
  it('reads global rules plus this card\'s override -- card override wins by being present alongside global', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawRuleRow(), rawRuleRow({ id: 'rule-2', scope_card_id: 'card-1', rule_text: 'тут інакше' })],
    });
    const db: Db = { query };

    const rules = await listEffectiveRulesForCard(db, 'user-1', 'card-1');

    expect(rules).toHaveLength(2);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/scope_card_id IS NULL/);
    expect(sql).toMatch(/scope_card_id = \$2/);
    expect(params).toEqual(['user-1', 'card-1']);
  });

  it('no card in context (cardId null) reads only global rules', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawRuleRow()] });
    const db: Db = { query };

    const rules = await listEffectiveRulesForCard(db, 'user-1', null);

    expect(rules).toHaveLength(1);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['user-1', null]);
  });
});

// --- long_term_memory_fact (AC-09) -----------------------------------------

describe('insertFact + findActiveFactsByTopic -- AC-09 read-your-own-writes by topic', () => {
  it('a newly inserted fact is scoped to user_id and returned on the next topic-scoped read', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawFactRow()] });
    const dbForInsert: Db = { query: insertQuery };

    const created = await insertFact(dbForInsert, {
      id: 'fact-1',
      userId: 'user-1',
      factText: 'проходить фізичну терапію по вівторках',
      topic: 'здоров-я',
    });
    expect(created.status).toBe('active');

    const readQuery = vi.fn().mockResolvedValue({ rows: [rawFactRow()] });
    const dbForRead: Db = { query: readQuery };

    const facts = await findActiveFactsByTopic(dbForRead, 'user-1', 'здоров-я');
    expect(facts).toHaveLength(1);
    expect(facts[0].factText).toBe('проходить фізичну терапію по вівторках');

    const [sql, params] = readQuery.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(sql).toMatch(/status = 'active'/);
    expect(params).toEqual(['user-1', 'здоров-я']);
  });

  it('a mismatched user_id is never returned -- topic alone never leaks another user\'s fact', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(findActiveFactsByTopic(db, 'someone-elses-user-id', 'здоров-я')).resolves.toEqual([]);
  });
});

// Review 2026-09-12 (AC-09 write path): updateFact/softDeleteFact -- the two
// functions AC-09's "edit/forget" half needed and never had.
describe('updateFact + softDeleteFact -- AC-09 edit/forget a long-term fact', () => {
  it('updates fact_text/topic scoped to id + user_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawFactRow({ fact_text: 'оновлений текст' })] });
    const db: Db = { query };

    const updated = await updateFact(db, 'user-1', 'fact-1', { factText: 'оновлений текст' });

    expect(updated?.factText).toBe('оновлений текст');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE long_term_memory_fact/);
    expect(sql).toMatch(/user_id/);
    expect(params).toEqual(['оновлений текст', 'fact-1', 'user-1']);
  });

  it('a mismatched user_id updates nothing -- non-disclosure', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(updateFact(db, 'someone-elses-user-id', 'fact-1', { factText: 'x' })).resolves.toBeNull();
  });

  it('softDeleteFact sets status=deleted, never a physical DELETE ("забудь, що...")', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawFactRow({ status: 'deleted' })] });
    const db: Db = { query };

    const deleted = await softDeleteFact(db, 'user-1', 'fact-1');

    expect(deleted?.status).toBe('deleted');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE long_term_memory_fact SET status = 'deleted'/);
    expect(sql).not.toMatch(/DELETE FROM/);
    expect(params).toEqual(['fact-1', 'user-1']);
  });
});

// --- chat_message (AC-15) --------------------------------------------------

describe('insertChatMessage + listMessagesForSession -- AC-15 same-session short-term window', () => {
  it('a message written for a session_date is returned by a read scoped to the same user + day', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawChatMessageRow()] });
    const dbForInsert: Db = { query: insertQuery };

    const created = await insertChatMessage(dbForInsert, {
      id: 'message-1',
      userId: 'user-1',
      role: 'user',
      content: 'пробіг 5 км',
      sessionDate: '2026-01-01',
    });
    expect(created.role).toBe('user');

    const listQuery = vi.fn().mockResolvedValue({ rows: [rawChatMessageRow()] });
    const dbForList: Db = { query: listQuery };

    const messages = await listMessagesForSession(dbForList, 'user-1', '2026-01-01');
    expect(messages).toHaveLength(1);

    const [sql, params] = listQuery.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(sql).toMatch(/session_date/);
    expect(params).toEqual(['user-1', '2026-01-01']);
  });

  it('a mismatched user_id is never returned, even for the same session_date', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(listMessagesForSession(db, 'someone-elses-user-id', '2026-01-01')).resolves.toEqual([]);
  });
});

// T24 -- hasAnyChatMessage: чи для user_id уже є хоч ОДИН chat_message,
// незалежно від session_date -- відрізняється від listMessagesForSession
// вище (та scopeована одним календарним днем, AC-15), тут перевірка "чи
// це взагалі перший виклик користувача" (AC-13, onboarding-handler.ts).
describe('hasAnyChatMessage -- AC-13 first-call detection, any session_date', () => {
  it('returns true when at least one chat_message row exists for the user', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ exists: true }] });
    const db: Db = { query };

    await expect(hasAnyChatMessage(db, 'user-1')).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/chat_message/);
    expect(sql).toMatch(/user_id/);
    expect(params).toEqual(['user-1']);
  });

  it('returns false -- and never confuses another user\'s messages with this one\'s -- when none exist', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(hasAnyChatMessage(db, 'brand-new-user')).resolves.toBe(false);
  });
});

// Review 2026-09-12: ports-шар (chat-handler.ts) не пише SQL сам (ADR-0005) --
// countRecentUserMessages/findAllMessagesByUser виносять два запити, які
// раніше жили інлайн у ports-хендлері, сюди.
describe('countRecentUserMessages -- §8 SAD 60/hour rate limit, role=user only', () => {
  it('counts only role=user rows within the given window, scoped by user_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '3' }] });
    const db: Db = { query };

    const count = await countRecentUserMessages(db, 'user-1', '2026-01-01T00:00:00.000Z');

    expect(count).toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(sql).toMatch(/role = 'user'/);
    expect(params).toEqual(['user-1', '2026-01-01T00:00:00.000Z']);
  });

  it('a mismatched user_id never inflates another user\'s count', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '0' }] });
    const db: Db = { query };

    await expect(countRecentUserMessages(db, 'someone-elses-user-id', '2026-01-01T00:00:00.000Z')).resolves.toBe(0);
  });
});

describe('findAllMessagesByUser -- GET /messages full history, scoped to user_id', () => {
  it('returns the user\'s messages in chronological order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawChatMessageRow()] });
    const db: Db = { query };

    const messages = await findAllMessagesByUser(db, 'user-1');

    expect(messages).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(sql).toMatch(/ORDER BY created_at/);
    expect(params).toEqual(['user-1']);
  });

  it('a mismatched user_id never returns another user\'s history', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(findAllMessagesByUser(db, 'someone-elses-user-id')).resolves.toEqual([]);
  });
});

// --- agent_audit_event -----------------------------------------------------

describe('insertAuditEvent + listAuditEventsByUser -- append-only audit trail, scoped by user_id', () => {
  it('a written event is returned by a subsequent user-scoped read', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawAuditEventRow()] });
    const dbForInsert: Db = { query: insertQuery };

    const created = await insertAuditEvent(dbForInsert, {
      id: 'audit-1',
      userId: 'user-1',
      eventType: 'proposal_confirmed',
      subjectType: 'proposal',
      subjectId: 'proposal-1',
    });
    expect(created.eventType).toBe('proposal_confirmed');

    const listQuery = vi.fn().mockResolvedValue({ rows: [rawAuditEventRow()] });
    const dbForList: Db = { query: listQuery };

    const events = await listAuditEventsByUser(dbForList, 'user-1');
    expect(events).toHaveLength(1);

    const [sql, params] = listQuery.mock.calls[0];
    expect(sql).toMatch(/user_id/);
    expect(params).toEqual(['user-1']);
  });

  it('a mismatched user_id is never returned', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(listAuditEventsByUser(db, 'someone-elses-user-id')).resolves.toEqual([]);
  });
});
