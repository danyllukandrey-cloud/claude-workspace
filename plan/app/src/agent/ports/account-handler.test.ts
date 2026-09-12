// T43 -- Ports: DELETE /account handler, unit level (mocked Db, same
// convention as ../app/delete-account.test.ts and
// ../../cards/life-area-card/ports/card-handlers.test.ts -- no live
// Postgres/.env available in this sandbox).
//
// Contract (contracts/openapi.yaml, deleteAccount, /api/v1/account):
// - "204": Видалено, сесія завершена -- happy path, no response body.
// - "401": $ref Error -- турбота авторизаційного мідлвара (D-33), не цього
//   файлу (той самий підхід, що reports-handler.ts/rules-handler.ts вище в
//   цьому ж layer) -- тому цей файл не тестує 401 напряму, лише те, що сам
//   handler нічого не робить із userId крім прокидання далі.
//
// AC-17b (confirmation guard): контракт НЕ документує тіло запиту для цього
// ендпоінта -- опис прямо каже, що підтвердження (слово підтвердження)
// перевіряється на UI-рівні ДО виклику. Але app-шар (T39, delete-account.ts)
// усе одно вимагає явний `confirmed: boolean` як defense-in-depth (сам файл
// документує це в коментарі й тесті AC-17b). Тому ports-шар (цей файл)
// НЕ вирішує "завжди true" сам -- прокидає `confirmed`, отриманий від
// виклику, у use-case як є, той самий підхід, що createRule/updateCard
// прокидають body-поля, не вигадують значення. Це задокументована
// неоднозначність контракту (openapi.yaml не описує, звідки транспортний
// шар (T30) візьме це значення) -- відкрите питання для людини, не
// вирішується мовчки тут.
//
// AppError не перехоплюється тут (той самий підхід, що
// card-handlers.ts/rules-handler.ts) -- пропускається нагору як є, майбутній
// транспортний шар (T30) відповідає за .code/.message/.httpStatus.

import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from './account-handler';
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

describe('deleteAccount handler -- AC-17 happy path (204, no body)', () => {
  it('resolves with no value (204) after writing the audit row and deleting app_user', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [AUDIT_EVENT_ROW] }) // INSERT INTO agent_audit_event
      .mockResolvedValueOnce({ rows: [] }); // DELETE FROM app_user
    const db: Db = { query };

    const result = await deleteAccount(db, 'user-1', true);

    expect(result).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO agent_audit_event/);
    expect(query.mock.calls[1][0]).toMatch(/DELETE FROM app_user/);
    expect(query.mock.calls[1][1]).toEqual(['user-1']);
  });
});

describe('deleteAccount handler -- AC-17b confirmation guard, propagated as-is', () => {
  it('lets the use-case AppError (account.confirmation_required) pass through unmodified, before any write', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(deleteAccount(db, 'user-1', false)).rejects.toMatchObject({
      code: 'account.confirmation_required',
    });
    await expect(deleteAccount(db, 'user-1', false)).rejects.toBeInstanceOf(AppError);
    expect(query).not.toHaveBeenCalled();
  });
});
