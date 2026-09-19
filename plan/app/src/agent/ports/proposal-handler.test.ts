// T21 -- Ports: GET /proposals/active + POST /proposals/{id}/confirm
// (docs/features/agent/contracts/openapi.yaml, operationId getActiveProposal /
// confirmProposal; spec.md AC-02/AC-03).
//
// Unit-тест (без мережі), той самий підхід, що ../../structure/ports/
// layout-handlers.test.ts і ./rules-handler.test.ts:
// - getActiveProposal (deps: лише T13 infra, жодного app-таску для нього --
//   той самий підхід, що rules-handler.ts listRules) підробляємо через
//   `db.query` (vi.fn), реальні рядки з findActiveProposalByUser (T13).
// - confirmProposal (deps: T17 app/confirm.ts, ВЖЕ повністю юніт-тестований у
//   ../app/confirm.test.ts -- fetch/createEntry/update-порядок, AC-02/AC-03
//   доменний перехід) тут МОКНУТИЙ на межі порту -- цей тест перевіряє лише,
//   що порт коректно ДЕЛЕГУЄ у app-шар, мапить ProposalRecord -> контрактний
//   Proposal DTO (camelCase, ISO-рядки), і дає AppError (404/409) пройти
//   нагору незмінно -- не повторює app-шарове тестування.
//
// DoD (tasks.json T21): "Handlers return 200/404/409 exactly per contract
// (agent.proposal_not_found, agent.proposal_not_active)".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

vi.mock('../app/confirm', () => ({
  confirmProposal: vi.fn(),
}));

import { confirmProposal as confirmProposalUseCase } from '../app/confirm';
import { getActiveProposal, confirmProposal } from './proposal-handler';

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

function proposalRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROPOSAL_ID,
    userId: USER_ID,
    cardId: 'card-1',
    metricBlockId: 'block-1',
    status: 'confirmed',
    sourceType: 'text',
    rawInput: 'пробіг 5 км',
    proposedAmount: 5,
    proposedSummary: '5 км бігу',
    createdAt: new Date('2026-02-01T12:00:00Z'),
    updatedAt: new Date('2026-02-01T12:05:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getActiveProposal handler (GET /api/v1/proposals/active)', () => {
  it('returns { proposal: null } when the user has no active proposal', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    const result = await getActiveProposal(db, USER_ID);

    expect(result).toEqual({ proposal: null });
    expect(query.mock.calls[0][1]).toEqual([USER_ID]);
  });

  it('returns the contract-shaped Proposal (camelCase, ISO dates) when one is active', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [proposalRow()] });
    const db: Db = { query };

    const result = await getActiveProposal(db, USER_ID);

    expect(result.proposal).toEqual({
      id: PROPOSAL_ID,
      cardId: 'card-1',
      metricBlockId: 'block-1',
      status: 'active',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedAmount: 5,
      proposedSummary: '5 км бігу',
      createdAt: '2026-02-01T12:00:00.000Z',
      updatedAt: '2026-02-01T12:00:00.000Z',
    });
  });
});

describe('confirmProposal handler (POST /api/v1/proposals/{proposalId}/confirm, AC-02)', () => {
  it('delegates to the app-layer confirmProposal use-case and returns a contract-shaped Proposal', async () => {
    const db: Db = { query: vi.fn() };
    (confirmProposalUseCase as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      proposalRecord({ status: 'confirmed' })
    );

    const result = await confirmProposal(db, USER_ID, PROPOSAL_ID);

    // Review 2026-09-12: openapi.yaml не визначає жодного тіла запиту для
    // confirmProposal -- ані `recordedAt`, ані `sourceDeviceId` більше не
    // проходять через порт-шар, симетрично entry-handlers.ts createEntry
    // (сервер сам підставляє момент запису в ../app/confirm.ts).
    // Лог дій: recordAction -- 3-й опційний параметр, тут не переданий
    // (undefined), той самий підхід, що інші опційні DI-колаборатори.
    expect(confirmProposalUseCase).toHaveBeenCalledWith(
      db,
      {
        userId: USER_ID,
        proposalId: PROPOSAL_ID,
      },
      undefined
    );
    expect(result).toEqual({
      id: PROPOSAL_ID,
      cardId: 'card-1',
      metricBlockId: 'block-1',
      status: 'confirmed',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedAmount: 5,
      proposedSummary: '5 км бігу',
      createdAt: '2026-02-01T12:00:00.000Z',
      updatedAt: '2026-02-01T12:05:00.000Z',
    });
  });

  // AC-03/404 -- non-disclosure: рядок не знайдено серед пропозицій ЦЬОГО
  // користувача (не існує, чи чужа) -- той самий agent.proposal_not_found,
  // AppError з app-шару (T17) пропускається нагору незмінно.
  it('propagates agent.proposal_not_found (404) from the app-layer unchanged', async () => {
    (confirmProposalUseCase as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.proposal_not_found', 'Proposal not found', 404)
    );
    const db: Db = { query: vi.fn() };

    await expect(confirmProposal(db, USER_ID, 'unknown')).rejects.toMatchObject({
      code: 'agent.proposal_not_found',
      httpStatus: 404,
    });
  });

  // AC-03/409 -- вже не активна (confirmed/dropped) -- domain invariant
  // "мовчазного запису не буває" (D-30), AppError з app-шару пропускається
  // нагору незмінно.
  it('propagates agent.proposal_not_active (409) from the app-layer unchanged', async () => {
    (confirmProposalUseCase as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('agent.proposal_not_active', 'This proposal is no longer active', 409)
    );
    const db: Db = { query: vi.fn() };

    await expect(confirmProposal(db, USER_ID, PROPOSAL_ID)).rejects.toMatchObject({
      code: 'agent.proposal_not_active',
      httpStatus: 409,
    });
  });
});
