// T24 -- Ports: GET /onboarding handler.
// RED (unit level, mocked Db -- test-plan.md-style: real DB round-trip is out
// of scope for this task's files_hint (onboarding-handler.ts only) and
// unavailable in this sandbox (no live Postgres/.env). This suite documents
// the intended real-DB behaviour against a mocked Db, the same fake
// `Db.query` (vi.fn) + SQL-text routing convention already used throughout
// ../infra/postgres-repo.test.ts and ../../structure/ports/layout-handlers.test.ts.
//
// Contract (contracts/openapi.yaml, getOnboardingStatus):
// - AC-13: перший виклик для нового користувача (немає жодного chat_message)
//   СТВОРЮЄ вітальний chat_message (role=agent) і повертає його --
//   `welcomeShown: true, message: <Message>`.
// - Кожен наступний виклик того самого користувача (уже є хоч один
//   chat_message) НЕ пише нічого нового -- `welcomeShown: true,
//   message: null` (історію читають через GET /messages, sad.md §6 Flow 15).
// - DoD: "creates and returns the welcome chat_message on a user's first
//   call, welcomeShown:true+message:null on every later call".
//
// Review 2026-09-12 (race fix): handler тепер робить ОДИН виклик
// insertWelcomeMessageIfFirst (postgres-repo.ts) -- атомарний
// `INSERT ... SELECT ... WHERE NOT EXISTS` -- замість check-then-insert
// (hasAnyChatMessage + insertChatMessage) двома окремими round trip.
// Останній describe нижче доводить сáме це стейтфулим фейковим Db (той
// самий підхід -- мутабельний спільний стан у межах сценарію -- що
// ../cross-cutting.test.ts): два "одночасні" виклики getOnboardingStatus
// для одного user_id мають дати РІВНО один вставлений рядок, а не два.

import { describe, it, expect, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import { getOnboardingStatus } from './onboarding-handler';
import type { Db } from '../infra/postgres-repo';

const USER = 'user-1';

/**
 * Фейкова insertWelcomeMessageIfFirst-семантика без стану: `hasExistingMessage`
 * фіксований наперед, симулює або "перший виклик" (INSERT ... SELECT ...
 * WHERE NOT EXISTS повертає рядок), або "вже онбордений" (той самий запит
 * повертає 0 рядків) -- одним і тим самим SQL-текстом, як у реальній
 * postgres-repo.ts.
 */
function fakeOnboardingDb(opts: { hasExistingMessage: boolean }): Db {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const sql = text.trim().toUpperCase();
    expect(sql).toContain('WHERE NOT EXISTS');

    if (opts.hasExistingMessage) {
      return { rows: [] };
    }

    const [id, userId, role, content, sessionDate] = params as [string, string, string, string, string];
    expect(userId).toBe(USER);
    expect(role).toBe('agent');
    return {
      rows: [
        {
          id,
          user_id: userId,
          role,
          content,
          session_date: sessionDate,
          created_at: new Date('2026-09-12T09:00:00Z'),
        },
      ],
    };
  });
  return { query: query as unknown as Db['query'] };
}

describe('getOnboardingStatus handler', () => {
  // AC-13 happy path -- перший виклик нового користувача створює вітальний
  // chat_message (role=agent) і повертає його у формі контракту Message
  // (camelCase, createdAt як ISO-рядок).
  it('creates and returns the welcome chat_message on the first call for a new user', async () => {
    const db = fakeOnboardingDb({ hasExistingMessage: false });

    const status = await getOnboardingStatus(db, USER);

    expect(status.welcomeShown).toBe(true);
    expect(status.message).toEqual({
      id: expect.any(String),
      role: 'agent',
      content: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  // DoD -- кожен наступний виклик того самого користувача: жодного нового
  // запису, welcomeShown лишається true, message тепер null. На рівні SQL
  // це той самий запит (WHERE NOT EXISTS), що просто не знаходить рядків
  // для вставки -- не окрема гілка коду в handler'і.
  it('returns welcomeShown:true and message:null on every later call, without writing anything new', async () => {
    const db = fakeOnboardingDb({ hasExistingMessage: true });

    const status = await getOnboardingStatus(db, USER);

    expect(status).toEqual({ welcomeShown: true, message: null });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('AC-13 race fix -- two concurrent onboarding calls insert exactly one welcome message', () => {
  /**
   * Стейтфулий фейковий Db (той самий підхід, що ../cross-cutting.test.ts):
   * мутабельний масив рядків, спільний у межах сценарію. Відтворює
   * атомарність `INSERT ... SELECT ... WHERE NOT EXISTS` -- перевірка й
   * запис відбуваються без переривання всередині одного виклику query(),
   * так само як усередині одного SQL-запиту в реальній базі: другий виклик
   * бачить рядок, вставлений першим, і не вставляє нічого.
   */
  function statefulChatMessageDb(): Db {
    const rows: Record<string, unknown>[] = [];

    const query = async <T extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = []
    ): Promise<{ rows: T[] }> => {
      const sql = text.trim().toUpperCase();
      if (!sql.includes('WHERE NOT EXISTS')) {
        throw new Error(`Непередбачений запит у тесті гонки: ${text}`);
      }

      const [id, userId, role, content, sessionDate] = params as [string, string, string, string, string];
      const alreadyExists = rows.some((r) => r.user_id === userId);
      if (alreadyExists) {
        return { rows: [] as unknown as T[] };
      }

      const row = { id, user_id: userId, role, content, session_date: sessionDate, created_at: new Date('2026-09-12T09:00:00Z') };
      rows.push(row);
      return { rows: [row] as unknown as T[] };
    };

    return { query, __rows: rows } as Db & { __rows: Record<string, unknown>[] };
  }

  it('exactly one of two concurrent calls inserts a row; the loser gets welcomeShown:true/message:null, not an error', async () => {
    const db = statefulChatMessageDb() as Db & { __rows: Record<string, unknown>[] };

    const [first, second] = await Promise.all([getOnboardingStatus(db, USER), getOnboardingStatus(db, USER)]);

    // Точно один рядок вставлено в базу, попри два одночасні виклики.
    expect(db.__rows).toHaveLength(1);
    expect(db.__rows[0]?.user_id).toBe(USER);

    // Точно один із двох результатів отримав повідомлення -- інший програв
    // гонку й отримав welcomeShown:true/message:null (не throw, не 500).
    const results = [first, second];
    const withMessage = results.filter((r) => r.message !== null);
    const withoutMessage = results.filter((r) => r.message === null);

    expect(withMessage).toHaveLength(1);
    expect(withoutMessage).toHaveLength(1);
    expect(withMessage[0]?.welcomeShown).toBe(true);
    expect(withoutMessage[0]).toEqual({ welcomeShown: true, message: null });
  });

  it('a third call after the race has settled still sees the single existing row and writes nothing new', async () => {
    const db = statefulChatMessageDb() as Db & { __rows: Record<string, unknown>[] };

    await Promise.all([getOnboardingStatus(db, USER), getOnboardingStatus(db, USER)]);
    const third = await getOnboardingStatus(db, USER);

    expect(third).toEqual({ welcomeShown: true, message: null });
    expect(db.__rows).toHaveLength(1);
  });
});
