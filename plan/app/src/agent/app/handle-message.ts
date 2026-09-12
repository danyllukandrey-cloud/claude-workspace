// T16 -- App: handle-message use-case (sad.md §5 `app/handle-message.ts`,
// §6 Flows 1/3/5/10/11/12/13). Оркеструє T8 (domain/proposal.ts), T10
// (domain/memory.ts), T13 (infra/postgres-repo.ts) і T18 (ask-agent.ts):
// повідомлення чи вкладення -> пропозиція запису (AC-01/AC-10/AC-19), чи
// уточнююча відповідь без пропозиції (AC-04/AC-05/AC-10b/AC-19b), з
// урахуванням короткого (AC-15) і довгого (AC-09) контексту пам'яті,
// скоуплено лише на дані виклику user_id (AC-06).
//
// -----------------------------------------------------------------------
// ВІДКРИТЕ ДИЗАЙН-ПИТАННЯ (свідомо не вирішене жодним артефактом вище --
// spec.md/sad.md/data-model.md НІКОЛИ не фіксують, ЯК саме текст-відповідь
// Claude перетворюється на структуроване рішення "пропозиція" vs
// "уточнення" vs "яка картка"; ask-agent.ts (T18) навмисно повертає лише
// голий рядок `reply`, розрахований на Flow 6/AC-07, не на цю задачу).
// Консервативне рішення цього файлу: системний промпт (buildBaseSystemPrompt
// нижче) інструктує Claude відповідати СТРОГО одним JSON-об'єктом власного
// контракту (AgentDecision), який тут і парситься. Це рішення НЕ узгоджене
// окремо з Андрієм і не задокументоване як ADR -- фіксується тут лише як
// найконсервативніше практичне прочитання (`sad.md §4`: "Claude сам вирішує
// в межах одного запиту"), і лишається предметом перегляду людиною.
// -----------------------------------------------------------------------

import type { AskClaude, ClaudeAttachment } from '../infra/claude-client';
import { askAgent } from './ask-agent';
import {
  createProposal as createDomainProposal,
  refineProposal as refineDomainProposal,
  dropProposal as dropDomainProposal,
} from '../domain/proposal';
import type { Proposal as DomainProposal } from '../domain/proposal';
import { getShortTermWindow, findFactsByTopic } from '../domain/memory';
import type { ChatMessage, LongTermMemoryFact } from '../domain/memory';
import {
  findActiveProposalByUser,
  insertProposal,
  updateProposal,
  listEffectiveRulesForCard,
  listMessagesForSession,
  findActiveFactsByTopic,
  insertAuditEvent,
} from '../infra/postgres-repo';
import type { Db, ProposalRecord, ChatMessageRecord, FactRecord } from '../infra/postgres-repo';
// app -> cards (plan/app/CLAUDE.md, той самий крос-фічевий імпорт, що вже
// встановлений ../confirm.ts для life-area-card's createEntry): картка --
// чужа фіча, її дані читаються лише через уже готові app-/infra-функції
// life-area-card, agent тут нічого не пише в card/metric_block.
import { listCards } from '../../cards/life-area-card/app/list-cards';
import { listMetricBlocksByCard } from '../../cards/life-area-card/infra/postgres-repo';
import type { CardRecord } from '../../cards/life-area-card/infra/postgres-repo';

export interface HandleMessageInput {
  userId: string;
  /** Текст користувача (AC-01) -- null, коли повідомлення лише вкладення (AC-10/AC-19). */
  text: string | null;
  /** Вкладення -- фото (AC-10) чи документ/таблиця (AC-19); відсутнє/null для чистого тексту. */
  attachment?: ClaudeAttachment | null;
  /**
   * Тема для пошуку довгострокового факту (AC-09, `findActiveFactsByTopic`,
   * T13). Автоматичне визначення теми з вільного тексту НЕ описане жодним
   * артефактом вище -- відкрите питання (див. заголовок файлу), тому тут
   * лише pass-through хінта від викликача (напр. активна картка/тег
   * розмови), без вигаданої тут NLP-евристики.
   */
  topic?: string | null;
  /** Injectable "зараз" -- календарний день сесії (D-26) та тестова керованість. */
  now?: Date;
}

