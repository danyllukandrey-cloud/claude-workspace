// T16 -- App: handle-message use-case (AC-01/AC-04/AC-05/AC-06/AC-09/AC-10/
// AC-10b/AC-15/AC-19/AC-19b). sad.md §6 Flows 1/3/5/10/11/12/13.
//
// Unit-level "integration test" against a mocked `Db` + mocked `AskClaude`
// (same convention as ../../cards/life-area-card/app/get-card.test.ts --
// route db.query by SQL text -- and ./ask-agent.test.ts -- mock the injected
// AskClaude function directly, no HTTP stub). Docker/Neon unavailable in this
// sandbox (per task instructions) -- this documents the intended real-DB
// behaviour, does not run against one.
//
// Design note (open question, flagged for human review -- spec.md/sad.md/
// data-model.md never specify HOW Claude's free-text reply is turned into a
// structured "propose a record vs ask a clarifying question vs which card"
// decision): this file defines its OWN wire contract -- Claude is instructed
// (system prompt built in handle-message.ts) to reply with a small JSON
// envelope, parsed here. Tests below construct that JSON exactly as Claude
// would be instructed to. `askAgent` (T18) itself is untouched -- its `reply`
// is treated as an opaque string carrying this envelope.

import { describe, it, expect, vi } from 'vitest';
import { handleMessage } from './handle-message';
import type { Db } from '../infra/postgres-repo';
import type { AskClaude, ClaudeResult } from '../infra/claude-client';

const USER_ID = 'user-1';
const OTHER_CARD_ID = 'card-other-user'; // never appears in this user's own card catalog

function okClaude(value: string): ClaudeResult<string> {
  return { ok: true, value };
}

function decisionJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    outcome: 'proposal',
    reply: 'Записав 5 км бігу.',
    cardId: 'card-1',
    metricBlockId: 'block-1',
    proposedAmount: 5,
    proposedSummary: '5 км бігу',
    activeProposalRelated: false,
    ...overrides,
  });
}

function cardRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'card-1',
    owner_user_id: USER_ID,
    name: 'Спорт',
    description: null,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function metricBlockRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'block-1',
    card_id: 'card-1',
    label: 'Пробіжки',
    unit: 'км',
    frequency: null,
    target_count: '20',
    is_ongoing: false,
    target_date: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function proposalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proposal-1',
    user_id: USER_ID,
    card_id: 'card-1',
    metric_block_id: 'block-1',
    status: 'active',
    source_type: 'text',
    raw_input: 'пробіг 3 км',
    proposed_amount: '3',
    proposed_summary: '3 км бігу',
    created_at: new Date('2026-02-01T09:00:00Z'),
    updated_at: new Date('2026-02-01T09:00:00Z'),
    ...overrides,
  };
}

interface FakeDbOptions {
  cards?: ReturnType<typeof cardRow>[];
  metricBlocks?: ReturnType<typeof metricBlockRow>[];
  activeProposal?: ReturnType<typeof proposalRow> | null;
  rules?: unknown[];
  chatMessages?: unknown[];
  facts?: unknown[];
  /** Row returned by any UPDATE (drop/refine) -- defaults to an updated proposal echoing back. */
  updateResult?: ReturnType<typeof proposalRow> | null;
  /** Row returned by INSERT INTO agent_proposal. */
  insertedProposal?: ReturnType<typeof proposalRow>;
  /** Row returned by any UPDATE/soft-delete on long_term_memory_fact. */
  factUpdateResult?: Record<string, unknown> | null;
  /**
   * AC-14: raw rows for listRulesByScope's EXACT-scope query (`IS NOT
   * DISTINCT FROM`) -- deliberately separate from `rules` above, which feeds
   * listEffectiveRulesForCard's OR-scoped query (global-always-matches).
   * The two queries share the substring "FROM imperative_rule" but differ in
   * scope semantics (rules-handler.ts's own createRule test convention would
   * hit the same ambiguity), so the router below distinguishes them by the
   * `IS NOT DISTINCT FROM` marker unique to listRulesByScope's SQL text.
   */
  rulesInScope?: unknown[];
}

