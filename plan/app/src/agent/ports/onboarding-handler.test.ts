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

import { describe, it, expect, vi } from 'vitest';
import { getOnboardingStatus } from './onboarding-handler';
import type { Db } from '../infra/postgres-repo';

const USER = 'user-1';

function fakeOnboardingDb(opts: { hasExistingMessage: boolean }): Db {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('chat_message') && sql.startsWith('SELECT')) {
      expect(params).toEqual([USER]);
      return { rows: opts.hasExistingMessage ? [{ exists: true }] : [] };
    }
    if (text.includes('chat_message') && sql.startsWith('INSERT')) {
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
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
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

    const insertCall = (db.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) =>
      (call[0] as string).trim().toUpperCase().startsWith('INSERT')
    );
    expect(insertCall).toBeDefined();
  });

  // DoD -- кожен наступний виклик того самого користувача: жодного нового
  // запису, welcomeShown лишається true, message тепер null.
  it('returns welcomeShown:true and message:null on every later call, without writing anything new', async () => {
    const db = fakeOnboardingDb({ hasExistingMessage: true });

    const status = await getOnboardingStatus(db, USER);

    expect(status).toEqual({ welcomeShown: true, message: null });

    const insertCall = (db.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) =>
      (call[0] as string).trim().toUpperCase().startsWith('INSERT')
    );
    expect(insertCall).toBeUndefined();
  });
});
