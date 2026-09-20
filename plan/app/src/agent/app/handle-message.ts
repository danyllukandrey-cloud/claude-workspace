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
import { getShortTermWindow, findFactsByTopic, stripThirdPersonNames, prepareFactText } from '../domain/memory';
import type { ChatMessage, LongTermMemoryFact } from '../domain/memory';
import { createImperativeRule, findConflictingRule, defaultRuleConflictPredicate, ruleDirectiveText } from '../domain/rules';
import type { ImperativeRuleCategory, ImperativeRule } from '../domain/rules';
import {
  findActiveProposalByUser,
  insertProposal,
  updateProposal,
  listEffectiveRulesForCard,
  listRulesByScope,
  insertRule,
  listMessagesForSession,
  findActiveFactsByTopic,
  insertAuditEvent,
  insertFact,
  updateFact,
  softDeleteFact,
} from '../infra/postgres-repo';
import type { Db, ProposalRecord, ChatMessageRecord, FactRecord, RuleRecord } from '../infra/postgres-repo';
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

/**
 * Опційні ін'єктовані залежності (той самий optional-DI підхід, що D-115's
 * recordCardRenameEvent) -- відсутні за замовчуванням, тож жоден наявний
 * викликач/тест не зобов'язаний про них знати. `db` уже несе все, що
 * app/developer-report.ts потребує для запису рядка, окрім email-транспорту
 * й адреси розробника -- ці двоє живуть composition root'ом (server/index.ts
 * -> server/app.ts's AppDeps.emailTransport/developerEmail), не тут (той
 * самий dependency rule, plan/app/CLAUDE.md), тому викликач (../ports/
 * chat-handler.ts) сам будує вже "закритий" (bound) колбек навколо
 * fileUserRequestedIssueReport і передає лише його -- цей файл нічого не
 * знає про EmailTransport.
 */