/** SQL-text router (get-card.test.ts convention) -- only db.query is mocked, real repo modules run unchanged. */
function fakeDb(opts: FakeDbOptions = {}) {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('FROM card WHERE') || text.includes('FROM card ')) {
      return { rows: opts.cards ?? [] };
    }
    if (text.includes('FROM metric_block WHERE')) {
      return { rows: opts.metricBlocks ?? [] };
    }
    if (text.startsWith('SELECT') && text.includes('FROM agent_proposal') && text.includes("status = 'active'")) {
      return { rows: opts.activeProposal ? [opts.activeProposal] : [] };
    }
    if (text.includes('IS NOT DISTINCT FROM')) {
      // AC-14: listRulesByScope's EXACT-scope query (checked BEFORE the
      // generic 'FROM imperative_rule' branch below, since both queries
      // contain that substring) -- the conflict check needs rules of the
      // SAME scope only, not the OR-merged "effective" set.
      return { rows: opts.rulesInScope ?? [] };
    }
    if (text.includes('FROM imperative_rule')) {
      // Real SQL (listEffectiveRulesForCard): global rules (scope_card_id
      // IS NULL) always match, a card-override row only when the query's own
      // cardId param ($2) equals its scope_card_id -- routed here so a test
      // can actually observe AC-12's card resolution, not just assert on the
      // params handed to db.query.
      const cardIdParam = (params?.[1] as string | null | undefined) ?? null;
      const rows = (opts.rules ?? []) as { scope_card_id: string | null }[];
      return { rows: rows.filter((rule) => rule.scope_card_id === null || rule.scope_card_id === cardIdParam) };
    }
    if (text.includes('FROM chat_message')) {
      return { rows: opts.chatMessages ?? [] };
    }
    if (text.startsWith('SELECT') && text.includes('FROM long_term_memory_fact')) {
      return { rows: opts.facts ?? [] };
    }
    if (text.startsWith('INSERT INTO agent_proposal')) {
      return { rows: [opts.insertedProposal ?? proposalRow(paramsToProposalRow(params))] };
    }
    if (text.startsWith('UPDATE agent_proposal')) {
      return { rows: opts.updateResult === undefined ? [proposalRow()] : opts.updateResult ? [opts.updateResult] : [] };
    }
    if (text.startsWith('INSERT INTO long_term_memory_fact')) {
      return { rows: [factRowFromParams(params)] };
    }
    if (text.startsWith('UPDATE long_term_memory_fact')) {
      return { rows: opts.factUpdateResult === undefined ? [factRowFromParams()] : opts.factUpdateResult ? [opts.factUpdateResult] : [] };
    }
    if (text.startsWith('INSERT INTO agent_audit_event')) {
      return { rows: [{ id: 'audit-1', user_id: USER_ID, event_type: 'proposal_created', subject_type: 'proposal', subject_id: 'proposal-1', detail: null, occurred_at: new Date() }] };
    }
    if (text.startsWith('INSERT INTO imperative_rule')) {
      return { rows: [ruleRowFromParams(params)] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

function factRowFromParams(params?: unknown[]) {
  const [id, userId, factText, topic] = params ?? [];
  return {
    id: id ?? 'fact-1',
    user_id: userId ?? USER_ID,
    fact_text: factText ?? '',
    topic: topic ?? null,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function ruleRowFromParams(params?: unknown[]) {
  const [id, userId, scopeCardId, category, ruleText] = params ?? [];
  return {
    id: id ?? 'rule-new',
    user_id: userId ?? USER_ID,
    scope_card_id: scopeCardId ?? null,
    category: category ?? null,
    rule_text: ruleText ?? null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function paramsToProposalRow(params?: unknown[]) {
  const [id, userId, cardId, metricBlockId, sourceType, rawInput, proposedAmount, proposedSummary] = params ?? [];
  return {
    id: id ?? 'proposal-new',
    user_id: userId ?? USER_ID,
    card_id: cardId ?? null,
    metric_block_id: metricBlockId ?? null,
    source_type: sourceType ?? 'text',
    raw_input: rawInput ?? '',
    proposed_amount: proposedAmount == null ? null : String(proposedAmount),
    proposed_summary: proposedSummary ?? '',
  };
}

describe('handleMessage -- Flow 1 (AC-01): text -> proposal', () => {
  it('creates and persists an active proposal from free text, scoped to the resolved card', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    expect(result.reply).toBe('Записав 5 км бігу.');
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.cardId).toBe('card-1');
    expect(result.proposal?.metricBlockId).toBe('block-1');
    expect(result.proposal?.proposedAmount).toBe(5);

    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(
      expect.arrayContaining(['card-1', 'block-1', 'text', 'пробіг 5 км', 5, '5 км бігу'])
    );

    // Two audit rows now land per turn (AC-07 fix also wires a guard_passed/
    // guard_failed row on every call) -- filter by content, not just the SQL
    // prefix, to isolate the proposal_created one this assertion cares about.
    const auditCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('proposal_created')
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(expect.arrayContaining(['proposal_created', 'proposal']));
  });

  it("passes the user's own active cards and their metric blocks into Claude's system prompt", async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    expect(sentPrompt).toContain('card-1');
    expect(sentPrompt).toContain('Спорт');
    expect(sentPrompt).toContain('block-1');
    expect(sentPrompt).toContain('Пробіжки');
  });

  it('never trusts a cardId Claude returns that is outside this user\'s own catalog (AC-06), and -- since that leaves the proposal without a card (AC-05 fix) -- persists nothing at all', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson({ cardId: OTHER_CARD_ID, metricBlockId: 'block-other' })));

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    // Review 2026-09-12 (AC-01/AC-02/AC-05 dead end): a foreign cardId never
    // resolves (AC-06 non-disclosure, unchanged) -- and an unresolved card
    // now falls through to the SAME clarification branch as AC-04/AC-05,
    // rather than persisting a null-card 'active' proposal that confirm.ts
    // would later reject with 409 agent.proposal_incomplete.
    expect(result.proposal).toBeNull();
    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(inserted).toBe(false);
  });
});

