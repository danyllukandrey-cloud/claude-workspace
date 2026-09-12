// T38 -- Infra (agent-worker): external resource writer (US-12, AC-18/AC-18b).
//
// Пише актуальну копію карток/записів/декларацій користувача у зовнішній
// ресурс, доданий у налаштуваннях (Google Doc/Sheet тощо -- конкретний
// протокол/OAuth деталь реалізації, tasks/t38-infra-resource-writer.md
// "What"). Ізольований шар, як T37 (email-client)/T12 (claude-client):
// сам HTTP/OAuth-виклик до зовнішнього ресурсу сюди НЕ вбудований --
// `writeToResource` інжектується ззовні (DI, ADR-0004, той самий принцип, що
// claude-client's callClaude) -- модуль лишається тестованим без мережі.
//
// `Db` -- той самий контракт (query(text, params) -> {rows}), що й
// life-area-card/infra/postgres-repo.ts і structure/infra/postgres-repo.ts.
// На відміну від тих репозиторіїв цей файл не читає/не мапить повний
// sync_resource -- лише два прицільні UPDATE, які супроводжують сам факт
// запису (успіх/помилка), як того вимагає DoD ("write succeeds updates
// last_synced_at"). Решта CRUD над sync_resource -- T40 (App: sync-resource
// CRUD use-cases).
//
// AC-18b ("не намагається мовчки повторювати нескінченно") тут читаємо як:
// недоступний чи відкликаний ресурс НІКОЛИ не кидає необроблений виняток --
// викликач (T41 daily-sync use-case) отримує типізований результат
// (ResourceWriteResult), не try/catch на власний розсуд.

import type { QueryResultRow } from 'pg';

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Мінімальні дані про ресурс, потрібні для запису й позначення статусу --
 * не повний SyncResourceRecord (це T40), лише те, чим користується цей файл.
 */
export interface SyncResourceRef {
  id: string;
  url: string;
}

/**
 * Інжектований клієнт зовнішнього ресурсу: приймає посилання й готовий
 * контент, пише його на місце існуючого вмісту. Кидає на будь-якій
 * помилці (мережа, відкликаний доступ, збій на боці провайдера) --
 * `writeExternalResource` нижче єдине місце, що ловить і типізує.
 */
export type ExternalDocClient = (url: string, content: string) => Promise<void>;

export type ResourceWriteErrorCode = 'unreachable' | 'access_revoked' | 'unknown';

export interface ResourceWriteError {
  ok: false;
  code: ResourceWriteErrorCode;
  message: string;
}

export interface ResourceWriteSuccess {
  ok: true;
  syncedAt: Date;
}

export type ResourceWriteResult = ResourceWriteSuccess | ResourceWriteError;

/**
 * Записує `content` у зовнішній ресурс користувача (AC-18) і одразу оновлює
 * власний статус синхронізації в `sync_resource`:
 * - успіх -> `status = 'active'`, `last_synced_at = now()`, `last_error` очищено
 *   (відновлення після попередньої помилки -- test-plan.md: "recovers to
 *   status: active without manual intervention");
 * - недоступний/відкликаний ресурс (AC-18b) -> `status = 'error'`,
 *   `last_error` -- коротке пояснення для банера в налаштуваннях (SCR-04),
 *   і типізований результат замість необробленого винятку.
 */
export async function writeExternalResource(
  db: Db,
  writeToResource: ExternalDocClient,
  resource: SyncResourceRef,
  content: string
): Promise<ResourceWriteResult> {
  try {
    await writeToResource(resource.url, content);
  } catch (err) {
    const { code, message } = classifyWriteError(err);
    await db.query(`UPDATE sync_resource SET status = 'error', last_error = $1 WHERE id = $2`, [
      message,
      resource.id,
    ]);
    return { ok: false, code, message };
  }

  const syncedAt = new Date();
  await db.query(
    `UPDATE sync_resource SET status = 'active', last_synced_at = $1, last_error = NULL WHERE id = $2`,
    [syncedAt, resource.id]
  );
  return { ok: true, syncedAt };
}

/**
 * Класифікує помилку інжектованого клієнта в один із трьох типізованих
 * кодів. Провайдери зовнішніх документів (Google Docs/Sheets тощо)
 * повертають HTTP-статус на відкликаному/забороненому доступі -- 401/403/404
 * (видалено ззовні, spec.md AC-18b: "втрачено доступ чи видалено ззовні");
 * відсутність статусу означає мережевий збій (DNS, timeout, connection
 * refused) -- ресурс просто недоступний; будь-який інший статус -- невідома
 * помилка на боці провайдера, не привід мовчки все ж вважати запис успішним.
 *
 * Security fix (code review): раніше сюди потрапляв сирий `err.message` від
 * стороннього клієнта -- OAuth/HTTP-помилка провайдера рутинно містить URL
 * запиту, токени чи деталі акаунта. Це значення далі пишеться у
 * `sync_resource.last_error` і рендериться в банері на AccountScreen (SCR-04)
 * -- видиме користувачу поле, не службовий лог. Тому нижче лише СТАТИЧНЕ
 * повідомлення на категорію, той самий підхід, що вже в
 * `agent/infra/claude-client.ts` (`'Claude API недоступний'` замість тексту
 * мережевої помилки) -- сире `err`/`err.message` не потрапляє в жодне з
 * повернених значень.
 */
function classifyWriteError(err: unknown): { code: ResourceWriteErrorCode; message: string } {
  const status = hasHttpStatus(err) ? err.status : undefined;

  if (status === 401 || status === 403 || status === 404) {
    return { code: 'access_revoked', message: 'Доступ до ресурсу відкликано або ресурс видалено' };
  }
  if (status !== undefined) {
    return { code: 'unknown', message: 'Не вдалося записати у зовнішній ресурс' };
  }
  return { code: 'unreachable', message: 'Ресурс тимчасово недоступний' };
}

function hasHttpStatus(err: unknown): err is { status: number } {
  return typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number';
}
