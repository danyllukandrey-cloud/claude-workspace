// T39 -- App: deleteAccount use-case, integration level (tracker.md T39 DoD):
// "Integration test: writes account_deleted audit row, then deletes app_user
// -- cascades into agent's own 6 tables plus life-area-card.card and
// structure.structure (FK CASCADE added 2026-08-29, migrations
// life-area-card/07 and structure/backend/03); missing confirmation flag
// rejected before any write".
//
// Мокований `Db` (vi.fn(), як archive-card.test.ts/postgres-repo.test.ts),
// не жива Neon -- пісочниця без .env/мережі (див. інструкцію задачі). Тест
// документує ОЧІКУВАНУ поведінку проти реальної бази: use-case НІКОЛИ не
// видаляє рядки по одному з agent'ових таблиць/card/structure вручну --
// єдиний `DELETE FROM app_user WHERE id = $1`, а каскад (ON DELETE CASCADE,
// migrations 1788614120305/1788631003274 для card/structure, плюс FK кожної
// з 6 таблиць агента на app_user) робить решту в самій PostgreSQL. Тому тут
// перевіряється SQL-текст і порядок викликів, не факт зникнення рядків.

import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from './delete-account';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const AUDIT_EVENT_ROW = {
  id: 'audit-1',
  user_id: 'user-1',
  event_type: 'account_deleted',
  subject_type: 'account',
  subject_id: null,
  detail: null,
  occurred_at: new Date('2026-09-12T00:00:00Z'),
};

describe('deleteAccount use-case -- AC-17b (confirmation guard)', () => {
  it('rejects a missing confirmation flag before any write (ADR-0006 sentinel Err, not a throw from domain)', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(deleteAccount(db, { userId: 'user-1', confirmed: false })).rejects.toMatchObject({
      code: 'account.confirmation_required',
    });
    await expect(deleteAccount(db, { userId: 'user-1', confirmed: false })).rejects.toBeInstanceOf(AppError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('deleteAccount use-case -- AC-17 (happy path, ordered writes)', () => {
  it('writes the account_deleted audit row, then deletes app_user -- in that order, cascading the rest', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [AUDIT_EVENT_ROW] }) // INSERT INTO agent_audit_event
      .mockResolvedValueOnce({ rows: [] }); // DELETE FROM app_user
    const db: Db = { query };

    await deleteAccount(db, { userId: 'user-1', confirmed: true });

    expect(query).toHaveBeenCalledTimes(2);

    // Крок 1 -- аудит-рядок account_deleted/account, ДО видалення app_user
    // (D-89: FK CASCADE на agent_audit_event.user_id інакше знищив би щойно
    // написаний рядок разом із рештою).
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO agent_audit_event/);
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['user-1', 'account_deleted', 'account'])
    );

    // Крок 2 -- єдиний DELETE на app_user за id; каскад (card/structure й
    // решта агентових таблиць) відбувається в самій базі через FK CASCADE,
    // use-case не видаляє їх вручну по одній.
    expect(query.mock.calls[1][0]).toMatch(/DELETE FROM app_user/);
    expect(query.mock.calls[1][1]).toEqual(['user-1']);
  });

  it('never deletes app_user before the audit row is written', async () => {
    const order: string[] = [];
    const query = vi.fn().mockImplementation((text: string) => {
      order.push(text.includes('agent_audit_event') ? 'audit' : 'delete_user');
      if (text.includes('agent_audit_event')) {
        return Promise.resolve({ rows: [AUDIT_EVENT_ROW] });
      }
      return Promise.resolve({ rows: [] });
    });
    const db: Db = { query };

    await deleteAccount(db, { userId: 'user-1', confirmed: true });

    expect(order).toEqual(['audit', 'delete_user']);
  });
});
