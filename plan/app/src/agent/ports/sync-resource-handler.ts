// T44 -- Ports: GET/POST/DELETE /sync-resources handlers
// (docs/features/agent/contracts/openapi.yaml, шлях /api/v1/sync-resources +
// /api/v1/sync-resources/{resourceId}), spec.md AC-18.
//
// Framework-agnostic (той самий підхід, що ../rules-handler.ts і
// ../../structure/ports/layout-handlers.ts): жоден HTTP-фреймворк ще не
// підключений у репо -- кожен хендлер тут звичайна async-функція
// (db, ownerUserId, ...параметри) -> Promise<...> точно контрактної форми
// при успіху, або дає AppError пройти нагору при помилці.
//
// Тонка обгортка над ../app/sync-resources.ts (T40, вже done) -- увесь
// use-case (валідація URL до запису, non-disclosure scoping по user_id,
// AppError sync_resource.url_invalid/not_found) уже там; порт лише мапить
// SyncResourceRecord (camelCase, з userId) на контрактну схему SyncResource
// (openapi.yaml components.schemas.SyncResource -- id/url/status/
// lastSyncedAt/lastError/createdAt, БЕЗ userId, additionalProperties:
// false) і серіалізує Date-поля в ISO-рядок на межі порту (той самий
// підхід, що rules-handler.ts toRuleResponse).
//
// Назви функцій точно за operationId контракту (listSyncResources/
// createSyncResource/deleteSyncResource) -- той самий підхід, що
// rules-handler.ts (listRules/createRule); імпорти use-case функцій
// перейменовані аліасами, щоб не зіткнутися з цими самими іменами.
//
// DoD T44: "Handlers return 200/201/204/404/422 exactly per contract
// (sync_resource.url_invalid on 422)":
// - GET повертає масив (200, немає окремого DTO-обгортки -- контракт:
//   `schema: { type: array, items: SyncResource }`).
// - POST повертає створений ресурс (201) або дає пройти AppError
//   sync_resource.url_invalid (422) з addSyncResource -- порт не
//   передвалідовує URL сам, це виключно доменна/use-case відповідальність
//   (T40), порт лише прокидає помилку.
// - DELETE не повертає тіла (Promise<void>, 204) або дає пройти AppError
//   sync_resource.not_found (404) з removeSyncResource.

import {
  addSyncResource as addSyncResourceUseCase,
  listSyncResources as listSyncResourcesUseCase,
  removeSyncResource as removeSyncResourceUseCase,
} from '../app/sync-resources';
import type { Db, SyncResourceRecord, SyncResourceStatusRow } from '../app/sync-resources';

/** Точно форма схеми SyncResource контракту (openapi.yaml) -- без userId. */
export interface SyncResourceDto {
  id: string;
  url: string;
  status: SyncResourceStatusRow;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function toSyncResourceDto(record: SyncResourceRecord): SyncResourceDto {
  return {
    id: record.id,
    url: record.url,
    status: record.status,
    lastSyncedAt: record.lastSyncedAt ? record.lastSyncedAt.toISOString() : null,
    lastError: record.lastError,
    createdAt: record.createdAt.toISOString(),
  };
}

/** GET /api/v1/sync-resources (AC-18, operationId listSyncResources) -- 200. */
export async function listSyncResources(db: Db, ownerUserId: string): Promise<SyncResourceDto[]> {
  const records = await listSyncResourcesUseCase(db, ownerUserId);
  return records.map(toSyncResourceDto);
}

/** Точно форма тіла SyncResourceCreate контракту. */
export interface SyncResourceCreateBody {
  url: string;
}

/**
 * POST /api/v1/sync-resources (AC-18, operationId createSyncResource) --
 * 201, або 422 sync_resource.url_invalid (addSyncResource, T40) якщо
 * посилання порожнє/невалідне -- перевірка ДО будь-якого запису, порт
 * лише дає AppError пройти нагору незміненою.
 */
export async function createSyncResource(
  db: Db,
  ownerUserId: string,
  body: SyncResourceCreateBody
): Promise<SyncResourceDto> {
  const record = await addSyncResourceUseCase(db, { userId: ownerUserId, url: body.url });
  return toSyncResourceDto(record);
}

/**
 * DELETE /api/v1/sync-resources/{resourceId} (AC-18, operationId
 * deleteSyncResource) -- 204 (немає тіла відповіді), або 404
 * sync_resource.not_found (removeSyncResource, T40) якщо ресурс не
 * знайдено чи належить іншому користувачу (non-disclosure).
 */
export async function deleteSyncResource(db: Db, ownerUserId: string, resourceId: string): Promise<void> {
  await removeSyncResourceUseCase(db, ownerUserId, resourceId);
}
