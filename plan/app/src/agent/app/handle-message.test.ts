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
    if (text.includes('FROM imperative_rule')) {
      return { rows: opts.rules ?? [] };
    }
    if (text.includes('FROM chat_message')) {
      return { rows: opts.chatMessages ?? [] };
    }
    if (text.includes('FROM long_term_memory_fact')) {
      return { rows: opts.facts ?? [] };
    }
    if (text.startsWith('INSERT INTO agent_proposal')) {
      return { rows: [opts.insertedProposal ?? proposalRow(paramsToProposalRow(params))] };
    }
    if (text.startsWith('UPDATE agent_proposal')) {
      return { rows: opts.updateResult === undefined ? [proposalRow()] : opts.updateResult ? [opts.updateResult] : [] };
    }
    if (text.startsWith('INSERT INTO agent_audit_event')) {
      return { rows: [{ id: 'audit-1', user_id: USER_ID, event_type: 'proposal_created', subject_type: 'proposal', subject_id: 'proposal-1', detail: null, occurred_at: new Date() }] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
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

    const auditCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO agent_audit_event'));
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

  it('never trusts a cardId Claude returns that is outside this user\'s own catalog (AC-06)', async () => {
    const db = fakeDb({ cards: [cardRow()], metricBlocks: [metricBlockRow()] });
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okClaude(decisionJson({ cardId: OTHER_CARD_ID, metricBlockId: 'block-other' })));

    const result = await handleMessage(db, askClaude, { userId: USER_ID, text: 'пробіг 5 км' });

    expect(result.proposal?.cardId).toBeNull();
    expect(result.proposal?.metricBlockId).toBeNull();
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
    const writes = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).startsWith('INSERT') || String(c[0]).startsWith('UPDATE')
    );
    expect(writes).toHaveLength(0);
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