/** MessageTurn (contracts/openapi.yaml) -- відповідь на один хід чату. */
export interface HandleMessageResult {
  reply: string;
  /** Присутня, коли повідомлення сформувало чи оновило пропозицію (AC-01/AC-02b/AC-10/AC-19); null для суто уточнюючої відповіді. */
  proposal: ProposalRecord | null;
}

// --- Claude's structured decision (this file's own wire contract) ---------

interface AgentDecision {
  outcome: 'proposal' | 'clarification';
  reply: string;
  cardId: string | null;
  metricBlockId: string | null;
  proposedAmount: number | null;
  proposedSummary: string | null;
  /** Значуще лише коли активна пропозиція вже існувала (Flow 5, AC-03 mechanics). */
  activeProposalRelated: boolean;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Розбирає `askAgent`'s `reply` як JSON-конверт (`AgentDecision`). Будь-яка
 * невідповідність формату (не-JSON, відсутній `reply`) НЕ вгадує пропозицію
 * -- fail-safe у звичайне уточнення з вихідним текстом як відповіддю
 * (дух AC-04: "не вгадує і не мовчить").
 */
function parseAgentDecision(raw: string): AgentDecision {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof AgentDecision, unknown>>;
    const reply = safeString(parsed.reply);
    if (reply === null) {
      throw new Error('missing reply field');
    }
    return {
      outcome: parsed.outcome === 'proposal' ? 'proposal' : 'clarification',
      reply,
      cardId: safeString(parsed.cardId),
      metricBlockId: safeString(parsed.metricBlockId),
      proposedAmount: safeNumber(parsed.proposedAmount),
      proposedSummary: safeString(parsed.proposedSummary),
      activeProposalRelated: parsed.activeProposalRelated === true,
    };
  } catch {
    return {
      outcome: 'clarification',
      reply: raw,
      cardId: null,
      metricBlockId: null,
      proposedAmount: null,
      proposedSummary: null,
      activeProposalRelated: false,
    };
  }
}

// --- infra record -> domain object mapping (pure boundary conversions) ----

function toDomainProposal(record: ProposalRecord): DomainProposal {
  return {
    id: record.id,
    userId: record.userId,
    cardId: record.cardId,
    metricBlockId: record.metricBlockId,
    status: record.status,
    sourceType: record.sourceType,
    rawInput: record.rawInput,
    proposedAmount: record.proposedAmount,
    proposedSummary: record.proposedSummary,
  };
}

function toChatMessage(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    userId: record.userId,
    role: record.role,
    content: record.content,
    sessionDate: record.sessionDate,
    createdAt: record.createdAt.toISOString(),
  };
}

