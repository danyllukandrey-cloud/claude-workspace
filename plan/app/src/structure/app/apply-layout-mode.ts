// App: applyLayoutMode use-case -- рахує й записує авто-розклад нового
// режиму (domain/layout.ts computeAutoLayout, вимога 6 в чаті: "Кожен з
// варіантів конфігурації потрібно просто розташувати за логікою і все без
// якихось законів з клітинками") ЗАМІСТЬ старого switchLayoutMode-reset-у-
// трей (D-131-наступне рішення, Андрій, 2026-09-15).
//
// Викликається з ../app/update-structure.ts рівно тоді, коли layoutMode
// РЕАЛЬНО змінився на нове значення (той самий guard, що вже був -- повтор
// уже збереженого значення нічого не перераховує й не чіпає ручних зв'язків
// користувача).
//
// 'staging' -- справжній no-op: жодного запису, ні позицій, ні зв'язків.
// domain's computeAutoLayout уже повертає для нього порожній план, але САМЕ
// на рівні app-шару "порожній план" для решти режимів означає "стерти
// позиції/зв'язки до порожнечі" (реальний намір режиму 'free', наприклад) --
// для staging натомість взагалі нічого не пишеться, картки лишаються де є.
// Той самий принцип для `null` (режим ще не обрано) -- жодної формули
// немає, найбезпечніший дефолт -- не чіпати.
//
// Реальна атомарність (BEGIN/COMMIT навколо кожного запису циклу нижче й
// решти PATCH) -- composition root (server/app.ts, withTransaction,
// ADR-0006); тут лише послідовність кроків use-case-у, той самий підхід, що
// update-structure.ts вже мав для reset-у.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import { computeAutoLayout } from '../domain/layout';
import type { LayoutMode } from '../domain/layout';
import {
  listActiveLayoutPositionsByOwner,
  updateLayoutPositionXY,
  replaceConnectionsForStructure,
} from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';

export interface ApplyLayoutModeInput {
  ownerUserId: string;
  structureId: string;
  layoutMode: LayoutMode;
}

/**
 * Розставляє ВСІ активні картки власника (і вже розкладені, і з купки
 * нерозкладених) за формулою нового режиму -- ОДНА дія користувача, одна
 * мітка часу на всі записані позиції. Замінює й старі зв'язки Структури на
 * ті, що формула цього режиму сама створює (для balance/focus/cause_effect)
 * чи не створює (free -- зв'язки зникають разом зі зміною режиму).
 */
export async function applyLayoutMode(db: Db, input: ApplyLayoutModeInput): Promise<void> {
  if (input.layoutMode === 'staging' || input.layoutMode === null) {
    return;
  }

  const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
  if (activePositions.length === 0) {
    return;
  }

  const plan = computeAutoLayout(
    input.layoutMode,
    activePositions.map((position) => ({ cardId: position.cardId, createdAt: position.createdAt.toISOString() })),
  );

  // Одна мітка часу на весь авто-розклад -- це ОДНА дія користувача, не N
  // окремих переміщень (LWW, ADR-0002) -- той самий принцип, що старий
  // reset уже застосовував (resetAt).
  const appliedAt = new Date();
  for (const position of plan.positions) {
    await updateLayoutPositionXY(db, input.ownerUserId, position.cardId, position.x, position.y, appliedAt);
  }

  await replaceConnectionsForStructure(
    db,
    input.structureId,
    plan.connections.map((connection) => ({
      id: crypto.randomUUID(),
      cardIdA: connection.cardIdA,
      cardIdB: connection.cardIdB,
      directed: connection.directed,
    })),
  );
}
