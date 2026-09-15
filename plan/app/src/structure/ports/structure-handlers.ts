// Ports: HTTP-хендлери Структури (T15) -- contracts/openapi.yaml
// `/api/v1/structure` (getMyStructure/updateMyStructure), spec.md §5.
//
// Framework-agnostic (той самий підхід, що ../../cards/life-area-card/ports/
// card-handlers.ts) -- звичайна async-функція (db, ownerUserId, ...) -> DTO
// відповідної схеми контракту. Майбутній транспортний шар (T30) відповідає
// за .code/.message/.httpStatus.
//
// AC-09/DoD "lazy-provisioned Structure on first GET": getStructure шукає
// рядок власника, і якщо немає -- створює один порожній (declaration: null,
// layoutMode: null) тут-таки, той самий singleton-інваріант, що
// infra/postgres-repo.ts вже документує (одна Структура на owner_user_id).
//
// Вимоги 14/15 (Андрій, чат) -- плоска модель, ОДНЕ поле layoutMode з 5
// значень ('balance'/'focus'/'cause_effect'/'free'/'staging') замість
// колишньої пари layoutMode('logic')+logicVariant. Колишній
// structure.invalid_logic_variant і structure.logic_variant_requires_logic_mode
// прибрані разом з полем -- лишається один 422, structure.invalid_layout_mode,
// на будь-яке значення поза цими 5.
//
// AC-11 422 (invalid_layout_mode): порт валідує enum ДО будь-якого запиту в
// базу -- контракт не довіряє цю перевірку лише use-case-шару, бо use-case
// (T11) приймає вже типізований LayoutMode і не бачить довільний рядок з
// HTTP-тіла.
//
// AC-03 (non-disclosure): Структура -- singleton, адресується лише через
// ownerUserId з Bearer-токена -- жодного параметра "чужий id" немає.

import { findStructureByOwner, insertStructure } from '../infra/postgres-repo';
import type { StructureRecord, Db, LayoutModeRow } from '../infra/postgres-repo';
import { updateStructure as updateStructureUseCase } from '../app/update-structure';
import type { RecordAction } from '../app/update-structure';
import { AppError } from '../../shared/errors';

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.Structure ---

export interface StructureDto {
  id: string;
  declaration: string | null;
  layoutMode: LayoutModeRow | null;
  createdAt: string;
  updatedAt: string;
}

function toStructureDto(record: StructureRecord): StructureDto {
  return {
    id: record.id,
    declaration: record.declaration,
    layoutMode: record.layoutMode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// --- getStructure -- GET /api/v1/structure ---------------------------------

/**
 * Лениве провіснення (AC-09) -- перший вхід власника ще не має рядка, тут
 * створюємо один, порожній, замість 404/500.
 */
export async function getStructure(db: Db, ownerUserId: string): Promise<StructureDto> {
  const existing = await findStructureByOwner(db, ownerUserId);
  if (existing) {
    return toStructureDto(existing);
  }

  const created = await insertStructure(db, { id: crypto.randomUUID(), ownerUserId });
  return toStructureDto(created);
}

// --- updateStructure -- PATCH /api/v1/structure ----------------------------

export interface StructureUpdateBody {
  declaration?: string | null;
  layoutMode?: LayoutModeRow | null;
}

const VALID_LAYOUT_MODES: LayoutModeRow[] = ['balance', 'focus', 'cause_effect', 'free', 'staging'];

/**
 * 422 structure.invalid_layout_mode -- значення поза enum'ом контракту,
 * перевірено ДО будь-якого запиту в базу (`if` нижче не викликає db.query).
 */
export async function updateStructure(
  db: Db,
  ownerUserId: string,
  body: StructureUpdateBody,
  recordAction?: RecordAction
): Promise<StructureDto> {
  if (body.layoutMode !== undefined && body.layoutMode !== null && !VALID_LAYOUT_MODES.includes(body.layoutMode)) {
    throw new AppError(
      'structure.invalid_layout_mode',
      'layoutMode must be one of: balance, focus, cause_effect, free, staging',
      422
    );
  }

  const updated = await updateStructureUseCase(
    db,
    {
      ownerUserId,
      ...(body.declaration !== undefined ? { declaration: body.declaration } : {}),
      ...(body.layoutMode !== undefined ? { layoutMode: body.layoutMode } : {}),
    },
    recordAction
  );
  return toStructureDto(updated);
}
