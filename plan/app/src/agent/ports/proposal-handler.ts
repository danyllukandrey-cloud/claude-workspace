// T21 -- Ports: GET /proposals/active + POST /proposals/{proposalId}/confirm
// (docs/features/agent/contracts/openapi.yaml, operationId getActiveProposal /
// confirmProposal; spec.md AC-02/AC-03).
//
// Framework-agnostic (той самий підхід, що ../../structure/ports/
// layout-handlers.ts і ./rules-handler.ts) -- жоден HTTP-фреймворк ще не
// підключений у репо (T29/T30 підключать конкретний транспорт пізніше);
// кожен хендлер тут звичайна async-функція (db, ownerUserId, ...) ->
// Promise<...> точно контрактної форми при успіху, або дає AppError
// пройти нагору при помилці (transport-шар мапить AppError.httpStatus на
// реальну HTTP-відповідь, той самий патерн, що вже задокументований
// ../app/confirm.ts/../app/confirm.test.ts).
//
// getActiveProposal -- T21 deps: лише T17 (app/confirm.ts), жодного окремого
// app-таску для читання активної пропозиції -- той самий підхід, що
// rules-handler.ts listRules (ports-шар сам звертається до infra напряму,
// коли немає окремого app-use-case для простого читання).
//
// confirmProposal -- ЦІЛКОМ делегується у ../app/confirm.ts (T17, вже
// повністю юніт-тестований: AC-02 happy path -- запис у картку через
// life-area-card's createEntry + перехід у 'confirmed'; AC-03 -- лише
// активна пропозиція приймається, 404/409 через AppError). Цей файл лише:
// (1) перекладає параметри порту у ConfirmProposalInput, (2) мапить
// повернутий ProposalRecord у контрактний Proposal DTO, (3) НЕ ловить
// AppError -- 404 (`agent.proposal_not_found`) і 409
// (`agent.proposal_not_active`) проходять нагору без змін, точно як
// задокументовано в openapi.yaml.
//
// Мапінг полів: ProposalRecord (postgres-repo.ts) уже camelCase, прямий у
// Proposal-схему контракту -- лише Date-поля (createdAt/updatedAt)
// серіалізуються в ISO-рядок на межі порту (той самий підхід, що
// rules-handler.ts toRuleResponse).

import { findActiveProposalByUser } from '../infra/postgres-repo';
import type { Db, ProposalRecord } from '../infra/postgres-repo';
import { confirmProposal as confirmProposalUseCase } from '../app/confirm';
import type { ConfirmProposalInput } from '../app/confirm';

/** Точно форма схеми Proposal контракту (openapi.yaml). */
export interface ProposalResponse {
  id: string;
  cardId: string | null;
  metricBlockId: string | null;
  status: 'active' | 'confirmed' | 'dropped';
  sourceType: 'text' | 'attachment';
  rawInput: string;
  proposedAmount: number | null;
  proposedSummary: string;
  createdAt: string;
  updatedAt: string;
}

/** Точно форма схеми ActiveProposalResponse контракту. */
export interface ActiveProposalResponseDto {
  proposal: ProposalResponse | null;
}

function toProposalResponse(record: ProposalRecord): ProposalResponse {
  return {
    id: record.id,
    cardId: record.cardId,
    metricBlockId: record.metricBlockId,
    status: record.status,
    sourceType: record.sourceType,
    rawInput: record.rawInput,
    proposedAmount: record.proposedAmount,
    proposedSummary: record.proposedSummary,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * GET /api/v1/proposals/active -- домен-інваріант "одна активна пропозиція
 * на користувача" (§4 SAD, AC-03), забезпечений на рівні БД
 * (`uq_agent_proposal_active_user`) -- `findActiveProposalByUser` завжди дає
 * щонайбільше один рядок. `proposal: null`, якщо немає активної (щойно
 * підтверджена, відкинута, чи ще нічого не пропонувалось).
 */
export async function getActiveProposal(db: Db, ownerUserId: string): Promise<ActiveProposalResponseDto> {
  const active = await findActiveProposalByUser(db, ownerUserId);
  return { proposal: active ? toProposalResponse(active) : null };
}

export interface ConfirmProposalBody {
  /** Час запису для life-area-card's createEntry (мс з епохи) -- дефолт Date.now() у app-шарі. */
  recordedAt?: number;
  sourceDeviceId?: string | null;
}

/**
 * POST /api/v1/proposals/{proposalId}/confirm (AC-02) -- ЦІЛКОМ делегує
 * оркестрацію в ../app/confirm.ts (T17): запис події в картку через
 * life-area-card's createEntry, потім перехід agent_proposal у 'confirmed'.
 *
 * 404 `agent.proposal_not_found` -- пропозиції немає серед пропозицій ЦЬОГО
 * користувача (не існує, чи чужа -- AC-06 non-disclosure, той самий код для
 * обох випадків).
 * 409 `agent.proposal_not_active` -- пропозиція вже не активна
 * (`confirmed`/`dropped`) -- domain invariant "мовчазного запису не буває"
 * (D-30, AC-03).
 * Обидва коди -- AppError з ../app/confirm.ts, пропускаються нагору без змін.
 */
export async function confirmProposal(
  db: Db,
  ownerUserId: string,
  proposalId: string,
  body: ConfirmProposalBody = {}
): Promise<ProposalResponse> {
  const input: ConfirmProposalInput = {
    userId: ownerUserId,
    proposalId,
    recordedAt: body.recordedAt,
    sourceDeviceId: body.sourceDeviceId,
  };
  const confirmed = await confirmProposalUseCase(db, input);
  return toProposalResponse(confirmed);
}
