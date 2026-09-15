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
// AC-11/AC-16 422 (invalid_layout_mode/invalid_logic_variant): порт валідує
// enum ДО будь-якого запиту в базу -- контракт не довіряє цю перевірку лише
// use-case-шару, бо use-case (T11) приймає вже типізовані
// LayoutMode/LogicVariant і не бачить довільний рядок з HTTP-тіла.
// structure.logic_variant_requires_logic_mode (AC-16) -- інший випадок,
// значення В МЕЖАХ enum'у, лише неузгоджене з layoutMode -- це вже перевіряє
// use-case (T11), порт нічого зверху не додає й не ховає, пропускає як є.
//
// AC-03 (non-disclosure): Структура -- singleton, адресується лише через
// ownerUserId з Bearer-токена -- жодного параметра "чужий id" немає.

import { findStructureByOwner, insertStructure } from '../infra/postgres-repo';
import type { StructureRecord, Db, LayoutModeRow, LogicVariantRow } from '../infra/postgres-repo';
import { updateStructure as updateStructureUseCase } from '../app/update-structure';
import type { RecordAction } from '../app/update-structure';
import { AppError } from '../../shared/errors';

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.Structure ---

export interface StructureDto {
  id: string;
  declaration: string | null;
  layoutMode: LayoutModeRow | null;
  logicVariant: LogicVariantRow | null;
  createdAt: string;
  updatedAt: string;
}

function toStructureDto(record: StructureRecord): StructureDto {
  return {
    id: record.id,
    declaration: record.declaration,
    layoutMode: record.layoutMode,
    logicVariant: record.logicVariant,
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
  logicVariant?: LogicVariantRow | null;
}

const VALID_LAYOUT_MODES: LayoutModeRow[] = ['single', 'free', 'logic'];
const VALID_LOGIC_VARIANTS: LogicVariantRow[] = ['balance', 'focus', 'cause_effect'];

/**
 * 422 structure.invalid_layout_mode / structure.invalid_logic_variant --
 * значення поза enum'ом контракту, перевірено ДО будь-якого запиту в базу
 * (жоден із двох `if` нижче не викликає db.query).
 */
export async function updateStructure(
  db: Db,
  ownerUserId: string,
  body: StructureUpdateBody,
  recordAction?: RecordAction
): Promise<StructureDto> {
  if (body.layoutMode !== undefined && body.layoutMode !== null && !VALID_LAYOUT_MODES.includes(body.layoutMode)) {
    throw new AppError('structure.invalid_layout_mode', 'layoutMode must be one of: single, free, logic', 422);
  }
  if (body.logicVariant !== undefined && body.logicVariant !== null && !VALID_LOGIC_VARIANTS.includes(body.logicVariant)) {
    throw new AppError('structure.invalid_logic_variant', 'logicVariant must be one of: balance, focus, cause_effect', 422);
  }

  const updated = await updateStructureUseCase(
    db,
    {
      ownerUserId,
      ...(body.declaration !== undefined ? { declaration: body.declaration } : {}),
      ...(body.layoutMode !== undefined ? { layoutMode: body.layoutMode } : {}),
      ...(body.logicVariant !== undefined ? { logicVariant: body.logicVariant } : {}),
    },
    recordAction
  );
  return toStructureDto(updated);
}
