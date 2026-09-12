// T17 -- App: confirmProposal use-case (AC-02/AC-03) -- оркеструє
// domain/proposal.ts (T8, confirmProposal -- перехід active -> confirmed) +
// infra/postgres-repo.ts (T13, updateProposal -- те саме джерело правди для
// "прочитати за id" (порожній патч) і для запису статусу) + life-area-card's
// createEntry (T18 тієї фічі) -- контракт (contracts/openapi.yaml,
// confirmProposal -- POST /proposals/{proposalId}/confirm).
//
// AC-02: активна пропозиція -> подія записується в картку через
// life-area-card's createEntry (ЦІЛКОМ делегується, agent сам НІКОЛИ не пише
// в entry/metric_block -- plan/app/CLAUDE.md, "app -> cards", той самий
// патерн, що ../../structure/app/close-card.ts делегує transferMetricBlock),
// а САМА пропозиція переходить у 'confirmed' лише ПІСЛЯ успішного запису --
// порядок навмисний: якщо запис у картку впаде, пропозиція лишається
// активною, не "confirmed без запису".
//
// AC-03 тут -- не буквальне "мовчання", те покриває Flow 5/dropProposal
// (інша задача); ця функція відповідає за симетричну половину domain-інваріанту
// "мовчазного запису не буває" (D-30): підтвердити можна ЛИШЕ активну
// пропозицію (domain/proposal.ts confirmProposal, Result.ok === false для
// будь-якого іншого статусу) -- вже 'confirmed'/'dropped' відхиляється з 409
// (`agent.proposal_not_active`, openapi.yaml), нічого не пишеться ні в
// entry, ні в саму пропозицію.
//
// Non-disclosure (AC-06, той самий код і для "не існує", і для "чужа",
// openapi.yaml 404 `agent.proposal_not_found`): читання скоуплене на
// user_id у самому SQL (updateProposal), тож рядок іншого користувача
// фізично відсутній у результаті, не відфільтрований згодом.
//
// DI (ADR-0004): db приходить ззовні, use-case сам з'єднання не створює.

import { confirmProposal as confirmDomainProposal } from '../domain/proposal';
import { updateProposal } from '../infra/postgres-repo';
import type { Db, ProposalRecord } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';
import { createEntry } from '../../cards/life-area-card/app/create-entry';

export interface ConfirmProposalInput {
  userId: string;
  proposalId: string;
  /** Час запису для life-area-card's createEntry (мс з епохи) -- дефолт `Date.now()`. */
  recordedAt?: number;
  sourceDeviceId?: string | null;
}

export async function confirmProposal(db: Db, input: ConfirmProposalInput): Promise<ProposalRecord> {
  // Порожній патч -- узгоджений спосіб "прочитати за id" у updateProposal
  // (postgres-repo.ts), скоуплений на user_id у самому SQL -- non-disclosure.
  const current = await updateProposal(db, input.userId, input.proposalId, {});
  if (!current) {
    throw new AppError('agent.proposal_not_found', 'Proposal not found', 404);
  }

  // AC-03 (симетрична половина, не Flow 5): лише активна пропозиція
  // переходить у confirmed -- та сама доменна перевірка, що вже покрита
  // domain/proposal.test.ts, тут лише розбирається `Result.ok`.
  const transition = confirmDomainProposal({
    id: current.id,
    userId: current.userId,
    cardId: current.cardId,
    metricBlockId: current.metricBlockId,
    status: current.status,
    sourceType: current.sourceType,
    rawInput: current.rawInput,
    proposedAmount: current.proposedAmount,
    proposedSummary: current.proposedSummary,
  });
  if (!transition.ok) {
    throw new AppError('agent.proposal_not_active', 'This proposal is no longer active', 409);
  }

  // Пропозиція без визначеної картки/блоку чи без величини не мала б дійти
  // сюди активною (AC-05 -- агент питає, перш ніж пропонувати конкретний
  // запис) -- захист на межі шару, а не тестований шлях цієї задачі
  // (AC-02/AC-03). Позначено як відкрите питання в підсумку задачі T17.
  if (!current.cardId || !current.metricBlockId || current.proposedAmount == null) {
    throw new AppError('agent.proposal_incomplete', 'Proposal is missing a card, metric block or amount to record', 409);
  }

  // AC-02: запис у картку -- ЦІЛКОМ делегований life-area-card, agent сам
  // ніколи не пише в entry/metric_block (plan/app/CLAUDE.md).
  await createEntry(db, {
    ownerUserId: input.userId,
    cardId: current.cardId,
    metricBlockId: current.metricBlockId,
    amount: current.proposedAmount,
    rawText: current.rawInput,
    sourceDeviceId: input.sourceDeviceId ?? null,
    recordedAt: input.recordedAt ?? Date.now(),
  });

  // Лише ПІСЛЯ успішного запису -- пропозиція стає 'confirmed' (порядок,
  // не косметика, див. коментар вгорі файлу).
  const confirmed = await updateProposal(db, input.userId, input.proposalId, { status: 'confirmed' });
  if (!confirmed) {
    // Рядок зник між читанням і записом (конкурентний confirm/drop) --
    // той самий 404, що і "не знайдено" вище, не мовчазний вигад нового коду.
    throw new AppError('agent.proposal_not_found', 'Proposal not found', 404);
  }
  return confirmed;
}
