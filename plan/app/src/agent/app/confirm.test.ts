// T17 -- App: confirm use-case (AC-02/AC-03).
// RED (unit level, mocked Db + mocked life-area-card's createEntry -- test-plan.md
// marks AC-02 as "integration"; Docker/Neon недоступні в цьому середовищі, тож
// цей файл робить задачу TDD-водимою локально без реальної БД, той самий стиль,
// що ../../structure/app/close-card.test.ts (fake `Db.query` через
// mockResolvedValueOnce-ланцюжок -- той самий підхід, що
// ../../cards/life-area-card/app/create-entry.test.ts -- + мокнутий
// cross-feature use-case).
//
// Contract (contracts/openapi.yaml, confirmProposal -- POST
// /proposals/{proposalId}/confirm, БЕЗ тіла запиту):
// - AC-02: активна пропозиція -> записує подію в картку через life-area-card's
//   createEntry (ЦІЛКОМ делегується, agent сам НІКОЛИ не пише в entry/metric_block,
//   plan/app/CLAUDE.md app -> cards) і переводить agent_proposal у 'confirmed'
//   атомарним SQL-переходом (`confirmActiveProposal`, WHERE status = 'active').
// - AC-03/409 (`agent.proposal_not_active`): пропозиція існує, але вже не
//   активна (`confirmed`/`dropped`) -- відхиляємо, нічого не пишемо ні в
//   entry, ні в саму пропозицію (домен-інваріант "мовчазного запису не буває",
//   D-30, вже перевірений на рівні domain/proposal.ts confirmProposal -- цей
//   тест лише перевіряє, що app-шар коректно РОЗБИРАЄ `Result.ok === false` і
//   не викликає жодного подальшого запису).
// - 404 (`agent.proposal_not_found`): пропозиції немає серед пропозицій ЦЬОГО
//   користувача -- той самий код і для "не існує", і для "чужа" (AC-06
//   non-disclosure, той самий патерн, що life-area-card's create-entry.ts).
//
// Review 2026-09-12 (три знахідки, виправлені разом, той самий файл):
// 1. data-model.md event_type enum вимагає `proposal_confirmed` при кожному
//    успішному підтвердженні -- перевіряється нижче поруч зі створенням entry.
// 2. Double-confirm race: попередня версія читала статус, перевіряла в
//    пам'яті, і лише ПОТІМ писала 'confirmed' без предиката на рівні SQL --
//    два одночасні confirm могли обидва пройти перевірку і обидва викликати
//    createEntry. Окремий describe нижче симулює це через послідовність
//    відповідей мокнутого `db.query`.
// 3. Контракт не визначає жодного тіла запиту -- recordedAt/sourceDeviceId
//    більше не приймаються ззовні; confirm.ts сам підставляє момент виклику
//    (перевіряється нижче через `expect.any(Number)` у межах [before, after]).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

vi.mock('../../cards/life-area-card/app/create-entry', () => ({
  createEntry: vi.fn(),
}));

import { createEntry } from '../../cards/life-area-card/app/create-entry';
import { confirmProposal } from './confirm';

const USER_ID = 'user-1';
const PROPOSAL_ID = 'proposal-1';

function proposalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROPOSAL_ID,
    user_id: USER_ID,
    card_id: 'card-1',
    metric_block_id: 'block-1',
    status: 'active',
    source_type: 'text',
    raw_input: 'пробіг 5 км',
    proposed_amount: '5',
    proposed_summary: '5 км бігу',
    created_at: new Date('2026-02-01T12:00:00Z'),
    updated_at: new Date('2026-02-01T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirmProposal -- AC-02: активна пропозиція записує подію, атомарно стає confirmed, і лишає аудит-слід', () => {
  it("delegates to life-area-card's createEntry, flips the proposal to confirmed via the SQL-level guard, and logs a proposal_confirmed audit event", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'active' })] }) // 1: read by id (updateProposal, empty patch)
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'confirmed' })] }) // 2: confirmActiveProposal (guarded UPDATE)
      .mockResolvedValueOnce({ rows: [{ id: 'audit-1' }] }); // 3: insertAuditEvent
    const db: Db = { query };
    (createEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1', status: 'confirmed' });

    const before = Date.now();
    const result = await confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID });
    const after = Date.now();

    expect(result.status).toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(3);

    // Finding 2: атомарний перехід статусу -- SQL сам несе предикат
    // `status = 'active'`, не лише перевірку в пам'яті.
    expect(query.mock.calls[1][0]).toMatch(/UPDATE agent_proposal/);
    expect(query.mock.calls[1][0]).toMatch(/status = 'active'/);
    expect(query.mock.calls[1][1]).toEqual([PROPOSAL_ID, USER_ID]);

    // Finding 3: контракт (openapi.yaml) не приймає жодного тіла --
    // sourceDeviceId завжди null, recordedAt -- момент виклику, не клієнтське
    // значення (симетрично entry-handlers.ts createEntry).
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledWith(db, {
      ownerUserId: USER_ID,
      cardId: 'card-1',
      metricBlockId: 'block-1',
      amount: 5,
      rawText: 'пробіг 5 км',
      sourceDeviceId: null,
      recordedAt: expect.any(Number),
    });
    const recordedAt = (createEntry as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].recordedAt;
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(after);

    // Finding 1: data-model.md event_type enum -- proposal_confirmed
    // записується поруч, симетрично handle-message.ts
    // (proposal_created/updated/dropped).
    expect(query.mock.calls[2][0]).toMatch(/INSERT INTO agent_audit_event/);
    expect(query.mock.calls[2][1]).toEqual(
      expect.arrayContaining(['proposal_confirmed', 'proposal', PROPOSAL_ID])
    );
  });
});

describe('confirmProposal -- double-confirm race (Review 2026-09-12, Finding 2)', () => {
  it('rejects the losing concurrent confirm with 409 agent.proposal_not_active and never calls createEntry for it', async () => {
    const query = vi
      .fn()
      // Перший (виграшний) confirm: читання бачить 'active', guarded UPDATE
      // справді зачіпає рядок, аудит-подія пишеться.
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'confirmed' })] })
      .mockResolvedValueOnce({ rows: [{ id: 'audit-1' }] })
      // Другий (програшний) confirm: його ВЛАСНЕ читання теж застає 'active'
      // -- симулюємо, що обидва запити стартували майже одночасно, до того,
      // як перший встиг записати -- але коли доходить до ЙОГО guarded UPDATE,
      // рядок у "базі" вже 'confirmed' (перший устиг раніше), тож ця UPDATE
      // не зачіпає жодного рядка.
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };
    (createEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1', status: 'confirmed' });

    const first = await confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID });
    expect(first.status).toBe('confirmed');

    await expect(confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID })).rejects.toMatchObject({
      code: 'agent.proposal_not_active',
      httpStatus: 409,
    });

    // Уся суть виправлення: лише ВИГРАШНИЙ confirm доходить до createEntry --
    // програшний відхиляється SQL-предикатом (`confirmActiveProposal`'s
    // `AND status = 'active'`) РАНІШЕ, ніж встигає записати другий запис у
    // картку для тієї самої пропозиції.
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(5);
  });
});

describe('confirmProposal -- AC-03: непідтверджена/уже вирішена пропозиція -- відхилення без запису', () => {
  it('rejects confirming an already-confirmed proposal with agent.proposal_not_active (409) and writes nothing', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [proposalRow({ status: 'confirmed' })] });
    const db: Db = { query };

    await expect(confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID })).rejects.toMatchObject({
      code: 'agent.proposal_not_active',
      httpStatus: 409,
    });

    expect(createEntry).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // лише читання -- жодного UPDATE
  });

  it('rejects confirming a dropped proposal with agent.proposal_not_active (409) and writes nothing', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [proposalRow({ status: 'dropped' })] });
    const db: Db = { query };

    await expect(confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID })).rejects.toMatchObject({
      code: 'agent.proposal_not_active',
      httpStatus: 409,
    });

    expect(createEntry).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects confirming a proposal that does not exist for this user with agent.proposal_not_found (404) -- non-disclosure, same code as a foreign proposal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(confirmProposal(db, { userId: USER_ID, proposalId: 'unknown' })).rejects.toMatchObject({
      code: 'agent.proposal_not_found',
      httpStatus: 404,
    });
    await expect(confirmProposal(db, { userId: USER_ID, proposalId: 'unknown' })).rejects.toBeInstanceOf(AppError);

    expect(createEntry).not.toHaveBeenCalled();
  });
});
