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
// /proposals/{proposalId}/confirm):
// - AC-02: активна пропозиція -> записує подію в картку через life-area-card's
//   createEntry (ЦІЛКОМ делегується, agent сам НІКОЛИ не пише в entry/metric_block,
//   plan/app/CLAUDE.md app -> cards) і переводить agent_proposal у 'confirmed'.
// - AC-03/409 (`agent.proposal_not_active`): пропозиція існує, але вже не
//   активна (`confirmed`/`dropped`) -- відхиляємо, нічого не пишемо ні в
//   entry, ні в саму пропозицію (домен-інваріант "мовчазного запису не буває",
//   D-30, вже перевірений на рівні domain/proposal.ts confirmProposal -- цей
//   тест лише перевіряє, що app-шар коректно РОЗБИРАЄ `Result.ok === false` і
//   не викликає жодного подальшого запису).
// - 404 (`agent.proposal_not_found`): пропозиції немає серед пропозицій ЦЬОГО
//   користувача -- той самий код і для "не існує", і для "чужа" (AC-06
//   non-disclosure, той самий патерн, що life-area-card's create-entry.ts).

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

describe('confirmProposal -- AC-02: активна пропозиція записує подію і стає confirmed', () => {
  it('delegates to life-area-card\'s createEntry and marks the proposal confirmed', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'active' })] }) // fetch by id (updateProposal, no fields)
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'confirmed' })] }); // UPDATE ... status = 'confirmed'
    const db: Db = { query };
    (createEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1', status: 'confirmed' });

    const result = await confirmProposal(db, { userId: USER_ID, proposalId: PROPOSAL_ID, recordedAt: 1_000 });

    expect(result.status).toBe('confirmed');
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledWith(db, {
      ownerUserId: USER_ID,
      cardId: 'card-1',
      metricBlockId: 'block-1',
      amount: 5,
      rawText: 'пробіг 5 км',
      sourceDeviceId: null,
      recordedAt: 1_000,
    });

    // Записуємо подію ДО того, як позначаємо пропозицію confirmed (DoD:
    // "records the entry ... and marks it confirmed" -- саме в цьому порядку).
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE agent_proposal/);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['confirmed']));
  });

  it('passes sourceDeviceId through to createEntry when provided', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [proposalRow({ status: 'confirmed' })] });
    const db: Db = { query };
    (createEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1', status: 'confirmed' });

    await confirmProposal(db, {
      userId: USER_ID,
      proposalId: PROPOSAL_ID,
      recordedAt: 1_000,
      sourceDeviceId: 'device-a',
    });

    expect(createEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ sourceDeviceId: 'device-a' })
    );
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
