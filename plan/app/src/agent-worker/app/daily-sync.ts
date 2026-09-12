// T41 -- App (agent-worker): daily-sync use-case (US-12, AC-18/AC-18b).
//
// Оркеструє щоденний прохід по всіх `sync_resource` (усі користувачі, не
// один) -- за кожен due-ресурс (T35 domain/sync-resource.ts's isDueForSync):
// 1. будує свіжу копію карток/записів/декларації Структури власника ресурсу
//    (cards/life-area-card + structure -- ті самі postgres-repo.ts, що вже
//    обслуговують ці фічі, T41 нічого не дублює й не пише у їхні таблиці);
// 2. пише її через T38's writeExternalResource (сам HTTP/OAuth-виклик до
//    зовнішнього ресурсу інжектується ззовні, ADR-0004) -- T38 вже сам
//    оновлює sync_resource.status/last_synced_at/last_error на успіху й
//    помилці, T41 цього НЕ дублює;
// 3. на помилці (AC-18b) додатково пише 'resource_sync_failed' у
//    agent_audit_event -- це єдине, чого T38 навмисно не робить (той файл
//    per-write-статус, не аудит-лог), і чого DoD T41 прямо вимагає.
//
// DI (ADR-0004): db і writeToResource приходять ззовні, use-case сам
// з'єднання/HTTP-клієнта не створює -- той самий принцип, що
// ../infra/resource-writer.ts.
//
// "Ніколи мовчки не повторює нескінченно" (AC-18b): у межах ОДНОГО прогону
// кожен due-ресурс отримує рівно одну спробу запису (жодного внутрішнього
// retry-циклу); наступна спроба -- це наступний щоденний запуск (розклад
// самого worker'а, поза цим файлом), і лише якщо T35's isDueForSync знову
// визнає його due. Ресурс зі status='error' навмисно НЕ виключається з
// відбору тут -- те саме рішення, що вже задокументоване й перевірене
// юніт-тестами в T35 (sync-resource.ts, "не 'здався назавжди'"), T41 його
// лише переносить у реальний прохід, не переглядає заново.
//
// `AuditEventTypeRow`/`AuditSubjectTypeRow` у ../../agent/infra/postgres-repo.ts
// (T13) досі звужені до базового набору (коментар там: розширення --
// "later task's job", міграція 10/T33 вже проведена в БД, T13 -- ні) --
// T41 не чіпає той файл (поза files_hint цієї задачі, спільний з T39/T42) і
// пише 'resource_sync_failed'/'sync_resource' прямим `db.query`, тим самим
// SQL-шаблоном, що insertAuditEvent там використовує (INSERT ... RETURNING не
// потрібен -- нікому результат цього вставлення не потрібен тут).

import type { Db, ExternalDocClient } from '../infra/resource-writer';
import { writeExternalResource } from '../infra/resource-writer';
import { isDueForSync } from '../domain/sync-resource';
import type { SyncResourceStatus } from '../domain/sync-resource';
import { listActiveCardsByOwner, listEntriesByCard } from '../../cards/life-area-card/infra/postgres-repo';
import { findStructureByOwner } from '../../structure/infra/postgres-repo';

export interface DailySyncOutcome {
  resourceId: string;
  userId: string;
  ok: boolean;
}

interface RawSyncResourceRow {
  id: string;
  user_id: string;
  url: string;
  status: SyncResourceStatus;
  last_synced_at: Date | string | null;
}

interface SyncResourceForRun {
  id: string;
  userId: string;
  url: string;
  status: SyncResourceStatus;
  lastSyncedAt: Date | string | null;
}

/**
 * Усі `sync_resource` усіх користувачів -- жодного `WHERE status = 'active'`
 * навмисно (примітка в T35's isDueForSync): звуження партиковим індексом
 * назавжди виключило б ресурси зі status='error' з щоденного проходу,
 * всупереч рішенню T35.
 */
async function listAllSyncResources(db: Db): Promise<SyncResourceForRun[]> {
  const { rows } = await db.query<RawSyncResourceRow>(
    'SELECT id, user_id, url, status, last_synced_at FROM sync_resource'
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    url: row.url,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
  }));
}

/**
 * Свіжа копія карток/записів/декларації Структури власника (AC-18) -- лише
 * активна колода (архівовані картки не входять, той самий фільтр, що
 * SCR-01 показує користувачу); декларація -- null, якщо Структура ще не
 * заповнена (findStructureByOwner повертає null для не заведеної Структури,
 * не помилку).
 */
async function buildUserSnapshot(db: Db, userId: string): Promise<string> {
  const cards = await listActiveCardsByOwner(db, userId);
  const cardsWithEntries = await Promise.all(
    cards.map(async (card) => ({
      id: card.id,
      name: card.name,
      description: card.description,
      entries: (await listEntriesByCard(db, card.id)).map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        rawText: entry.rawText,
        status: entry.status,
        recordedAt: entry.recordedAt,
      })),
    }))
  );
  const structure = await findStructureByOwner(db, userId);

  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    cards: cardsWithEntries,
    declaration: structure?.declaration ?? null,
  });
}

/** AC-18b: подія в аудит-лог, а не мовчазний ретрай -- SCR-04 показує статус/last_error, який T38 вже виставив у sync_resource. */
async function recordSyncFailure(db: Db, resource: SyncResourceForRun, message: string): Promise<void> {
  await db.query(
    `INSERT INTO agent_audit_event (id, user_id, event_type, subject_type, subject_id, detail)
     VALUES ($1, $2, 'resource_sync_failed', 'sync_resource', $3, $4)`,
    [crypto.randomUUID(), resource.userId, resource.id, message]
  );
}

/**
 * Один щоденний прохід по всіх активних ресурсах усіх користувачів (AC-18) --
 * викликається worker'ом за власним розкладом (поза цим файлом). `now`
 * параметризовано (за замовчуванням поточний час) так само, як T35's
 * isDueForSync -- тестованість без залежності від системного годинника.
 */
export async function runDailySync(
  db: Db,
  writeToResource: ExternalDocClient,
  now: Date = new Date()
): Promise<DailySyncOutcome[]> {
  const resources = await listAllSyncResources(db);
  const due = resources.filter((resource) => isDueForSync(resource, now));

  const outcomes: DailySyncOutcome[] = [];

  for (const resource of due) {
    const content = await buildUserSnapshot(db, resource.userId);
    const result = await writeExternalResource(db, writeToResource, { id: resource.id, url: resource.url }, content);

    if (!result.ok) {
      await recordSyncFailure(db, resource, result.message);
    }

    outcomes.push({ resourceId: resource.id, userId: resource.userId, ok: result.ok });
  }

  return outcomes;
}
