// T20 -- Ports: GET/POST /messages handlers (docs/features/agent/contracts/openapi.yaml,
// operationId listMessages / createMessage; spec.md AC-01/AC-02b/AC-03/AC-04/AC-05/AC-09/
// AC-10/AC-10b/AC-15/AC-19/AC-19b).
//
// Той самий підхід, що ../ports/proposal-handler.test.ts: createMessage делегує
// оркестрацію ВЖЕ юніт-тестованому ../app/handle-message.ts (T16, мокнутий тут на
// межі порту) -- цей тест перевіряє лише (1) 422 `agent.message_empty` ДО будь-
// якого звернення до бази, коли ні тексту, ні вкладення немає, (2) rate-limit
// перевірку ДО виклику handleMessage, (3) мапінг HandleMessageResult ->
// контрактний MessageTurn DTO, (4) запис репліки користувача в chat_message
// ОДРАЗУ ПІСЛЯ виклику handleMessage -- незалежно від успіху -- і репліки
// агента лише при успіху (AC-15), і (5) що AppError (422/503) з handleMessage
// проходить нагору незмінно, АЛЕ репліка користувача вже записана до того (Review
// 2026-09-12: інакше повторний 422/503-хід лишався невидимим для наступного
// rate-limit підрахунку) -- не повторює app-шарове тестування (уже покрите
// ../app/handle-message.test.ts).
//
// DoD (tasks.json T20): "Handlers return the contract shapes exactly: 201
// MessageTurn, 422 agent.attachment_unrecognized, 429 agent.rate_limited, 503
// agent.llm_unavailable; attachment field accepts document/spreadsheet MIME
// types, not just photo". Розширено Review 2026-09-12: 422 `agent.message_empty`
// (порожній хід), 60/год лічильник рахує СПРОБИ, не лише успішні ходи.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';
import type { AskClaude } from '../infra/claude-client';

vi.mock('../app/handle-message', () => ({
  handleMessage: vi.fn(),
}));

import { handleMessage } from '../app/handle-message';
import { createMessage, listMessages } from './chat-handler';

const USER_ID = 'user-1';
const NOW = new Date('2026-09-12T10:00:00Z');

function proposalRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proposal-1',
    userId: USER_ID,
    cardId: 'card-1',
    metricBlockId: 'block-1',
    status: 'active',
    sourceType: 'text',
    rawInput: 'пробіг 5 км',
    proposedAmount: 5,
    proposedSummary: '5 км бігу',
    createdAt: new Date('2026-09-12T09:59:00Z'),
    updatedAt: new Date('2026-09-12T09:59:00Z'),
    ...overrides,
  };
}

function chatRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'msg-1',
    user_id: USER_ID,
    role: 'user',
    content: 'пробіг 5 км',
    session_date: '2026-09-12',
    created_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMessage handler (POST /api/v1/messages)', () => {
  it('rejects with 429 agent.rate_limited BEFORE calling handleMessage when the hourly cap is hit (§8 SAD rate limiting)', async () => {
    // Перший query -- лічильник повідомлень користувача за останню годину.
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: '60' }] });
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    await expect(createMessage(db, askClaude, USER_ID, { content: 'привіт' }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.rate_limited',
      httpStatus: 429,
    });
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('delegates to handleMessage, maps the result to a contract-shaped MessageTurn (AC-01/AC-10/AC-19), and persists both turns to chat_message (AC-15)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate-limit count
      .mockResolvedValueOnce({ rows: [chatRow({ id: 'msg-user', role: 'user' })] }) // insertChatMessage(user)
      .mockResolvedValueOnce({ rows: [chatRow({ id: 'msg-agent', role: 'agent', content: 'Записати 5 км бігу?' })] }); // insertChatMessage(agent)
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: 'Записати 5 км бігу?',
      proposal: proposalRecord(),
    });

    const result = await createMessage(db, askClaude, USER_ID, { content: 'пробіг 5 км' }, { now: NOW });

    expect(handleMessage).toHaveBeenCalledWith(db, askClaude, {
      userId: USER_ID,
      text: 'пробіг 5 км',
      attachment: null,
      now: NOW,
    });

    expect(result).toEqual({
      reply: 'Записати 5 км бігу?',
      proposal: {
        id: 'proposal-1',
        cardId: 'card-1',
        metricBlockId: 'block-1',
        status: 'active',
        sourceType: 'text',
        rawInput: 'пробіг 5 км',
        proposedAmount: 5,
        proposedSummary: '5 км бігу',
        createdAt: '2026-09-12T09:59:00.000Z',
        updatedAt: '2026-09-12T09:59:00.000Z',
      },
    });

    // AC-15: обидві репліки цього ходу лягли в chat_message -- user-текст, а
    // потім agent-репліка -- ще ДО кінця виклику (мінімум 3 запити: rate-limit
    // count + 2 insert).
    expect(query).toHaveBeenCalledTimes(3);
    const userInsertParams = query.mock.calls[1][1] as unknown[];
    expect(userInsertParams).toEqual(expect.arrayContaining(['пробіг 5 км', USER_ID, 'user']));
    const agentInsertParams = query.mock.calls[2][1] as unknown[];
    expect(agentInsertParams).toEqual(expect.arrayContaining(['Записати 5 км бігу?', USER_ID, 'agent']));
  });

  it('returns proposal: null for a pure clarification turn (AC-04/AC-05/AC-10b/AC-19b)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [chatRow()] })
      .mockResolvedValueOnce({ rows: [chatRow({ role: 'agent' })] });
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: 'Яку картку ти маєш на увазі?',
      proposal: null,
    });

    const result = await createMessage(db, askClaude, USER_ID, { content: 'зробив щось' }, { now: NOW });

    expect(result).toEqual({ reply: 'Яку картку ти маєш на увазі?', proposal: null });
  });

  it('accepts a document/spreadsheet attachment MIME type unchanged, not just photo (AC-19)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [chatRow()] })
      .mockResolvedValueOnce({ rows: [chatRow({ role: 'agent' })] });
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: 'Отримав таблицю, пропоную запис.',
      proposal: proposalRecord(),
    });

    const attachment = { mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64Data: 'QUJD' };
    await createMessage(db, askClaude, USER_ID, { content: null, attachment }, { now: NOW });

    expect(handleMessage).toHaveBeenCalledWith(db, askClaude, {
      userId: USER_ID,
      text: null,
      attachment,
      now: NOW,
    });
  });

  it('propagates agent.attachment_unrecognized (422) from handleMessage unchanged, but still records the user turn (Review 2026-09-12: the attempt must count toward the rate limit)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate-limit count
      .mockResolvedValueOnce({ rows: [chatRow({ content: '[вкладення: application/zip]' })] }); // insertChatMessage(user) despite the failure
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.attachment_unrecognized', "Couldn't read this attachment", 422)
    );

    await expect(
      createMessage(db, askClaude, USER_ID, { content: null, attachment: { mediaType: 'application/zip', base64Data: 'AA==' } }, { now: NOW })
    ).rejects.toMatchObject({ code: 'agent.attachment_unrecognized', httpStatus: 422 });

    // rate-limit count + insertChatMessage(user) -- NO agent-reply insert (there
    // was no reply), but the user's attempt IS recorded so it counts toward the
    // next call's rate-limit check.
    expect(query).toHaveBeenCalledTimes(2);
    const userInsertParams = query.mock.calls[1][1] as unknown[];
    expect(userInsertParams).toEqual(expect.arrayContaining(['[вкладення: application/zip]', USER_ID, 'user']));
  });

  it('propagates agent.llm_unavailable (503) from handleMessage unchanged, but still records the user turn (Review 2026-09-12)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate-limit count
      .mockResolvedValueOnce({ rows: [chatRow({ content: 'привіт' })] }); // insertChatMessage(user) despite the failure
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.llm_unavailable', 'The agent is temporarily unavailable', 503)
    );

    await expect(createMessage(db, askClaude, USER_ID, { content: 'привіт' }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.llm_unavailable',
      httpStatus: 503,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('a 422/503 turn still counts toward the 60/hour rate limit on the very next call (Review 2026-09-12: the bug this fixes)', async () => {
    // First call: handleMessage fails with 503 (Claude outage). The count query
    // reports 59 already-recorded attempts -- one below the cap.
    const firstQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '59' }] }) // rate-limit count
      .mockResolvedValueOnce({ rows: [chatRow({ content: 'привіт' })] }); // insertChatMessage(user) despite the failure
    const db: Db = { query: firstQuery };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.llm_unavailable', 'The agent is temporarily unavailable', 503)
    );

    await expect(createMessage(db, askClaude, USER_ID, { content: 'привіт' }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.llm_unavailable',
      httpStatus: 503,
    });
    // The failed attempt left a row -- a real system would now report 60 recent
    // user messages on the very next call, one hour's cap already reached.
    const secondQuery = vi.fn().mockResolvedValueOnce({ rows: [{ count: '60' }] });
    const retryDb: Db = { query: secondQuery };

    await expect(createMessage(retryDb, askClaude, USER_ID, { content: 'привіт ще раз' }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.rate_limited',
      httpStatus: 429,
    });
    // handleMessage was never retried -- rejected purely on the (now correctly
    // updated) count, before any second Claude call could be attempted.
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});

