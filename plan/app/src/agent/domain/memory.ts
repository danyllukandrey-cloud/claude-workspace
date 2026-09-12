// Доменна модель гібридної пам'яті агента (sad.md §5 `memory.ts`):
// коротке сире вікно поточної сесії + довгострокові структуровані факти.
// Чисті функції, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО") -- усі
// три оперують уже прочитаними рядками (postgres-repo -- інфра, T13).
//
// AC-15 -- коротке сире вікно, одиниця "сесія" = календарний день (D-26,
// закрито через /sdd:design agent, sad.md §5/§11). AC-09 -- пошук
// довгострокового факту "тієї самої теми" (sad.md §6 Flow 11). AC-06 --
// приватність: ім'я третьої особи ніколи не потрапляє в пам'ять
// користувача (sad.md §8 "Privacy -- третя особа в тексті",
// data-model.md `long_term_memory_fact.fact_text`).

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'agent';
  content: string;
  /** Календарний день = одиниця "сесія" короткострокового вікна (D-26). */
  sessionDate: string;
  createdAt: string;
}

export type MemoryFactStatus = 'active' | 'deleted';

export interface LongTermMemoryFact {
  id: string;
  userId: string;
  /** Ім'я третьої особи вже прибране перед записом -- готується `prepareFactText`. */
  factText: string;
  topic: string | null;
  status: MemoryFactStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * AC-15 -- коротке сире вікно поточної сесії: усі повідомлення, чий
 * `sessionDate` збігається з переданим календарним днем, у хронологічному
 * порядку (`created_at`), незалежно від порядку у вхідному масиві --
 * `postgres-repo` не гарантує порядок вибірки сам собою (data-model.md
 * `idx_chat_message_user_session`, ключ саме в такому порядку колонок).
 * Скоуп на користувача -- відповідальність запиту до репозиторію (AC-06,
 * інфра-шар), не цієї чистої функції.
 */
export function getShortTermWindow(
  messages: ChatMessage[],
  sessionDate: string,
): ChatMessage[] {
  return messages
    .filter((message) => message.sessionDate === sessionDate)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * AC-09 -- пошук довгострокового факту за темою: лише активні факти
 * (`status = 'active'`) -- видалений/забутий факт («забудь, що...», sad.md
 * §4) ніколи не повертається, навіть якщо тема збігається. Тема -- вільний
 * текстовий тег (data-model.md), тож порівнюється без урахування регістру
 * й крайніх пробілів, а не побайтово.
 */
export function findFactsByTopic(
  facts: LongTermMemoryFact[],
  topic: string,
): LongTermMemoryFact[] {
  const normalizedTopic = topic.trim().toLowerCase();
  return facts.filter(
    (fact) =>
      fact.status === 'active' &&
      fact.topic !== null &&
      fact.topic.trim().toLowerCase() === normalizedTopic,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * AC-06 -- прибирає кожне ім'я третьої особи з тексту, лишаючи решту
 * (sad.md §6 Flow 4: "біг з Марією 5 км" -> ім'я прибрано, лишається
 * вимірюване число). Імена -- уже виявлені висхідним розбором (Claude,
 * `ask-agent.ts`); домен НЕ розпізнає імена сам (ніякого NLP в domain-шарі),
 * лише прибирає ті, що йому передали, точно в тій формі, у якій вони
 * зустрілись у вихідному тексті.
 *
 * Межа слова рахується вручну через Unicode-класи літер/цифр
 * (`\p{L}`/`\p{N}`), а не вбудований `\b` -- стандартний `\b` спирається на
 * ASCII-означення `\w` і НЕ бачить кириличні літери як "словесні символи",
 * тому неправильно ріже слова посередині для не-латинських текстів.
 */
export function stripThirdPersonNames(
  text: string,
  thirdPersonNames: string[] = [],
): string {
  let result = text;
  for (const rawName of thirdPersonNames) {
    const name = rawName.trim();
    if (name.length === 0) continue;
    const boundary = '[\\p{L}\\p{N}]';
    const pattern = new RegExp(
      `(?<!${boundary})${escapeRegExp(name)}(?!${boundary})`,
      'giu',
    );
    result = result.replace(pattern, '');
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * AC-06 + AC-09 -- готує текст факту "перед записом" (DoD T10):
 * прибирає третіх осіб, тоді перевіряє домен-інваріант
 * `long_term_memory_fact.fact_text NOT NULL` (data-model.md) -- порожній
 * факт (нічого не лишилось після зачистки, або вхід був порожнім/пробілами)
 * ніколи не потрапляє в довгострокову пам'ять.
 */
export function prepareFactText(
  rawText: string,
  thirdPersonNames: string[] = [],
): string {
  const sanitized = stripThirdPersonNames(rawText, thirdPersonNames);
  if (sanitized.length === 0) {
    throw new Error('fact text must not be empty after removing third-person names');
  }
  return sanitized;
}
