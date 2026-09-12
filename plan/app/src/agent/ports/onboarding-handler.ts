// T24 -- Ports: GET /onboarding handler. contracts/openapi.yaml
// `/api/v1/onboarding` (getOnboardingStatus), spec.md AC-13, sad.md §6 Flow 15.
//
// Framework-agnostic (той самий підхід, що ../../structure/ports/
// layout-handlers.ts і ../../cards/life-area-card/ports/card-handlers.ts) --
// звичайна async-функція (db, userId) -> DTO відповідної схеми контракту.
// Ports-шар не пише SQL сам (ADR-0005) -- запис делегований
// ../infra/postgres-repo.ts.
//
// AC-13: одноразовий свідомий виняток із «агент не заговорює першим» (D-43,
// CONTEXT.md Invariants). Перший виклик для user_id, що ще НЕ має жодного
// chat_message, СТВОРЮЄ вітальний chat_message (role=agent) і повертає
// його. Кожен наступний виклик того самого користувача не пише нічого
// нового -- `welcomeShown: true, message: null`, повну історію читають
// окремо через GET /messages.
//
// Текст вітання й гайду -- окреме завдання копірайтингу (Concept.md,
// D-76/D-77, ще не написаний) -- нижче заглушка/плейсхолдер, не остаточний
// текст (t24-ports-onboarding.md Notes).
//
// Review 2026-09-12 (race fix): раніше тут був check-then-insert
// (hasAnyChatMessage -> insertChatMessage) як два окремі round trip без
// жодної гарантії унікальності -- ChatScreen.tsx викликає GET /onboarding у
// тому самому Promise.all, що й loadHistory/loadActiveProposal на кожному
// монтуванні екрана (і React StrictMode монтує двічі в dev), тож два
// одночасні виклики могли обидва побачити "повідомлень ще нема" між своєю
// перевіркою й записом і обидва вставити вітальний рядок. Замінено на ОДИН
// атомарний виклик insertWelcomeMessageIfFirst (postgres-repo.ts) --
// перевірка-і-запис усередині одного SQL-запиту, друга одночасна спроба
// повертає нуль рядків (null), і тут це трактується так само, як "уже
// онбордений" -- не помилка.

import { insertWelcomeMessageIfFirst } from '../infra/postgres-repo';
import type { Db, ChatMessageRecord } from '../infra/postgres-repo';

const WELCOME_MESSAGE_CONTENT =
  'Привіт! Я твій агент у ПЛАН. Розкажи мені текстом чи фото, що зробив -- я запропоную, куди це записати. (Плейсхолдер тексту -- остаточний гайд ще не написаний, Concept.md D-76/D-77.)';

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.Message/OnboardingStatus ---

export interface MessageDto {
  id: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

export interface OnboardingStatusDto {
  welcomeShown: boolean;
  message: MessageDto | null;
}

function toMessageDto(record: ChatMessageRecord): MessageDto {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Календарний день у форматі chat_message.session_date (D-26), той самий формат, що ../domain/memory.ts очікує. */
function todaySessionDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- getOnboardingStatus -- GET /api/v1/onboarding -------------------------

export async function getOnboardingStatus(db: Db, userId: string): Promise<OnboardingStatusDto> {
  const welcome = await insertWelcomeMessageIfFirst(db, {
    id: crypto.randomUUID(),
    userId,
    role: 'agent',
    content: WELCOME_MESSAGE_CONTENT,
    sessionDate: todaySessionDate(),
  });

  // null -- або користувач уже онбордений раніше, або щойно програв гонку
  // конкурентному виклику (див. коментар над insertWelcomeMessageIfFirst) --
  // обидва трактуються однаково, це не помилка.
  if (welcome === null) {
    return { welcomeShown: true, message: null };
  }

  return { welcomeShown: true, message: toMessageDto(welcome) };
}
