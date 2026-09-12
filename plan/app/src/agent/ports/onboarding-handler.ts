// T24 -- Ports: GET /onboarding handler. contracts/openapi.yaml
// `/api/v1/onboarding` (getOnboardingStatus), spec.md AC-13, sad.md §6 Flow 15.
//
// Framework-agnostic (той самий підхід, що ../../structure/ports/
// layout-handlers.ts і ../../cards/life-area-card/ports/card-handlers.ts) --
// звичайна async-функція (db, userId) -> DTO відповідної схеми контракту.
// Ports-шар не пише SQL сам (ADR-0005) -- обидва запити (перевірка й запис)
// делеговані ../infra/postgres-repo.ts.
//
// AC-13: одноразовий свідомий виняток із «агент не заговорює першим» (D-43,
// CONTEXT.md Invariants). Перший виклик для user_id, що ще НЕ має жодного
// chat_message (hasAnyChatMessage, T13), СТВОРЮЄ вітальний chat_message
// (role=agent) і повертає його. Кожен наступний виклик того самого
// користувача не пише нічого нового -- `welcomeShown: true, message: null`,
// повну історію читають окремо через GET /messages.
//
// Текст вітання й гайду -- окреме завдання копірайтингу (Concept.md,
// D-76/D-77, ще не написаний) -- нижче заглушка/плейсхолдер, не остаточний
// текст (t24-ports-onboarding.md Notes).

import { hasAnyChatMessage, insertChatMessage } from '../infra/postgres-repo';
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
  const alreadyOnboarded = await hasAnyChatMessage(db, userId);
  if (alreadyOnboarded) {
    return { welcomeShown: true, message: null };
  }

  const welcome = await insertChatMessage(db, {
    id: crypto.randomUUID(),
    userId,
    role: 'agent',
    content: WELCOME_MESSAGE_CONTENT,
    sessionDate: todaySessionDate(),
  });

  return { welcomeShown: true, message: toMessageDto(welcome) };
}
