// T17 -- App: confirmProposal use-case (AC-02/AC-03) -- оркеструє
// domain/proposal.ts (T8, confirmProposal -- перехід active -> confirmed) +
// infra/postgres-repo.ts (T13, updateProposal -- те саме джерело правди для
// "прочитати за id" (порожній патч); confirmActiveProposal -- атомарний
// перехід статусу) + life-area-card's createEntry (T18 тієї фічі) --
// контракт (contracts/openapi.yaml, confirmProposal -- POST
// /proposals/{proposalId}/confirm, БЕЗ тіла запиту -- жодного клієнтського
// recordedAt/sourceDeviceId, симетрично рішенню
// ../../cards/life-area-card/ports/entry-handlers.ts createEntry: контракт
// мовчить про час запису -- сервер сам підставляє `Date.now()` у момент
// прийому запиту, а не довіряє клієнтському значенню).
//
// AC-02: активна пропозиція -> подія записується в картку через
// life-area-card's createEntry (ЦІЛКОМ делегується, agent сам НІКОЛИ не пише
// в entry/metric_block -- plan/app/CLAUDE.md, "app -> cards", той самий
// патерн, що ../../structure/app/close-card.ts делегує transferMetricBlock).
//
// Review 2026-09-12 (double-confirm race, AC-02/AC-03) переставив порядок
// двох записів щодо попередньої версії цього файлу: атомарний перехід
// статусу (`confirmActiveProposal`, WHERE status = 'active' у самому SQL)
// тепер відбувається ПЕРЕД записом у картку, не після. Причина -- лише
// такий порядок дає змогу відмовити програвшому конкуренту ДО того, як він
// встигне викликати createEntry (два одночасні confirm, або клієнтський
// retry, інакше обидва проходять застарілу перевірку в пам'яті й обидва
// пишуть запис -- саме цей баг і виправляється). Інваріант "не буває
// 'confirmed' без запису" (задум попередньої версії коментаря) і далі
// діє -- тепер його забезпечує НЕ порядок кроків у цій функції, а сама
// огортаюча транзакція композиційного кореня (`deps.withTransaction`,
// server/app.ts, server/db.ts BEGIN/.../ROLLBACK при будь-якому винятку):
// якщо createEntry впаде після успішного переходу статусу, відкочується
// ВСЯ транзакція, включно з переходом статусу й аудит-подією нижче --
// пропозиція повертається в 'active', не лишається "confirmed без запису".
//
// AC-03 тут -- не буквальне "мовчання", те покриває Flow 5/dropProposal
// (інша задача); ця функція відповідає за симетричну половину domain-інваріанту
// "мовчазного запису не буває" (D-30): підтвердити можна ЛИШЕ активну
// пропозицію (domain/proposal.ts confirmProposal, Result.ok === false для
// будь-якого іншого статусу, це швидкий шлях за першим читанням) І лише
// якщо атомарний SQL-перехід (`confirmActiveProposal`) справді зачепив
// рядок (повільний, але правильний шлях під конкуренцією) -- обидва
// відхиляються з тим самим 409 (`agent.proposal_not_active`, openapi.yaml),
// нічого не пишеться ні в entry, ні в саму пропозицію.
//
// Non-disclosure (AC-06, той самий код і для "не існує", і для "чужа",
// openapi.yaml 404 `agent.proposal_not_found`): читання скоуплене на
// user_id у самому SQL (updateProposal/confirmActiveProposal), тож рядок
// іншого користувача фізично відсутній у результаті, не відфільтрований
// згодом.
//
// data-model.md event_type enum і sad.md ("кожна зміна стану пропозиції
// пише аудит-подію") вимагають `proposal_confirmed` тут так само, як
// handle-message.ts вже пише `proposal_created`/`proposal_updated`/
// `proposal_dropped` -- запис одразу після успішного атомарного переходу
// статусу, в тому самому db/транзакції, що вже в скоупі.
//
// DI (ADR-0004): db приходить ззовні, use-case сам з'єднання не створює.

