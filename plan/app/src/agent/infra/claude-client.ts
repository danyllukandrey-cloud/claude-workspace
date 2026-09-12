// T12 -- infra: обгортка над Claude Messages API (Anthropic) для агента
// (sad.md §5 "claude-client.ts # виклик Claude API (ключ ховається тут,
// D-24)"). Покриває Critical flow 1 (текст, AC-01), Critical flow 2 (Claude
// недоступний), Critical flow 3 (вкладення-фото AC-10, і симетрично
// документ/таблиця AC-19 -- spec.md "агент обробляє його так само, як
// фото-вкладення").
//
// DI (ADR-0005 domain/app/infra/ports, той самий підхід, що вже в
// cards/life-area-card/infra/postgres-repo.ts -- Db інжектується, модуль сам
// нічого не створює): apiKey і fetch-реалізація приймаються параметром
// конфігурації. Модуль НІКОЛИ сам не читає process.env -- це робить лише
// composition root (server/index.ts, за межами src/; tsconfig.json для src/
// навіть не підключає типи "node"). Той самий DI-принцип, що вже встановлений
// сусідньою фічею для checkSuspiciousData
// (cards/life-area-card/infra/claude-client.ts) -- callClaude там теж
// інжектується, не створюється на місці.
//
// Domain-sentinel (ADR-0004 agent): askClaude ніколи не кидає виняток для
// очікуваної помилки -- мережевий збій/таймаут (Critical flow 2), не-2xx
// відповідь, неочікувана форма відповіді, чи непідтримуваний формат вкладення
// (AC-10b/AC-19b) -- усе повертається як ClaudeResult<T>. app-шар (майбутній
// ask-agent.ts) мапить Err у AppError на межі з ports, той самий контракт, що
// й для guard-перевірки.
//
// Ключ ніколи не логується (DoD T12): у цьому файлі немає жодного
// console.*-виклику, і жодне повідомлення ClaudeError не містить apiKey --
// перевірено явно в claude-client.test.ts (console-шпигун за весь тест).

/** Вкладення, що агент отримав від користувача -- фото (AC-10) або документ/таблиця (AC-19). */
export interface ClaudeAttachment {
  /** MIME-тип, як його визначив upload-шар (наприклад `image/jpeg`, `application/pdf`). */
  mediaType: string;
  /** Вміст вкладення в base64 -- байти самі НЕ зберігаються (data-model.md agent_proposal.raw_input лише текст). */
  base64Data: string;
}

export interface AskClaudeInput {
  /** Системний промпт (базові правила + меню категорій + правило користувача, sad.md §4). */
  systemPrompt?: string;
  /** Текст користувача (AC-01) -- null, коли повідомлення складається лише з вкладення (AC-10/AC-19). */
  text: string | null;
  /** Вкладення (AC-10 фото / AC-19 документ-таблиця) -- відсутнє чи null для чистого тексту. */
  attachment?: ClaudeAttachment | null;
}

export interface ClaudeClientConfig {
  /** Ключ Claude API (D-24, ховається на бекенді) -- ніколи не логується цим модулем. */
  apiKey: string;
  /** За замовчуванням https://api.anthropic.com -- перекривається лише заглушкою в тестах. */
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  /** Injectable fetch -- дозволяє підмінити мережевий шар у тестах без монкі-патчингу глобального fetch. */
  fetchImpl?: typeof fetch;
}

export type ClaudeErrorCode = 'claude.unavailable' | 'claude.unsupported_attachment' | 'claude.unexpected_response';

export interface ClaudeError {
  code: ClaudeErrorCode;
  message: string;
}

export type ClaudeResult<T> = { ok: true; value: T } | { ok: false; error: ClaudeError };

export type AskClaude = (input: AskClaudeInput) => Promise<ClaudeResult<string>>;

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

// AC-19 (розширено 2026-08-29, D-89): "фото й документи (текст/таблиці/PDF)".
// AC-19b/AC-10b: усе, що технічно не розібрати (архів, виконуваний файл) --
// поза цим переліком, клієнт відмовляє ДО мережевого виклику.
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const SUPPORTED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
]);

/** AC-19b/AC-10b: чи вміє клієнт технічно розібрати цей MIME-тип вкладення. */
export function isSupportedAttachment(mediaType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(mediaType) || SUPPORTED_DOCUMENT_TYPES.has(mediaType);
}

/** Створює виклик Claude Messages API з готовою конфігурацією (apiKey закрито в замиканні). */
export function createClaudeClient(config: ClaudeClientConfig): AskClaude {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const doFetch = config.fetchImpl ?? fetch;
  const apiKey = config.apiKey;

  return async function askClaude(input: AskClaudeInput): Promise<ClaudeResult<string>> {
    if (input.attachment && !isSupportedAttachment(input.attachment.mediaType)) {
      return {
        ok: false,
        error: {
          code: 'claude.unsupported_attachment',
          message: `Непідтримуваний тип вкладення: ${input.attachment.mediaType}`,
        },
      };
    }

    const requestBody = {
      model,
      max_tokens: maxTokens,
      ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      messages: [{ role: 'user', content: buildContent(input) }],
    };

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
      });
    } catch {
      // Critical flow 2 (sad.md §6): мережевий збій/таймаут -- без retry
      // (§11 accepted debt), текст користувача не втрачається (це вирішує
      // викликач, не цей клієнт). Статичне повідомлення -- apiKey сюди
      // ніколи не потрапляє.
      return { ok: false, error: { code: 'claude.unavailable', message: 'Claude API недоступний' } };
    }

    if (!response.ok) {
      return { ok: false, error: { code: 'claude.unavailable', message: `Claude API відповів ${response.status}` } };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: { code: 'claude.unexpected_response', message: 'Claude API: тіло відповіді не JSON' } };
    }

    const text = extractText(data);
    if (text === null) {
      return { ok: false, error: { code: 'claude.unexpected_response', message: 'Claude API: неочікувана форма відповіді' } };
    }

    return { ok: true, value: text };
  };
}

function buildContent(input: AskClaudeInput): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (input.attachment) {
    blocks.push(buildAttachmentBlock(input.attachment));
  }
  if (input.text !== null && input.text.length > 0) {
    blocks.push({ type: 'text', text: input.text });
  }
  return blocks;
}

function buildAttachmentBlock(attachment: ClaudeAttachment): Record<string, unknown> {
  const blockType = SUPPORTED_IMAGE_TYPES.has(attachment.mediaType) ? 'image' : 'document';
  // AC-19: документ/таблиця йде тим самим шляхом, що фото (AC-10) -- один і
  // той самий base64-контент-блок, лише інший `type`. Claude сам розбирає
  // вміст, застосунок нічого не парсить локально (spec.md AC-19).
  return {
    type: blockType,
    source: { type: 'base64', media_type: attachment.mediaType, data: attachment.base64Data },
  };
}

function extractText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: unknown; text?: unknown };
  if (first.type !== 'text' || typeof first.text !== 'string') return null;
  return first.text;
}
