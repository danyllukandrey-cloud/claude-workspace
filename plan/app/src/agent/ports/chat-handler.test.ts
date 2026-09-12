// T20 -- Ports: GET/POST /messages handlers (docs/features/agent/contracts/openapi.yaml,
// operationId listMessages / createMessage; spec.md AC-01/AC-02b/AC-03/AC-04/AC-05/AC-09/
// AC-10/AC-10b/AC-15/AC-19/AC-19b).
//
// Той самий підхід, що ../ports/proposal-handler.test.ts: createMessage делегує
// оркестрацію ВЖЕ юніт-тестованому ../app/handle-message.ts (T16, мокнутий тут на
// межі порту) -- цей тест перевіряє лише (1) rate-limit перевірку ДО виклику
// handleMessage, (2) мапінг HandleMessageResult -> контрактний MessageTurn DTO,
// (3) запис обох реплік ходу в chat_message ПІСЛЯ успішного виклику (AC-15), і
// (4) що AppError (422/503) з handleMessage проходить нагору незмінно, без
// жодного запису chat_message у цих гілках -- не повторює app-шарове тестування
// (уже покрите ../app/handle-message.test.ts).
//
// DoD (tasks.json T20): "Handlers return the contract shapes exactly: 201
// MessageTurn, 422 agent.attachment_unrecognized, 429 agent.rate_limited, 503
// agent.llm_unavailable; attachment field accepts document/spreadsheet MIME
// types, not just photo".

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

  it('propagates agent.attachment_unrecognized (422) from handleMessage unchanged, persisting nothing (AC-10b/AC-19b)', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.attachment_unrecognized', "Couldn't read this attachment", 422)
    );

    await expect(
      createMessage(db, askClaude, USER_ID, { content: null, attachment: { mediaType: 'application/zip', base64Data: 'AA==' } }, { now: NOW })
    ).rejects.toMatchObject({ code: 'agent.attachment_unrecognized', httpStatus: 422 });

    // Лише rate-limit count -- жодного insertChatMessage після кинутого винятку.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('propagates agent.llm_unavailable (503) from handleMessage unchanged, persisting nothing (Critical flow 2)', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const db: Db = { query };
    const askClaude: AskClaude = vi.fn();

    (handleMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.llm_unavailable', 'The agent is temporarily unavailable', 503)
    );

    await expect(createMessage(db, askClaude, USER_ID, { content: 'привіт' }, { now: NOW })).rejects.toMatchObject({
      code: 'agent.llm_unavailable',
      httpStatus: 503,
    });
    expect(query).toHaveBeenCalledTimes(1);
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