export interface HandleMessageDeps {
  /** AC-20b -- повертає фактичний статус доставки (не лише "не впало"), щоб handleMessage міг чесно повідомити користувача, якщо лист не пішов. */
  reportUserIssue?: (userDescription: string) => Promise<{ deliveryStatus: 'sent' | 'failed' }>;
  /**
   * Лог дій (Андрій: "тупо пишемо кожну дію -- час, дія, все.") -- сигнатура
   * збігається з ./record-action.ts's `recordAction`, той самий опційний
   * DI-стиль, що reportUserIssue вище. Логується сам факт "надіслано
   * повідомлення" одразу на вході, незалежно від того, чим хід завершиться
   * (пропозиція чи уточнення) -- дія користувача вже відбулась.
   */
  recordAction?: (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;
  /**
   * T12 (life-plan-levels AC-09, sad.md §6 Critical flow 4) -- створення
   * пункту ПЛАНу, підтвердженого користувачем прямо в чаті. Колбек, а не
   * прямий імпорт: `agent` нічого не знає про модуль `plan-horizons` (і
   * навпаки) -- зв'язує їх композиційний корінь (server/app.ts), той самий
   * оптційний DI-стиль, що `recordAction`/`reportUserIssue` вище. За цим
   * колбеком стоїть РІВНО той самий вхід, що обслуговує пряме введення на
   * сторінці ПЛАН (ports/plan-item-handlers.createPlanItem -> POST
   * /api/v1/plan-items), тому підтвердження в чаті й ручне додавання
   * сходяться в одному шляху запису, а не в двох паралельних.
   *
   * `horizon` тут -- звичайний рядок: перевірка, що це один із трьох
   * горизонтів, живе в домені plan-horizons (`createPlanItem` кине
   * PlanItemValidationError), і дублювати її тут означало б два джерела
   * правди (D-19).
   */
  createPlanItem?: (input: { ownerUserId: string; horizon: string; planText: string }) => Promise<unknown>;
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
  /**
   * AC-06 (sad.md §8/Flow 4) -- імена третіх осіб, які Claude вже розпізнав
   * у вхідному тексті ("біг з Марією 5 км" -> ["Марією"]). Домен сам НЕ
   * розпізнає імена (ніякого NLP у domain/memory.ts) -- лише прибирає ті,
   * що йому передали (`stripThirdPersonNames`); ЦЕЙ файл лише прокидає
   * список від Claude в domain-функцію перед записом.
   */
  thirdPersonNames: string[];
  /**
   * AC-09/US-06 -- значущий факт, вартий запам'ятовування довгостроково,
   * фонова дія без окремого підтвердження (spec.md §2). `null`, якщо цей
   * хід нічого не додає до довгострокової пам'яті.
   */
  rememberFact: string | null;
  /** Тема щойно запам'ятованого факту -- той самий тег, що `findFactsByTopic` шукає пізнішою сесією. */
  rememberTopic: string | null;
  /**
   * AC-09 "забудь, що..." (sad.md §4) -- тема раніше запам'ятованого факту,
   * який користувач хоче скасувати чи виправити. `findFactsByTopic` --
   * єдиний доступний доменний пошук, тому зіставлення робиться лише за
   * темою, без додаткового вгадування, яку саме репліку мав на увазі.
   */
  forgetTopic: string | null;
  /**
   * Заданий разом із `forgetTopic` -- виправлення факту на цей текст
   * (`memory_fact_edited`). Якщо `forgetTopic` заданий, а це `null` --
   * факт видаляється (`memory_fact_deleted`).
   */
  forgetReplacementText: string | null;
  /**
   * AC-14 (US-03, review 2026-09-13 gap fix) -- заповнюється ЛИШЕ коли
   * Claude вважає діалог формулювання правила завершеним (користувач
   * підтвердив/уточнив достатньо, щоб зберегти), а не на кожному кроці
   * уточнення -- так само, як `rememberFact` не заповнюється, доки факт не
   * "визрів". `null` -- цей хід не стосується збереження правила (звичайна
   * розмова чи ще триває уточнення формулювання).
   */
  proposedRule: { category: ImperativeRuleCategory | null; ruleText: string | null; scopeCardId: string | null } | null;
  /**
   * AC-20b (US-14, review 2026-09-13 gap fix) -- заповнюється, коли Claude
   * розпізнав прохання користувача переслати проблему розробнику ("я бачу
   * таку-то штуку, відправ розробнику"): короткий опис проблеми з ПОГЛЯДУ
   * КОРИСТУВАЧА, готовий лягти в лист. `null` -- цей хід не про це.
   */
  reportIssueToDeveloper: string | null;
  /**
   * T12 / life-plan-levels AC-06 -- формулювання пункту ПЛАНу, яке агент лише
   * ПРОПОНУЄ. Свідомо НІКОЛИ нікуди не пишеться: пропозиція живе лише в
   * `reply` (тобто лише в чаті), на сервері немає стану "очікує
   * підтвердження" (life-plan-levels sad.md §4 п.3). Поле існує, щоб намір
   * був явним у конверті (і перевірюваним тестом), а не вгадувався з тексту.
   */
  planItemProposal: { horizon: string; planText: string } | null;
  /**
   * T12 / life-plan-levels AC-09 -- користувач підтвердив формулювання прямо
   * в чаті: САМЕ це підтвердження і є збереженням (жодної додаткової дії в
   * редакторі). Заповнюється лише коли підтвердження однозначне -- той самий
   * принцип, що `proposedRule` вище: доки триває уточнення, тут `null`.
   */
  confirmedPlanItem: { horizon: string; planText: string } | null;
}

/** Розбір `{horizon, planText}` з конверта -- будь-яка невідповідність форми -> null (той самий fail-safe, що safeProposedRule). */
function safePlanItemDraft(value: unknown): { horizon: string; planText: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<Record<'horizon' | 'planText', unknown>>;
  const horizon = safeString(raw.horizon);
  const planText = safeString(raw.planText);
  if (horizon === null || planText === null) return null;
  return { horizon, planText };
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

const VALID_RULE_CATEGORIES: readonly string[] = [
  'data',
  'correction',
  'survey',
  'context_clarification',
  'owner_impact',
  'reminder',
];

/**
 * AC-14 -- будь-яка невідповідність форми (не-об'єкт, невідома категорія)
 * повертає `null` (той самий fail-safe принцип, що parseAgentDecision
 * загалом: невідомий формат ніколи не вгадує намір зберегти щось).
 * Остаточна валідація (порожнє правило) усе одно лишається за
 * `createImperativeRule` (domain, ADR-0006 Result) нижче -- це лише
 * розбір JSON-конверта, не бізнес-правило.
 */
function safeProposedRule(value: unknown): AgentDecision['proposedRule'] {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<Record<'category' | 'ruleText' | 'scopeCardId', unknown>>;
  const category = typeof raw.category === 'string' && VALID_RULE_CATEGORIES.includes(raw.category) ? (raw.category as ImperativeRuleCategory) : null;
  const ruleText = safeString(raw.ruleText);
  const scopeCardId = safeString(raw.scopeCardId);
  return { category, ruleText, scopeCardId };
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
      thirdPersonNames: safeStringArray(parsed.thirdPersonNames),
      rememberFact: safeString(parsed.rememberFact),
      rememberTopic: safeString(parsed.rememberTopic),
      forgetTopic: safeString(parsed.forgetTopic),
      forgetReplacementText: safeString(parsed.forgetReplacementText),
      proposedRule: safeProposedRule(parsed.proposedRule),
      reportIssueToDeveloper: safeString(parsed.reportIssueToDeveloper),
      planItemProposal: safePlanItemDraft(parsed.planItemProposal),
      confirmedPlanItem: safePlanItemDraft(parsed.confirmedPlanItem),
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
      thirdPersonNames: [],
      rememberFact: null,
      rememberTopic: null,
      forgetTopic: null,
      forgetReplacementText: null,
      proposedRule: null,
      reportIssueToDeveloper: null,
      planItemProposal: null,
      confirmedPlanItem: null,
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

/**
 * AC-12 (review 2026-09-12) -- дешевий, детермінований здогад про картку,
 * якої стосується САМЕ повідомлення, ще ДО виклику Claude (ефективні
 * правила мають бути готові заздалегідь -- вони йдуть у системний промпт).
 * Не NLP: пряма підстрокова згадка назви картки з каталогу САМЕ цього
 * користувача (той самий каталог, що вже будується для outcome:'proposal'
 * нижче) -- без регістру. Кілька збігів -- перший за порядком каталогу;
 * жодного -- null (викликач сам вирішує fallback).
 */
function resolveCandidateCardId(catalog: CardCatalog, text: string | null): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase();
  const match = catalog.entries.find((entry) => {
    const name = entry.name.trim().toLowerCase();
    return name.length > 0 && normalized.includes(name);
  });
  return match ? match.id : null;
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

/**
 * AC-14 -- показує Claude тексти вже наявних правил цього скоупу (глобальні +
 * override поточної картки, той самий `activeRules`, що вже читається вище
 * для guard/промпту -- жодного нового запиту), щоб він сам уникав пропонувати
 * дослівний дубль ще ДО того, як code-side перевірка (persistProposedRule
 * нижче) відхилить його. Це лише інформаційний контекст для діалогу --
 * справжній gate лишається за findConflictingRule/defaultRuleConflictPredicate
 * (точний скоуп, не цей ширший "ефективний" список).
 */
function buildExistingRulesText(activeRules: RuleRecord[]): string {
  if (activeRules.length === 0) return '';
  const lines = activeRules.map(
    (rule) => `- "${ruleDirectiveText(rule)}"${rule.scopeCardId ? ' (діє лише на одній картці)' : ' (глобальне)'}`
  );
  return [
    "Уже наявні активні правила користувача (AC-07/AC-14) -- якщо допомагаєш сформулювати НОВЕ правило, не пропонуй те, що дослівно дублює одне з цих (перевір за змістом, не лише за словом):",
    ...lines,
  ].join('\n');
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
  "activeProposalRelated": <true/false -- дивись опис активної пропозиції нижче>,
  "thirdPersonNames": [<масив імен третіх осіб, згаданих у тексті, або порожній масив (AC-06) -- напр. "біг з Марією 5 км" -> ["Марією"]>],
  "rememberFact": "<значущий факт, вартий довгострокової пам'яті (AC-09), або null -- фонова дія, окреме підтвердження не потрібне>",
  "rememberTopic": "<тема цього факту для пізнішого пошуку, або null>",
  "forgetTopic": "<тема раніше запам'ятованого факту, який користувач хоче скасувати чи виправити ('забудь, що...'), або null>",
  "forgetReplacementText": "<заданий разом із forgetTopic -- новий текст факту (виправлення); null разом із forgetTopic -- факт просто видаляється>",
  "proposedRule": "<об'єкт {category, ruleText, scopeCardId} КОЛИ користувач хоче сформулювати власне правило (AC-14) і діалог уже досяг конкретного, готового до збереження формулювання -- інакше null (ще уточнюєш формулювання в reply, нічого не зберігай передчасно). category -- одне з готового меню (data/correction/survey/context_clarification/owner_impact/reminder) або null; ruleText -- власне формулювання або null; має бути задано ХОЧА Б ОДНЕ з двох. scopeCardId -- id картки зі списку нижче, якщо правило стосується лише ОДНІЄЇ картки (AC-12), або null для глобального правила. Система сама ще раз звірить із наявними правилами тієї самої області дії ПЕРЕД збереженням -- якщо знайде дублікат, збереження не станеться і користувач побачить чому.>",
  "planItemProposal": "<об'єкт {horizon, planText} КОЛИ користувач просить допомогти СФОРМУЛЮВАТИ пункт свого ПЛАНу і ти пропонуєш формулювання, якого він ще НЕ підтвердив -- інакше null. horizon -- один із трьох горизонтів: 'tactical' (найближче), 'operational' (середнє), 'strategic' (далеке); planText -- саме формулювання. Пропозиція лишається ЛИШЕ в чаті: нічого не зберігається, доки користувач не підтвердить. Твій reply має показати формулювання й запитати підтвердження.>",
  "confirmedPlanItem": "<об'єкт {horizon, planText} КОЛИ користувач у чаті явно підтвердив запропоноване формулювання ('так', 'додай', 'давай') -- саме це підтвердження і створює пункт, жодної іншої дії від користувача не потрібно. planText -- ПІДТВЕРДЖЕНИЙ текст (з урахуванням правок користувача), horizon -- той самий набір із трьох значень. Інакше null -- доки підтвердження немає, нічого не зберігається.>",
  "reportIssueToDeveloper": "<КОРОТКИЙ опис проблеми з погляду користувача, КОЛИ користувач явно просить переслати проблему розробнику ('відправ це розробнику', 'повідом про це розробнику' тощо, AC-20b) -- або null, коли це звичайна розмова. Якщо задано, твій reply МАЄ підтвердити користувачу, що надіслано (наприклад: 'Надіслав це розробнику.') -- система сама повторно перевірить, чи надсилання дійсно вдалось, і замінить твою відповідь поясненням, якщо ні.>"
}
"outcome": "proposal" ЛИШЕ тоді, коли proposedSummary заповнено і ти дійсно пропонуєш конкретний запис (AC-01/AC-10/AC-19). В решті випадків -- "clarification": суперечливі чи невизначені дані (AC-04), кілька однаково ймовірних карток або жодної підходящої (AC-05), чи вкладення, з якого не вдалось виділити факт (AC-10b/AC-19b). Обирай cardId/metricBlockId ЛИШЕ зі списку нижче -- ніколи не вигадуй id.`;

function buildBaseSystemPrompt(params: {
  shortTermWindow: ChatMessage[];
  longTermFacts: LongTermMemoryFact[];
  catalog: CardCatalog;
  activeProposal: ProposalRecord | null;
  activeRules: RuleRecord[];
}): string {
  const sections = [
    RESPONSE_FORMAT_INSTRUCTION,
    buildMemoryContextText(params.shortTermWindow, params.longTermFacts),
    `Активні картки користувача:\n${buildCardCatalogText(params.catalog)}`,
    buildActiveProposalText(params.activeProposal),
    buildExistingRulesText(params.activeRules),
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

/**
 * AC-09 -- write-шлях довгострокової пам'яті (review 2026-09-12: до цього
 * insertFact/updateFact/softDeleteFact не мали жодного продакшн-виклику).
 * "забудь, що..." (forgetTopic) перевіряється першим і, якщо знайдено
 * відповідний активний факт, виключає одночасне "запам'ятай" у ЦЬОМУ ж
 * ході -- той самий хід не повинен і скасувати, і одразу заново створити
 * факт на ту саму тему без явного другого повідомлення користувача.
 * Пошук лише за темою (`findFactsByTopic` -- єдиний доступний доменний
 * пошук, свідомо без глибшого зіставлення тексту, за інструкцією задачі).
 */
async function persistFactMemoryUpdates(db: Db, userId: string, decision: AgentDecision): Promise<void> {
  const forgetTopic = decision.forgetTopic?.trim();
  if (forgetTopic) {
    const rows = await findActiveFactsByTopic(db, userId, forgetTopic);
    const [target] = findFactsByTopic(rows.map(toLongTermFact), forgetTopic);
    if (!target) {
      return;
    }
    const replacementText = decision.forgetReplacementText?.trim();
    if (replacementText) {
      const prepared = prepareFactText(replacementText, decision.thirdPersonNames);
      if (prepared.ok) {
        const updated = await updateFact(db, userId, target.id, { factText: prepared.value });
        if (updated) {
          await insertAuditEvent(db, {
            id: crypto.randomUUID(),
            userId,
            eventType: 'memory_fact_edited',
            subjectType: 'memory_fact',
            subjectId: updated.id,
          });
        }
      }
      return;
    }
    const deleted = await softDeleteFact(db, userId, target.id);
    if (deleted) {
      await insertAuditEvent(db, {
        id: crypto.randomUUID(),
        userId,
        eventType: 'memory_fact_deleted',
        subjectType: 'memory_fact',
        subjectId: deleted.id,
      });
    }
    return;
  }

  const rememberFact = decision.rememberFact?.trim();
  if (!rememberFact) {
    return;
  }
  const prepared = prepareFactText(rememberFact, decision.thirdPersonNames);
  if (!prepared.ok) {
    // AC-06: після прибирання третьої особи нічого не лишилось -- domain-
    // інваріант `fact_text NOT NULL` (той самий сентинел, що proposal.ts) --
    // тихо нічого не запам'ятовуємо, а не кидаємо виняток за очікуваний результат.
    return;
  }
  await insertFact(db, {
    id: crypto.randomUUID(),
    userId,
    factText: prepared.value,
    topic: decision.rememberTopic?.trim() || null,
  });
}

/**
 * AC-14 (US-03, review 2026-09-13 gap fix) -- зберігає правило, яке Claude
 * запропонував ПІСЛЯ того, як діалог формулювання визрів
 * (`decision.proposedRule` заповнено; поки триває уточнення -- воно `null`,
 * ніякого передчасного збереження). Той самий "не довіряти Claude наосліп"
 * принцип, що AC-06 вже застосовує до cardId/metricBlockId основного flow'у:
 *
 * 1. Домен валідує форму (`createImperativeRule`, ADR-0006 Result) --
 *    порожнє правило (ні категорії, ні тексту) просто нічого не зберігає,
 *    той самий fail-safe, що `prepareFactText` вище для AC-09.
 * 2. `scopeCardId` звіряється з каталогом САМЕ цього користувача -- чужий чи
 *    вигаданий id означає "не резолвнулось", збереження пропускається (той
 *    самий шлях, що AC-05 для основного flow'у) -- НЕ мовчки перетворюється
 *    на глобальне правило, бо це змінило б намір користувача.
 * 3. Конфлікт-перевірка ТІЄЇ САМОЇ області дії
 *    (`findConflictingRule`/`defaultRuleConflictPredicate` -- той самий
 *    предикат, що ../ports/rules-handler.ts's REST-шлях POST /api/v1/rules,
 *    D-19 одне джерело правди) -- знайдений дублікат СКАСОВУЄ збереження, а
 *    Claude-ову оптимістичну відповідь замінює детермінованим поясненням
 *    (той самий принцип, що AC-06: код, не Claude, має останнє слово, коли
 *    вони розходяться).
 *
 * Повертає замінник для `decision.reply`, коли знайдено конфлікт; `null` --
 * коли нічого замінювати (нема proposedRule, воно порожнє/нерезолвлене, чи
 * збереження пройшло успішно -- Claude-ова власна відповідь лишається).
 */
async function persistProposedRule(db: Db, userId: string, decision: AgentDecision, cardIds: Set<string>): Promise<string | null> {
  const proposed = decision.proposedRule;
  if (!proposed) {
    return null;
  }

  if (proposed.scopeCardId !== null && !cardIds.has(proposed.scopeCardId)) {
    return null;
  }

  const created = createImperativeRule({
    id: crypto.randomUUID(),
    userId,
    scopeCardId: proposed.scopeCardId,
    category: proposed.category,
    ruleText: proposed.ruleText,
  });
  if (!created.ok) {
    return null;
  }

  const existingInScope: ImperativeRule[] = await listRulesByScope(db, userId, created.value.scopeCardId);
  const conflict = findConflictingRule(
    { scopeCardId: created.value.scopeCardId, category: created.value.category, ruleText: created.value.ruleText },
    existingInScope,
    defaultRuleConflictPredicate
  );
  if (conflict) {
    const conflictText = ruleDirectiveText(conflict);
    const scopeText = conflict.scopeCardId ? 'на цій картці' : 'глобальне';
    return `Таке правило вже є (${scopeText}): "${conflictText}". Уточни, чим нове формулювання відрізняється, або скасуй ідею.`;
  }

  await insertRule(db, {
    id: created.value.id,
    userId: created.value.userId,
    scopeCardId: created.value.scopeCardId,
    category: created.value.category,
    ruleText: created.value.ruleText,
  });
  return null;
}

/** AC-02b (Flow 1's refinement leg) -- та сама пропозиція, оновлена на місці, не новий запис. */
async function refineActiveProposal(
  db: Db,
  proposal: ProposalRecord,
  decision: AgentDecision
): Promise<HandleMessageResult> {
  if (decision.outcome === 'proposal' && decision.proposedSummary) {
    // AC-06: те саме прибирання третьої особи, що й для нової пропозиції
    // нижче -- уточнення так само лягає в agent_proposal.proposed_summary.
    const sanitizedSummary = stripThirdPersonNames(decision.proposedSummary, decision.thirdPersonNames);
    const refined = refineDomainProposal(toDomainProposal(proposal), {
      proposedSummary: sanitizedSummary,
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

/**
 * AC-20b (US-14, review 2026-09-13 gap fix) -- пересилає розробнику проблему,
 * яку користувач явно попросив переслати (`decision.reportIssueToDeveloper`).
 * Той самий "код, не Claude, має останнє слово" принцип, що AC-14/AC-06 вище:
 * на успіху Claude-ова власна відповідь (уже інструктована підтвердити
 * надсилання, AC-20b DoD) лишається як є; на невдалій доставці ЧИ
 * неочікуваній помилці колбека (лист не мав впасти цілком мовчки -- AC-20b
 * вимагає, щоб користувач дізнався правду, не оптимістичне "надіслано", коли
 * насправді ні) -- відповідь замінюється детермінованим поясненням. Відсутній
 * колбек (deps не передано) -- тихий no-op, той самий fallback, що
 * emailTransport/developerEmail деінде в проєкті (T29 wiring).
 */
/**
 * T12 (life-plan-levels AC-09/AC-06, sad.md §6 Critical flow 4) -- підтверджений
 * у чаті пункт ПЛАНу створюється тут, ТИМ САМИМ шляхом, що й пряме введення на
 * сторінці ПЛАН (колбек `deps.createPlanItem`, зв'язаний композиційним коренем).
 *
 * Симетрична половина AC-06: `decision.planItemProposal` тут свідомо НЕ
 * читається взагалі -- непідтверджена пропозиція не має жодного шляху до
 * запису, не "має, але з перевіркою". Єдиний вхід -- `confirmedPlanItem`.
 *
 * Порожній/пробільний текст -- тихо нічого не створюємо (той самий fail-safe,
 * що `prepareFactText`/`persistProposedRule` вище): доменна перевірка
 * plan-horizons однаково відхилила б його, але кидати виняток за очікуваний
 * результат розбору відповіді Claude цей файл ніде не робить.
 */
async function persistConfirmedPlanItem(deps: HandleMessageDeps | undefined, userId: string, decision: AgentDecision): Promise<void> {
  const confirmed = decision.confirmedPlanItem;
  if (!confirmed || !deps?.createPlanItem) {
    return;
  }
  const planText = confirmed.planText.trim();
  if (planText.length === 0) {
    return;
  }
  await deps.createPlanItem({ ownerUserId: userId, horizon: confirmed.horizon, planText });
}

async function notifyDeveloperOfUserIssue(deps: HandleMessageDeps | undefined, decision: AgentDecision): Promise<string | null> {
  const description = decision.reportIssueToDeveloper?.trim();
  if (!description || !deps?.reportUserIssue) {
    return null;
  }
  try {
    const result = await deps.reportUserIssue(description);
    if (result.deliveryStatus === 'failed') {
      return 'Спробував переслати це розробнику, але надсилання не вдалось -- спробуй ще раз трохи пізніше.';
    }
    return null;
  } catch {
    return 'Спробував переслати це розробнику, але сталася помилка й надсилання не вдалось -- спробуй ще раз трохи пізніше.';
  }
}

export async function handleMessage(
  db: Db,
  askClaude: AskClaude,
  input: HandleMessageInput,
  deps?: HandleMessageDeps
): Promise<HandleMessageResult> {
  const sessionDate = toSessionDate(input.now ?? new Date());

  // Лог дій -- на самому вході, до будь-якого запису: дія користувача ("надіслав
  // повідомлення") вже відбулась незалежно від того, чим хід завершиться
  // (пропозиція чи уточнення) -- не пост-успіх, як у решти use-case-ів.
  if (deps?.recordAction) {
    await deps.recordAction(db, { ownerUserId: input.userId, action: 'Надіслано повідомлення агенту' });
  }

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

  // AC-12: скоуп ефективних правил -- це картка, якої стосується САМЕ ЦЕ
  // повідомлення, не обов'язково картка попередньої активної пропозиції.
  // Review 2026-09-12: раніше тут завжди бралась лише activeProposal?.cardId
  // -- на першому повідомленні ходу (активної пропозиції ще нема) картка
  // виходила null, і card-override правило (AC-12) мовчки не діяло. Каталог
  // (той самий, що нижче для outcome:'proposal') дозволяє дешево здогадатись
  // про цільову картку ще ДО виклику Claude -- пряма згадка назви картки в
  // тексті користувача; коли такої згадки нема, лишається попередній
  // fallback на картку активної пропозиції.
  const candidateCardId = resolveCandidateCardId(catalog, input.text) ?? activeProposal?.cardId ?? null;

  // AC-07/AC-12: ефективні правила для контексту, що реально стосується
  // цього повідомлення (той самий читальний виклик, що Flow 6).
  const activeRules = await listEffectiveRulesForCard(db, input.userId, candidateCardId);

  const baseSystemPrompt = buildBaseSystemPrompt({ shortTermWindow, longTermFacts, catalog, activeProposal, activeRules });

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

  // AC-07: askAgent повертає guard-вердикт ОСТАННЬОЇ виконаної перевірки
  // (DoD ask-agent.ts: "returned for audit logging") -- раніше цей use-case
  // читав лише .reply й мовчки відкидав .guard, тож жоден guard_passed/
  // guard_failed рядок не потрапляв в agent_audit_event. Пишеться одразу
  // після виклику -- той самий транзакційний контекст, що решта запису
  // цього ходу, до розбору decision (не залежить від outcome).
  await insertAuditEvent(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    eventType: askResult.guard.passed ? 'guard_passed' : 'guard_failed',
    subjectType: 'guard',
    subjectId: askResult.guard.violatedRuleId,
    detail: askResult.guard.reason,
  });

  const decision = parseAgentDecision(askResult.reply);

  // AC-09: "запам'ятати" (US-06) чи "забудь, що..." (sad.md §4) -- фонова
  // дія, незалежна від того, чи цей хід ще й формує proposal (spec.md §2:
  // "фонова дія без окремого підтвердження, за винятком випадків, коли той
  // самий факт одночасно є записом у картку" -- той виняток тут свідомо не
  // додатково обробляється, задача лише про сам відсутній write-шлях).
  await persistFactMemoryUpdates(db, input.userId, decision);

  // AC-14 (review 2026-09-13 gap fix): "запам'ятати правило" -- та сама
  // фонова дія, незалежна від того, чи цей хід ще й формує proposal. Коли
  // деterministic-перевірка знаходить конфлікт, Claude-ова оптимістична
  // відповідь замінюється тут -- ДО того, як decision.reply піде в БУДЬ-ЯКУ
  // з гілок нижче (proposal чи clarification), той самий принцип, що AC-06
  // "код, не Claude, має останнє слово".
  const ruleConflictReply = await persistProposedRule(db, input.userId, decision, catalog.cardIds);
  if (ruleConflictReply !== null) {
    decision.reply = ruleConflictReply;
  }

  // T12 (life-plan-levels AC-09): підтверджений у чаті пункт ПЛАНу -- така
  // сама фонова дія цього ходу, як AC-09/AC-14 вище, незалежна від того, чи
  // хід ще й формує пропозицію запису в картку. Запис у Лог дій (AC-05 тієї
  // фічі) робить сам колбек -- композиційний корінь передає в нього ту саму
  // `recordAction`, що й прямому введенню, тож рядок у Лозі однаковий.
  await persistConfirmedPlanItem(deps, input.userId, decision);

  // AC-20b (review 2026-09-13 gap fix): застосовується ПІСЛЯ AC-14's
  // можливого перезапису -- рідкісний випадок, коли той самий хід одночасно
  // зачепив і невдале правило, і прохання переслати проблему, вирішується на
  // користь останнього (детальніше в docstring нижче не потрібно: обидва
  // шляхи -- крайні випадки, порядок лише має бути детермінованим).
  const developerReportReply = await notifyDeveloperOfUserIssue(deps, decision);
  if (developerReportReply !== null) {
    decision.reply = developerReportReply;
  }

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

  // AC-01/AC-02/AC-05 (review 2026-09-12): картка/блок чи сума, що не
  // резолвнулись -- пропозиція, яку ЦЕЙ хід все одно поставив би 'active',
  // ChatPanel показала б із робочою кнопкою "Підтвердити", а confirm.ts
  // кинув би 409 agent.proposal_incomplete щойно користувач її натисне --
  // глухий кут, не "агент перепитує" (AC-05). Замість цього -- та сама
  // гілка уточнення, що вже вище для outcome !== 'proposal': нічого не
  // персистимо, той самий reply від Claude йде як просте уточнення.
  if (!resolvedCardId || !resolvedMetricBlockId || decision.proposedAmount === null) {
    return { reply: decision.reply, proposal: null };
  }

  // AC-06: третя особа прибирається з тексту ПЕРЕД записом -- і з сирого
  // вводу, і з короткого підсумку (sad.md §6 Flow 4: "біг з Марією 5 км" ->
  // лишається лише "5 км"), іменами, які вже розпізнав Claude (decision).
  const sanitizedRawInput = stripThirdPersonNames(rawInput, decision.thirdPersonNames);
  const sanitizedSummary = stripThirdPersonNames(decision.proposedSummary, decision.thirdPersonNames);

  const created = createDomainProposal({
    id: crypto.randomUUID(),
    userId: input.userId,
    sourceType: input.attachment ? 'attachment' : 'text',
    rawInput: sanitizedRawInput,
    proposedSummary: sanitizedSummary,
    cardId: resolvedCardId,
    metricBlockId: resolvedMetricBlockId,
    proposedAmount: decision.proposedAmount,
  });

  if (!created.ok) {
    // Доменний інваріант відхилив (напр. порожній rawInput після зачистки
    // третьої особи) -- fallback у звичайне уточнення, нічого не пишемо.
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