describe('handleMessage -- Flow 3 (AC-10/AC-19): attachment -> proposal, same path for photo and document', () => {
  it('creates a proposal from a photo attachment with no text (AC-10)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Розпізнав сторінку книги.', proposedSummary: 'Прочитано 20 сторінок' }))
    );

    const result = await handleMessage(db, askClaude, {
      userId: USER_ID,
      text: null,
      attachment: { mediaType: 'image/jpeg', base64Data: 'AAAA' },
    });

    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.sourceType).toBe('attachment');
    const askInput = askClaude.mock.calls[0][0];
    expect(askInput.text).toBeNull();
    expect(askInput.attachment).toEqual({ mediaType: 'image/jpeg', base64Data: 'AAAA' });
  });

  it('creates a proposal from a document/spreadsheet attachment via the exact same path as a photo (AC-19)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Розпізнав таблицю витрат.', proposedSummary: 'Витрачено 500 грн' }))
    );

    const result = await handleMessage(db, askClaude, {
      userId: USER_ID,
      text: null,
      attachment: { mediaType: 'application/pdf', base64Data: 'BBBB' },
    });

    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.sourceType).toBe('attachment');
  });
});

describe('handleMessage -- AC-10b/AC-19b: unrecognized attachment -- no persistence at all', () => {
  it('propagates agent.attachment_unrecognized (422) for an unsupported MIME type and writes nothing', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue({
      ok: false,
      error: { code: 'claude.unsupported_attachment', message: 'Непідтримуваний тип вкладення: application/zip' },
    });

    await expect(
      handleMessage(db, askClaude, {
        userId: USER_ID,
        text: null,
        attachment: { mediaType: 'application/zip', base64Data: 'CCCC' },
      })
    ).rejects.toMatchObject({ code: 'agent.attachment_unrecognized', httpStatus: 422 });

    const writes = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).startsWith('INSERT') || String(c[0]).startsWith('UPDATE')
    );
    expect(writes).toHaveLength(0);
  });

  it('returns a plain clarifying reply, without a proposal, when Claude recognizes the attachment but cannot extract a fact (AC-10b)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        JSON.stringify({
          outcome: 'clarification',
          reply: 'Не вдалося розібрати це фото -- опиши, будь ласка, текстом.',
          cardId: null,
          metricBlockId: null,
          proposedAmount: null,
          proposedSummary: null,
          activeProposalRelated: false,
        })
      )
    );

    const result = await handleMessage(db, askClaude, {
      userId: USER_ID,
      text: null,
      attachment: { mediaType: 'image/jpeg', base64Data: 'DDDD' },
    });

    expect(result.proposal).toBeNull();
    expect(result.reply).toContain('опиши');
    // AC-07 fix: a guard_passed/guard_failed audit row is now written for
    // every completed Claude turn, clarification included -- so "nothing
    // persisted" here means no proposal/fact write, not zero writes at all.
    const proposalOrFactWrites = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) =>
        String(c[0]).startsWith('INSERT INTO agent_proposal') ||
        String(c[0]).startsWith('UPDATE agent_proposal') ||
        String(c[0]).startsWith('INSERT INTO long_term_memory_fact') ||
        String(c[0]).startsWith('UPDATE long_term_memory_fact')
    );
    expect(proposalOrFactWrites).toHaveLength(0);
  });
});