import { confirmProposal as confirmDomainProposal } from '../domain/proposal';
import { updateProposal, confirmActiveProposal, insertAuditEvent } from '../infra/postgres-repo';
import type { Db, ProposalRecord } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';
import { createEntry } from '../../cards/life-area-card/app/create-entry';

export interface ConfirmProposalInput {
  userId: string;
  proposalId: string;
}

/**
 * Лог дій (Андрій: "тупо пишемо кожну дію -- час, дія, все.") -- сигнатура
 * збігається з ./record-action.ts's `recordAction`. НЕ прокидається в
 * createEntry нижче (life-area-card/app/create-entry.ts) -- інакше
 * підтвердження пропозиції лишило б у Лозі два рядки на одну дію
 * користувача (запис у картку + підтвердження); цей файл логує одним
 * рядком за обидва кроки.
 */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function confirmProposal(db: Db, input: ConfirmProposalInput, recordAction?: RecordAction): Promise<ProposalRecord> {
  // Порожній патч -- узгоджений спосіб "прочитати за id" у updateProposal
  // (postgres-repo.ts), скоуплений на user_id у самому SQL -- non-disclosure.
  const current = await updateProposal(db, input.userId, input.proposalId, {});
  if (!current) {
    throw new AppError('agent.proposal_not_found', 'Proposal not found', 404);
  }

  // AC-03 (швидкий шлях за щойно прочитаним станом, не гарантія під
  // конкуренцією -- ту дає лише SQL-перехід нижче): лише активна пропозиція
  // може перейти в confirmed -- та сама доменна перевірка, що вже покрита
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

  // Атомарний перехід статусу -- ПЕРШИЙ реальний запис (не лічильник вище).
  // WHERE status = 'active' у самому SQL (postgres-repo.ts) -- єдине, що
  // насправді захищає від подвійного confirm під конкуренцією: два
  // одночасні виклики можуть обидва пройти перевірку в пам'яті вище (обидва
  // читали рядок ДО того, як хтось із них записав), але лише ОДИН з них
  // справді зачепить рядок цим UPDATE.
  const confirmed = await confirmActiveProposal(db, input.userId, input.proposalId);
  if (!confirmed) {
    // Програли гонитву між читанням вище і цим UPDATE (інший запит устиг
    // підтвердити чи відкинути першим) -- той самий 409, що і швидкий шлях
    // вище, не новий код. Нічого ще не записано в картку -- createEntry
    // нижче не викликається.
    throw new AppError('agent.proposal_not_active', 'This proposal is no longer active', 409);
  }

  // data-model.md event_type enum / sad.md crosscutting events: кожна зміна
  // стану пропозиції лишає аудит-слід (handle-message.ts вже пише
  // proposal_created/updated/dropped) -- одразу після успішного переходу,
  // в тій самій транзакції, що й усе інше тут.
  await insertAuditEvent(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    eventType: 'proposal_confirmed',
    subjectType: 'proposal',
    subjectId: confirmed.id,
  });

  // AC-02: запис у картку -- ЦІЛКОМ делегований life-area-card, agent сам
  // ніколи не пише в entry/metric_block (plan/app/CLAUDE.md). Контракт
  // (openapi.yaml) не документує recordedAt для confirmProposal -- як і
  // entry-handlers.ts createEntry, сервер сам підставляє момент прийому
  // запиту, не приймає час від клієнта. Якщо цей запис впаде, уся
  // транзакція (server/db.ts withTransaction) відкочується разом із
  // переходом статусу й аудит-подією вище -- пропозиція лишається
  // 'active', не "confirmed без запису" (див. коментар вгорі файлу).
  await createEntry(db, {
    ownerUserId: input.userId,
    cardId: current.cardId,
    metricBlockId: current.metricBlockId,
    amount: current.proposedAmount,
    rawText: current.rawInput,
    sourceDeviceId: null,
    recordedAt: Date.now(),
  });

  if (recordAction) {
    await recordAction(db, { ownerUserId: input.userId, action: `Підтверджено запис +${current.proposedAmount} (${current.proposedSummary})` });
  }

  return confirmed;
}