describe('createMessage handler -- empty turn validation (POST /api/v1/messages)', () => {
  it('rejects with 422 agent.message_empty BEFORE touching the database or calling handleMessage when both content and attachment are absent', async () => {
    const query = vi.fn();
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    await expect(createMessage(db, askClaude, USER_ID, {}, { now: NOW })).rejects.toMatchObject({
      code: 'agent.message_empty',
      httpStatus: 422,
    });
    expect(handleMessage).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects with 422 agent.message_empty when content and attachment are explicitly null', async () => {
    const query = vi.fn();
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    await expect(createMessage(db, askClaude, USER_ID, { content: null, attachment: null }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.message_empty',
      httpStatus: 422,
    });
    expect(handleMessage).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('listMessages handler (GET /api/v1/messages)', () => {
  it('returns a contract-shaped MessagePage (camelCase, ISO dates), most recent history on first call', async () => {
    const rows = [
      chatRow({ id: 'm1', content: 'перше', created_at: new Date('2026-09-12T08:00:00Z') }),
      chatRow({ id: 'm2', role: 'agent', content: 'друге', created_at: new Date('2026-09-12T08:01:00Z') }),
      chatRow({ id: 'm3', content: 'третє', created_at: new Date('2026-09-12T08:02:00Z') }),
    ];
    const query = vi.fn().mockResolvedValueOnce({ rows });
    const db: Db = { query };

    const result = await listMessages(db, USER_ID, { limit: 50 });

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual({ id: 'm1', role: 'user', content: 'перше', createdAt: '2026-09-12T08:00:00.000Z' });
    expect(result.has_next).toBe(false);
    expect(query.mock.calls[0][1]).toEqual([USER_ID]);
  });

  it('paginates forward with the after cursor', async () => {
    const rows = [
      chatRow({ id: 'm1', content: 'перше', created_at: new Date('2026-09-12T08:00:00Z') }),
      chatRow({ id: 'm2', content: 'друге', created_at: new Date('2026-09-12T08:01:00Z') }),
      chatRow({ id: 'm3', content: 'третє', created_at: new Date('2026-09-12T08:02:00Z') }),
    ];
    const query = vi.fn().mockResolvedValueOnce({ rows });
    const db: Db = { query };

    const result = await listMessages(db, USER_ID, { after: 'm1', limit: 1 });

    expect(result.items).toEqual([{ id: 'm2', role: 'user', content: 'друге', createdAt: '2026-09-12T08:01:00.000Z' }]);
    expect(result.has_next).toBe(true);
    expect(result.next_cursor).toBe('m2');
  });
});