describe('handleMessage -- Flow 10 (AC-04): contradictory/unmapped data -> clarification, nothing persisted', () => {
  it('returns the clarifying reply without creating a proposal', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        JSON.stringify({
          outcome: 'clarification',
          reply: 'Це суперечить тому, що ти казав раніше -- уточни, будь ласка.',
          cardId: null,
          metricBlockId: null,
          proposedAmount: null,
          proposedSummary: null,
          activeProposalRelated: false,
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'щось суперечливе' });

    expect(result.proposal).toBeNull();
    expect(result.reply).toContain('уточни');
    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(inserted).toBe(false);
  });
});

describe('handleMessage -- Flow 13 (AC-05): ambiguous card -> clarification, nothing persisted', () => {
  it('asks which card the user meant instead of guessing, when several cards are equally likely', async () => {
    const db = fakeDb({
      cards: [cardRow(), cardRow({ id: 'card-2', name: 'Навчання' })],
      metricBlocks: [metricBlockRow()],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        JSON.stringify({
          outcome: 'clarification',
          reply: 'Яку картку ти маєш на увазі -- Спорт чи Навчання?',
          cardId: null,
          metricBlockId: null,
          proposedAmount: null,
          proposedSummary: null,
          activeProposalRelated: false,
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: '2 години' });

    expect(result.proposal).toBeNull();
    expect(result.reply).toContain('Спорт');
    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(inserted).toBe(false);
  });
});

describe('handleMessage -- Flow 12 (AC-15): short-term session window reaches the prompt', () => {
  it("includes today's earlier messages of the same session in Claude's system prompt", async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      chatMessages: [
        { id: 'm1', user_id: USER_ID, role: 'user', content: 'сьогодні вирішив бігати щодня', session_date: '2026-02-01', created_at: new Date('2026-02-01T08:00:00Z') },
      ],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км', now: new Date('2026-02-01T10:00:00Z') });

    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    expect(sentPrompt).toContain('вирішив бігати щодня');
  });
});

describe('handleMessage -- Flow 11 (AC-09): long-term fact reaches the prompt', () => {
  it('includes a matching long-term fact (by topic) in the system prompt', async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      facts: [
        { id: 'f1', user_id: USER_ID, fact_text: 'Тренується для півмарафону', topic: 'біг', status: 'active', created_at: new Date(), updated_at: new Date() },
      ],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км', topic: 'біг' });

    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    expect(sentPrompt).toContain('Тренується для півмарафону');
  });

  it('does not query long-term facts when no topic hint is given', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    const factQuery = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('FROM long_term_memory_fact'));
    expect(factQuery).toBe(false);
  });
});