function toLongTermFact(record: FactRecord): LongTermMemoryFact {
  return {
    id: record.id,
    userId: record.userId,
    factText: record.factText,
    topic: record.topic,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Календарний день = одиниця "сесія" (D-26) -- той самий формат, що ../ports/onboarding-handler.ts. */
function toSessionDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// --- AC-05 card catalog: Claude обирає ЛИШЕ з переліку, ніколи не вигадує id ---

interface CardCatalogEntry {
  id: string;
  name: string;
  metricBlocks: { id: string; label: string; unit: string }[];
}

interface CardCatalog {
  entries: CardCatalogEntry[];
  cardIds: Set<string>;
}

async function buildCardCatalog(db: Db, cards: CardRecord[]): Promise<CardCatalog> {
  const entries: CardCatalogEntry[] = [];
  for (const card of cards) {
    // Життєвий цикл картки живе в іншій фічі (life-area-card) -- та сама
    // пряма інфра-функція, що вже читає get-card.ts (T20 тієї фічі), не
    // окрема копія SQL тут.
    const blocks = await listMetricBlocksByCard(db, card.id);
    entries.push({
      id: card.id,
      name: card.name,
      metricBlocks: blocks.map((block) => ({ id: block.id, label: block.label, unit: block.unit })),
    });
  }
  return { entries, cardIds: new Set(cards.map((card) => card.id)) };
}

function buildCardCatalogText(catalog: CardCatalog): string {
  if (catalog.entries.length === 0) {
    return 'У користувача ще немає жодної активної картки -- якщо факт потребує картки, запропонуй створити нову (AC-05).';
  }
  return catalog.entries
    .map((entry) => {
      const blocksText =
        entry.metricBlocks.length > 0
          ? entry.metricBlocks.map((block) => `    - metricBlockId=${block.id}: ${block.label} (${block.unit})`).join('\n')
          : '    (без блоків-метрик)';
      return `- cardId=${entry.id}: ${entry.name}\n${blocksText}`;
    })
    .join('\n');
}

function buildMemoryContextText(shortTermWindow: ChatMessage[], longTermFacts: LongTermMemoryFact[]): string {
  const lines: string[] = [];
  if (shortTermWindow.length > 0) {
    lines.push("Коротка пам'ять цієї сесії -- не забувай щойно сказане сьогодні (AC-15):");
    lines.push(...shortTermWindow.map((message) => `- [${message.role}] ${message.content}`));
  }
  if (longTermFacts.length > 0) {
    lines.push('Відомі довгострокові факти про користувача -- враховуй без повторного пояснення (AC-09):');
    lines.push(...longTermFacts.map((fact) => `- ${fact.factText}`));
  }
  return lines.join('\n');
}

function buildActiveProposalText(proposal: ProposalRecord | null): string {
  if (!proposal) {
    return 'Активної пропозиції немає.';
  }
  return (
    `Активна пропозиція, що чекає підтвердження: "${proposal.proposedSummary}" ` +
    `(на основі: "${proposal.rawInput}"). Якщо НОВЕ повідомлення уточнює саме цю пропозицію -- ` +
    `postavь "activeProposalRelated": true й онови proposedSummary/proposedAmount відповідно. ` +
    `Якщо нове повідомлення про щось інше -- postavь "activeProposalRelated": false; стару пропозицію ` +
    `буде мовчки відкинуто (AC-03), а твоя відповідь стосуватиметься лише нового повідомлення.`
  );
}

const RESPONSE_FORMAT_INSTRUCTION = `Відповідай СТРОГО одним JSON-об'єктом (без жодного тексту поза JSON), такої форми:
{
  "outcome": "proposal" | "clarification",
  "reply": "<текст, що побачить користувач -- пропозиція, уточнюючe питання, чи пояснення>",
  "cardId": "<id картки зі списку нижче, або null>",
  "metricBlockId": "<id блоку-метрики зі списку нижче, або null>",
  "proposedAmount": <число або null>,
  "proposedSummary": "<короткий людський опис запису, або null>",
  "activeProposalRelated": <true/false -- дивись опис активної пропозиції нижче>
}
"outcome": "proposal" ЛИШЕ тоді, коли proposedSummary заповнено і ти дійсно пропонуєш конкретний запис (AC-01/AC-10/AC-19). В решті випадків -- "clarification": суперечливі чи невизначені дані (AC-04), кілька однаково ймовірних карток або жодної підходящої (AC-05), чи вкладення, з якого не вдалось виділити факт (AC-10b/AC-19b). Обирай cardId/metricBlockId ЛИШЕ зі списку нижче -- ніколи не вигадуй id.`;

function buildBaseSystemPrompt(params: {
  shortTermWindow: ChatMessage[];
  longTermFacts: LongTermMemoryFact[];
  catalog: CardCatalog;
  activeProposal: ProposalRecord | null;
}): string {
  const sections = [
    RESPONSE_FORMAT_INSTRUCTION,
    buildMemoryContextText(params.shortTermWindow, params.longTermFacts),
    `Активні картки користувача:\n${buildCardCatalogText(params.catalog)}`,
    buildActiveProposalText(params.activeProposal),
  ];
  return sections.filter((section) => section.trim().length > 0).join('\n\n');
}

// --- persistence helpers ----------------------------------------------

async function dropStaleProposal(db: Db, proposal: ProposalRecord): Promise<void> {
  // AC-03 (Flow 5 mechanics): наступне тематично не пов'язане повідомлення
  // мовчки відкидає стару активну пропозицію -- нічого в картку не пишеться.
  const dropped = dropDomainProposal(toDomainProposal(proposal));
  if (!dropped.ok) {
    // Уже 'confirmed' (гонитва з паралельним confirm) -- не чіпаємо реальний
    // запис, ідемпотентний вихід (той самий домен-інваріант, що ../confirm.ts).
    return;
  }
  await updateProposal(db, proposal.userId, proposal.id, { status: 'dropped' });
  await insertAuditEvent(db, {
    id: crypto.randomUUID(),
    userId: proposal.userId,
    eventType: 'proposal_dropped',
    subjectType: 'proposal',
    subjectId: proposal.id,
  });
}

/** AC-02b (Flow 1's refinement leg) -- та сама пропозиція, оновлена на місці, не новий запис. */
async function refineActiveProposal(
  db: Db,
  proposal: ProposalRecord,
  decision: AgentDecision
): Promise<HandleMessageResult> {
  if (decision.outcome === 'proposal' && decision.proposedSummary) {
    const refined = refineDomainProposal(toDomainProposal(proposal), {
      proposedSummary: decision.proposedSummary,
      proposedAmount: decision.proposedAmount,
    });
    if (refined.ok) {
      const updated = await updateProposal(db, proposal.userId, proposal.id, {
        proposedSummary: refined.value.proposedSummary,
        proposedAmount: refined.value.proposedAmount,
      });
      if (updated) {
        await insertAuditEvent(db, {
          id: crypto.randomUUID(),
          userId: proposal.userId,
          eventType: 'proposal_updated',
          subjectType: 'proposal',
          subjectId: updated.id,
        });
        return { reply: decision.reply, proposal: updated };
      }
    }
  }
  // Пов'язане, але без придатного підсумку (чи невдале уточнення) -- активна
  // пропозиція лишається як була, нічого не пишемо (D-30: мовчазного запису
  // не буває -- так само й мовчазного скасування).
  return { reply: decision.reply, proposal: null };
}

export async function handleMessage(
  db: Db,
  askClaude: AskClaude,
  input: HandleMessageInput
): Promise<HandleMessageResult> {
  const sessionDate = toSessionDate(input.now ?? new Date());

  // AC-15: короткий контекст поточної сесії -- repo вже скоупив на
  // (user_id, session_date), domain (T10) повторно застосовує той самий
  // інваріант, щоб правило сортування/фільтра жило в одному тестованому
  // місці (D-19 -- одне джерело правди), не дублювалось тут по-новому.
  const sessionMessages = await listMessagesForSession(db, input.userId, sessionDate);
  const shortTermWindow = getShortTermWindow(sessionMessages.map(toChatMessage), sessionDate);

  // AC-09: довгостроковий факт "тієї самої теми" -- лише коли викликач дав
  // тему (див. відкрите питання у заголовку файлу).
  let longTermFacts: LongTermMemoryFact[] = [];
  const topic = input.topic?.trim();
  if (topic) {
    const factRows = await findActiveFactsByTopic(db, input.userId, topic);
    longTermFacts = findFactsByTopic(factRows.map(toLongTermFact), topic);
  }

  // AC-05: каталог активних карток САМЕ цього користувача (non-disclosure --
  // listCards/listActiveCardsByOwner уже скеровані на ownerUserId у SQL).
  const cards = await listCards(db, input.userId, 'active');
  const catalog = await buildCardCatalog(db, cards);

  // Flow 5 / AC-03 mechanics: чи вже є активна пропозиція, що чекає.
  const activeProposal = await findActiveProposalByUser(db, input.userId);

  // AC-07/AC-12: ефективні правила для контексту активної пропозиції (чи
  // без картки, якщо жодної немає) -- той самий читальний виклик, що Flow 6.
  const activeRules = await listEffectiveRulesForCard(db, input.userId, activeProposal?.cardId ?? null);

  const baseSystemPrompt = buildBaseSystemPrompt({ shortTermWindow, longTermFacts, catalog, activeProposal });

  const rawInput = input.text ?? `[вкладення: ${input.attachment?.mediaType ?? 'невідомий тип'}]`;

  // AC-10b/AC-19b (mime-рівень) і "Claude недоступний" (Critical flow 2)
  // мапляться в AppError усередині askAgent (T18) -- і кидаються ДО того, як
  // цей use-case щось записав (усе вище -- лише читання), тому пропагація
  // цього винятку сама по собі задовольняє DoD "без запису" для цієї гілки.
  const askResult = await askAgent(askClaude, {
    text: input.text,
    attachment: input.attachment ?? null,
    baseSystemPrompt,
    activeRules,
  });

  const decision = parseAgentDecision(askResult.reply);

  if (activeProposal) {
    if (decision.activeProposalRelated) {
      return refineActiveProposal(db, activeProposal, decision);
    }
    // Flow 5 (AC-03 mechanics): не пов'язане -- стара пропозиція мовчки
    // відкидається ПЕРЕД тим, як нове повідомлення отримує власний результат.
    await dropStaleProposal(db, activeProposal);
  }

  if (decision.outcome !== 'proposal' || !decision.proposedSummary) {
    // AC-04/AC-05/AC-10b/AC-19b: уточнююча відповідь -- нічого не персистимо
    // (найконсервативніше прочитання DoD "without persisting anything",
    // застосоване однаково до кожної гілки уточнення, не лише вкладення --
    // див. заголовок файлу).
    return { reply: decision.reply, proposal: null };
  }

  // AC-06: НІКОЛИ не довіряти id, який повернув Claude, наосліп -- він має
  // належати каталогу САМЕ цього користувача (побудованому вище зі
  // скоупленого читання), інакше лишаємо null (той самий шлях, що AC-05
  // "ще не визначено").
  const resolvedCardId = decision.cardId && catalog.cardIds.has(decision.cardId) ? decision.cardId : null;
  const resolvedMetricBlockId = resolvedCardId ? decision.metricBlockId : null;

  const created = createDomainProposal({
    id: crypto.randomUUID(),
    userId: input.userId,
    sourceType: input.attachment ? 'attachment' : 'text',
    rawInput,
    proposedSummary: decision.proposedSummary,
    cardId: resolvedCardId,
    metricBlockId: resolvedMetricBlockId,
    proposedAmount: decision.proposedAmount,
  });

  if (!created.ok) {
    // Доменний інваріант відхилив (напр. порожній rawInput) -- fallback у
    // звичайне уточнення, нічого не пишемо.
    return { reply: decision.reply, proposal: null };
  }

  const inserted = await insertProposal(db, {
    id: created.value.id,
    userId: created.value.userId,
    cardId: created.value.cardId,
    metricBlockId: created.value.metricBlockId,
    sourceType: created.value.sourceType,
    rawInput: created.value.rawInput,
    proposedAmount: created.value.proposedAmount,
    proposedSummary: created.value.proposedSummary,
  });

  await insertAuditEvent(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    eventType: 'proposal_created',
    subjectType: 'proposal',
    subjectId: inserted.id,
  });

  return { reply: decision.reply, proposal: inserted };
}
