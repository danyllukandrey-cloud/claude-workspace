// Доменна модель життєвого циклу пропозиції агента.
// spec.md AC-01 (текст) / AC-10 (вкладення) -- створення; AC-02 --
// підтвердження (active -> confirmed); AC-02b -- уточнення оновлює ТУ САМУ
// пропозицію на місці, не запускає новий діалог з нуля; AC-03 -- наступне
// тематично не пов'язане повідомлення мовчки відкидає активну пропозицію
// (мовчазного запису не буває, D-30); AC-10b -- нерозпізнане/нечитабельне
// вкладення не створює пропозиції, симетрично AC-04.
//
// Одна активна пропозиція на користувача, без TTL (sad.md §4, data-model.md
// agent_proposal: UNIQUE частковий індекс на активний рядок) -- ця інваріанта
// належить app-шару (єдиність на користувача), тут лише сам перехід стану
// однієї пропозиції.
//
// Sentinel Result (docs/features/agent/adr/0006-domain-sentinel-for-expected-errors.md,
// Accepted): domain НІКОЛИ не кидає виняток для очікуваного результату
// (вкладення нерозпізнане, перехід з невідповідного стану) -- функції
// повертають типізований `Result<T, E>`, викликач (`app/`) явно розбирає `ok`.
// Чиста функція, без I/O (plan/app/CLAUDE.md -- domain нічого не імпортує).

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export type ProposalStatus = 'active' | 'confirmed' | 'dropped';
export type ProposalSourceType = 'text' | 'attachment';

export interface Proposal {
  id: string;
  userId: string;
  cardId: string | null;
  metricBlockId: string | null;
  status: ProposalStatus;
  sourceType: ProposalSourceType;
  rawInput: string;
  proposedAmount: number | null;
  proposedSummary: string;
}

export interface ProposalError {
  code: string;
  message: string;
}

export interface CreateProposalInput {
  id: string;
  userId: string;
  sourceType: ProposalSourceType;
  rawInput: string;
  /**
   * Людський опис пропозиції, вже сформований розбором тексту/вкладення
   * (Claude, app-шар). `null`/порожній рядок -- ознака, що факт НЕ вдалось
   * виділити (AC-10b для вкладення; той самий шлях і для тексту, симетрично
   * AC-04) -- у цьому випадку пропозиція НЕ створюється.
   */
  proposedSummary: string | null;
  cardId?: string | null;
  metricBlockId?: string | null;
  proposedAmount?: number | null;
}

// AC-01 (текст) / AC-10 (вкладення): те саме правило для обох source_type --
// вкладення замінює текстовий опис повністю (data-model.md CHECK
// source_type IN ('text','attachment')), жодної окремої гілки коду.
export function createProposal(input: CreateProposalInput): Result<Proposal, ProposalError> {
  if (!input.rawInput.trim()) {
    return err({
      code: 'proposal.raw_input_required',
      message: 'Порожнє повідомлення чи вкладення не може стати пропозицією',
    });
  }

  if (!input.proposedSummary || !input.proposedSummary.trim()) {
    return err({
      code: 'proposal.fact_not_recognized',
      message:
        input.sourceType === 'attachment'
          ? 'Не вдалося виділити факт із вкладення'
          : 'Не вдалося розпізнати факт у повідомленні',
    });
  }

  return ok({
    id: input.id,
    userId: input.userId,
    cardId: input.cardId ?? null,
    metricBlockId: input.metricBlockId ?? null,
    status: 'active',
    sourceType: input.sourceType,
    rawInput: input.rawInput,
    proposedAmount: input.proposedAmount ?? null,
    proposedSummary: input.proposedSummary,
  });
}

export interface RefineProposalInput {
  proposedSummary?: string;
  proposedAmount?: number | null;
}

// AC-02b: уточнення ("ні, 3 км, а не 5") оновлює пропозицію ВІДПОВІДНО --
// той самий `id`, лише активна пропозиція чекає повторного підтвердження,
// без запуску нового діалогу з нуля. Поле, не згадане в уточненні,
// лишається як було.
export function refineProposal(
  proposal: Proposal,
  refinement: RefineProposalInput,
): Result<Proposal, ProposalError> {
  if (proposal.status !== 'active') {
    return err({
      code: 'proposal.not_active',
      message: 'Можна уточнити лише активну пропозицію, що чекає підтвердження',
    });
  }

  return ok({
    ...proposal,
    proposedSummary: refinement.proposedSummary ?? proposal.proposedSummary,
    proposedAmount:
      refinement.proposedAmount !== undefined ? refinement.proposedAmount : proposal.proposedAmount,
  });
}

// AC-02: явне підтвердження -- єдиний спосіб перейти в термінальний стан
// `confirmed` (система записує подію в картку і показує користувачу, що
// збережено). Підтвердити можна лише активну пропозицію.
export function confirmProposal(proposal: Proposal): Result<Proposal, ProposalError> {
  if (proposal.status !== 'active') {
    return err({
      code: 'proposal.not_active',
      message: 'Можна підтвердити лише активну пропозицію, що чекає підтвердження',
    });
  }
  return ok({ ...proposal, status: 'confirmed' });
}

// AC-03: користувач явно не підтвердив (мовчить або пише не по темі) --
// мовчазного запису не буває. Саме ВИЗНАЧЕННЯ "тематично не пов'язане" --
// не доменна відповідальність (рішення LLM на app-рівні, sad.md §6 Flow 5);
// ця функція лише виконує перехід стану, коли рішення вже ухвалене.
// Підтверджена пропозиція вже записана в картку -- відкинути її заднім
// числом означало б непомітно скасувати вже застосований запис, тому це
// помилка, не мовчазний перехід. Вже відкинута -- ідемпотентний повтор.
export function dropProposal(proposal: Proposal): Result<Proposal, ProposalError> {
  if (proposal.status === 'confirmed') {
    return err({
      code: 'proposal.already_confirmed',
      message: 'Підтверджену й записану пропозицію не можна відкинути',
    });
  }
  if (proposal.status === 'dropped') {
    return ok(proposal);
  }
  return ok({ ...proposal, status: 'dropped' });
}