describe('handleMessage -- Flow 5 (AC-03 mechanics): unrelated message silently drops a stale active proposal', () => {
  it('drops the old active proposal and creates a fresh one for the new, unrelated message', async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      activeProposal: proposalRow({ id: 'old-proposal', proposed_summary: '3 км бігу' }),
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Записав нову подію.', activeProposalRelated: false }))
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'зовсім інша тема' });

    const dropCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('UPDATE agent_proposal') && (c[1] as unknown[]).includes('dropped')
    );
    expect(dropCall).toBeDefined();
    expect(dropCall![1]).toEqual(expect.arrayContaining(['old-proposal', USER_ID]));

    const droppedAudit = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('proposal_dropped')
    );
    expect(droppedAudit).toBeDefined();

    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.id).not.toBe('old-proposal');
  });

  it('does not touch the active proposal when Claude marks the new message as related to it, refining it instead (AC-02b)', async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      activeProposal: proposalRow({ id: 'active-1', proposed_amount: '3', proposed_summary: '3 км бігу' }),
      updateResult: proposalRow({ id: 'active-1', proposed_amount: '5', proposed_summary: '5 км бігу' }),
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          reply: 'Оновив -- 5 км замість 3.',
          proposedAmount: 5,
          proposedSummary: '5 км бігу',
          activeProposalRelated: true,
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'ні, 5 км, а не 3' });

    expect(result.proposal?.id).toBe('active-1');
    expect(result.proposal?.proposedAmount).toBe(5);

    const dropCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('UPDATE agent_proposal') && (c[1] as unknown[]).includes('dropped')
    );
    expect(dropCall).toBeUndefined();

    const insertedNew = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(insertedNew).toBe(false);
  });
});

describe('handleMessage -- AC-06: every read is scoped to this call\'s own userId', () => {
  it('passes userId through to every scoped repository read', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls;
    const scopedReads = calls.filter(
      (c) =>
        String(c[0]).includes('FROM imperative_rule') ||
        String(c[0]).includes('FROM chat_message') ||
        (String(c[0]).includes('FROM agent_proposal') && String(c[0]).startsWith('SELECT'))
    );
    expect(scopedReads.length).toBeGreaterThan(0);
    for (const call of scopedReads) {
      expect(call[1]).toContain(USER_ID);
    }
  });
});

// ---------------------------------------------------------------------
// Review 2026-09-12 -- five findings converging on this one file (AC-06,
// AC-07, AC-09, AC-12, AC-01/AC-02/AC-05).
// ---------------------------------------------------------------------

describe('handleMessage -- AC-06 fix: third-person names are stripped before persistence', () => {
  it('removes a third-person name Claude identified from both rawInput and proposedSummary before they reach agent_proposal', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          proposedSummary: 'біг з Марією 5 км',
          thirdPersonNames: ['Марією'],
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'біг з Марією 5 км' });

    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.proposedSummary).not.toContain('Марією');
    expect(result.proposal?.rawInput).not.toContain('Марією');

    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(String(params[5])).not.toContain('Марією'); // raw_input
    expect(String(params[7])).not.toContain('Марією'); // proposed_summary
  });
});

describe("handleMessage -- AC-07 fix: askAgent's guard verdict is audited every turn", () => {
  it('writes a guard_passed audit row when no active rule is violated', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson()));

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    const guardAudit = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('guard_passed')
    );
    expect(guardAudit).toBeDefined();
    expect(guardAudit![1]).toEqual(expect.arrayContaining(['guard_passed', 'guard']));
  });

  it('writes a guard_failed audit row carrying the violated rule reason when the reply violates an active rule', async () => {
    const rule = {
      id: 'rule-1',
      user_id: USER_ID,
      scope_card_id: null,
      category: null,
      rule_text: 'Не радь, якщо не питаю',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()], rules: [rule] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Раджу бігати частіше для кращих результатів.' }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    const guardAudit = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('guard_failed')
    );
    expect(guardAudit).toBeDefined();
    expect(guardAudit![1]).toEqual(expect.arrayContaining(['guard_failed', 'guard', 'Не радь, якщо не питаю']));
  });
});

describe('handleMessage -- AC-09 fix: long-term fact write path (remember)', () => {
  it('remembers a fact Claude flagged as worth long-term memory', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ rememberFact: 'Тренується для півмарафону', rememberTopic: 'біг' }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км, готуюсь до півмарафону' });

    const insertFactCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).startsWith('INSERT INTO long_term_memory_fact')
    );
    expect(insertFactCall).toBeDefined();
    expect(insertFactCall![1]).toEqual(expect.arrayContaining([USER_ID, 'Тренується для півмарафону', 'біг']));
  });

  it('never remembers a fact that becomes empty after stripping third-person names (AC-06 invariant, ADR-0006 sentinel)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ rememberFact: 'Марією', thirdPersonNames: ['Марією'] }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'щось про Марією' });

    const insertedFact = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO long_term_memory_fact'));
    expect(insertedFact).toBe(false);
  });
});

describe('handleMessage -- AC-09 fix: forgetting/correcting a previously-remembered fact ("забудь, що...")', () => {
  it('soft-deletes the matching fact and audits memory_fact_deleted when no replacement text is given', async () => {
    const existingFact = {
      id: 'fact-1',
      user_id: USER_ID,
      fact_text: 'Тренується для півмарафону',
      topic: 'біг',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()], facts: [existingFact] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ outcome: 'clarification', proposedSummary: null, forgetTopic: 'біг' }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'забудь, що я готуюсь до півмарафону' });

    const deleteCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('UPDATE long_term_memory_fact'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(expect.arrayContaining(['fact-1', USER_ID]));

    const auditCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('memory_fact_deleted')
    );
    expect(auditCall).toBeDefined();
  });

  it('edits the matching fact in place and audits memory_fact_edited when a replacement text is given', async () => {
    const existingFact = {
      id: 'fact-1',
      user_id: USER_ID,
      fact_text: 'Тренується для півмарафону',
      topic: 'біг',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()], facts: [existingFact] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          forgetTopic: 'біг',
          forgetReplacementText: 'Тренується для марафону, не півмарафону',
        })
      )
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'насправді я готуюсь до марафону, не півмарафону' });

    const updateCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('UPDATE long_term_memory_fact'));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(expect.arrayContaining(['Тренується для марафону, не півмарафону']));

    const auditCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('memory_fact_edited')
    );
    expect(auditCall).toBeDefined();
  });
});

describe('handleMessage -- AC-12 fix: rule scope resolves from the message target card, not only the prior active proposal', () => {
  it('applies a card-scoped rule override on the FIRST message of a turn (no active proposal yet) when the message names that card', async () => {
    const overrideRule = {
      id: 'rule-1',
      user_id: USER_ID,
      scope_card_id: 'card-1',
      category: null,
      rule_text: 'Не радь, якщо не питаю',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()], rules: [overrideRule] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Раджу бігати частіше для кращих результатів.' }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'Спорт: пробіг 5 км' });

    // Proves the override rule actually reached the system prompt BEFORE the
    // Claude call -- only possible if the candidate card was resolved from
    // this message's own text, since there is no active proposal yet.
    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    expect(sentPrompt).toContain('Не радь, якщо не питаю');

    // ...and its guard EFFECT actually fired: the reply violates it, so the
    // audited verdict is guard_failed -- not guard_passed, which is what the
    // old bug (candidate card always taken from the PRIOR active proposal,
    // null on a first message) would have silently produced instead.
    const guardAudit = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('guard_failed')
    );
    expect(guardAudit).toBeDefined();
  });

  it('control: the same card-scoped rule does NOT apply when the message names no card and there is no active proposal', async () => {
    const overrideRule = {
      id: 'rule-1',
      user_id: USER_ID,
      scope_card_id: 'card-1',
      category: null,
      rule_text: 'Не радь, якщо не питаю',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()], rules: [overrideRule] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(decisionJson({ reply: 'Раджу бігати частіше для кращих результатів.' }))
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'просто хочу поговорити' });

    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    expect(sentPrompt).not.toContain('Не радь, якщо не питаю');

    const guardAudit = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO agent_audit_event') && (c[1] as unknown[]).includes('guard_passed')
    );
    expect(guardAudit).toBeDefined();
  });
});

describe('handleMessage -- AC-14: chat-based rule drafting (review 2026-09-13, gap fix)', () => {
  it("saves a global free-text rule once Claude's dialogue converges and no rule of the same scope conflicts", async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      rulesInScope: [],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Зберіг правило: завжди уточнюй одиниці виміру.',
          proposedRule: { category: null, ruleText: 'Завжди уточнюй одиниці виміру', scopeCardId: null },
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'хочу правило про уточнення одиниць' });

    expect(result.reply).toBe('Зберіг правило: завжди уточнюй одиниці виміру.');
    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO imperative_rule'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(expect.arrayContaining([USER_ID, null, null, 'Завжди уточнюй одиниці виміру']));
  });

  it('saves a card-scoped category rule when the scopeCardId resolves to a card this user actually owns', async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      rulesInScope: [],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          proposedRule: { category: 'reminder', ruleText: null, scopeCardId: 'card-1' },
        })
      )
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'нагадуй мені про цю картку частіше' });

    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO imperative_rule'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(expect.arrayContaining([USER_ID, 'card-1', 'reminder', null]));
  });

  it('does NOT save and overrides the reply when the proposed rule conflicts with an existing rule of the same scope (AC-14 core check)', async () => {
    const existingGlobalRule = {
      id: 'rule-existing',
      user_id: USER_ID,
      scope_card_id: null,
      category: null,
      rule_text: 'завжди уточнюй одиниці виміру',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      rulesInScope: [existingGlobalRule],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Зберіг нове правило.',
          // Same free text (case/whitespace-insensitive) as the existing global rule above.
          proposedRule: { category: null, ruleText: '  Завжди уточнюй ОДИНИЦІ виміру  ', scopeCardId: null },
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'хочу таке саме правило ще раз' });

    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO imperative_rule'));
    expect(inserted).toBe(false);
    // Claude's own optimistic reply is NOT trusted when the deterministic
    // check disagrees (same AC-06 "never trust Claude blindly" principle
    // already applied to cardId resolution above) -- the user must see that
    // nothing was actually saved and why.
    expect(result.reply).not.toBe('Зберіг нове правило.');
    expect(result.reply.toLowerCase()).toContain('вже є');
  });

  it("never trusts a scopeCardId Claude returns that is outside this user's own catalog (AC-06 applied to AC-14), and skips saving the rule", async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      rulesInScope: [],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          proposedRule: { category: 'reminder', ruleText: null, scopeCardId: OTHER_CARD_ID },
        })
      )
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'нагадуй мені про чужу картку' });

    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO imperative_rule'));
    expect(inserted).toBe(false);
  });

  it('never saves an empty rule (ADR-0006 domain sentinel -- neither category nor ruleText given)', async () => {
    const db = fakeDb({
      cards: [cardRow()],
      metricBlocks: [metricBlockRow()],
      rulesInScope: [],
    });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          proposedRule: { category: null, ruleText: '   ', scopeCardId: null },
        })
      )
    );

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'хочу правило але не знаю яке' });

    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO imperative_rule'));
    expect(inserted).toBe(false);
  });
});

describe('handleMessage -- AC-20b: chat-initiated developer report (review 2026-09-13, gap fix)', () => {
  it("calls the injected reportUserIssue callback with Claude's description and trusts Claude's own confirmation reply on success", async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Надіслав це розробнику.',
          reportIssueToDeveloper: 'Кнопка підтвердження запису не реагує на дотик на Android',
        })
      )
    );
    const reportUserIssue = vi.fn().mockResolvedValue({ deliveryStatus: 'sent' as const });

    const result = await handleMessage(
      db,
      askClaude,
      { userId: USER_ID, text: 'кнопка підтвердження не працює, відправ це розробнику' },
      { reportUserIssue }
    );

    expect(reportUserIssue).toHaveBeenCalledWith('Кнопка підтвердження запису не реагує на дотик на Android');
    expect(result.reply).toBe('Надіслав це розробнику.');
  });

  it('overrides the reply when the injected callback reports a failed delivery, instead of trusting an optimistic Claude reply', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Надіслав це розробнику.',
          reportIssueToDeveloper: 'Щось не працює',
        })
      )
    );
    const reportUserIssue = vi.fn().mockResolvedValue({ deliveryStatus: 'failed' as const });

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'відправ це розробнику' }, { reportUserIssue });

    expect(result.reply).not.toBe('Надіслав це розробнику.');
    expect(result.reply.toLowerCase()).toContain('не вдал');
  });

  it('overrides the reply when the injected callback throws unexpectedly (never lets an email failure crash the whole chat turn)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Надіслав це розробнику.',
          reportIssueToDeveloper: 'Щось не працює',
        })
      )
    );
    const reportUserIssue = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'відправ це розробнику' }, { reportUserIssue });

    expect(result.reply).not.toBe('Надіслав це розробнику.');
    expect(result.reply.toLowerCase()).toContain('не вдал');
  });

  it('is a no-op when no reportUserIssue callback is injected (backward-compatible -- existing callers/tests never wire email)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Гаразд.',
          reportIssueToDeveloper: 'Щось не працює',
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'відправ це розробнику' });

    expect(result.reply).toBe('Гаразд.');
  });
});

describe('handleMessage -- AC-01/AC-02/AC-05 fix: an incomplete proposal never becomes an active one', () => {
  it('falls through to clarification (nothing persisted) when Claude proposes a record but leaves the amount unresolved', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson({ proposedAmount: null })));

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг трохи' });

    // Previously this created an 'active' agent_proposal with proposed_amount
    // NULL -- ChatPanel would render a working "Підтвердити" button, and
    // confirm.ts would only THEN throw 409 agent.proposal_incomplete. Now the
    // same clarification branch as AC-04/AC-05 applies instead -- a dead end
    // never reaches the user.
    expect(result.proposal).toBeNull();
    const inserted = (db.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO agent_proposal'));
    expect(inserted).toBe(false);
  });
});

describe('handleMessage -- T12 (AC-06/AC-09): agent-drafted plan-item, confirmed in chat', () => {
  it('AC-06: a plan-item the agent merely PROPOSES is never created -- nothing leaves the chat', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Пропоную так: «Записатись до лікаря цього тижня». Підтвердиш?',
          planItemProposal: { horizon: 'tactical', planText: 'Записатись до лікаря цього тижня' },
        })
      )
    );
    const createPlanItem = vi.fn().mockResolvedValue(undefined);

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'хочу щось зробити зі здоровʼям' }, { createPlanItem });

    expect(createPlanItem).not.toHaveBeenCalled();
    expect(result.reply).toContain('Підтвердиш?');
  });

  it('AC-09: confirming the proposal in chat creates the plan-item with the confirmed text, via the injected create path', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Додав до тактичного горизонту.',
          confirmedPlanItem: { horizon: 'tactical', planText: 'Записатись до лікаря цього тижня' },
        })
      )
    );
    const createPlanItem = vi.fn().mockResolvedValue(undefined);

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'так, додай' }, { createPlanItem });

    expect(createPlanItem).toHaveBeenCalledTimes(1);
    expect(createPlanItem).toHaveBeenCalledWith({
      ownerUserId: USER_ID,
      horizon: 'tactical',
      planText: 'Записатись до лікаря цього тижня',
    });
  });

  it('never creates a plan-item from an empty confirmed text (same fail-safe as the rest of this file)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Гаразд.',
          confirmedPlanItem: { horizon: 'tactical', planText: '   ' },
        })
      )
    );
    const createPlanItem = vi.fn().mockResolvedValue(undefined);

    await handleMessage(db, askClaude, { userId: USER_ID, text: 'так' }, { createPlanItem });

    expect(createPlanItem).not.toHaveBeenCalled();
  });

  it('is a no-op when no createPlanItem callback is injected (backward-compatible with every existing caller)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(
      okClaude(
        decisionJson({
          outcome: 'clarification',
          proposedSummary: null,
          reply: 'Гаразд.',
          confirmedPlanItem: { horizon: 'tactical', planText: 'Записатись до лікаря' },
        })
      )
    );

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'так, додай' });

    expect(result.reply).toBe('Гаразд.');
  });
});
