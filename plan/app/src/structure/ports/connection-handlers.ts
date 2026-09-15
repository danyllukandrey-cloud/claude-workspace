// Ports: HTTP-хендлери зв'язків Структури -- contracts/openapi.yaml
// `/api/v1/structure/connections` (listConnections/createConnection) і
// `/api/v1/structure/connections/{connectionId}` (deleteConnection).
// Вимоги 4/5 (Андрій, чат, 2026-09-15): інструмент "Зв'язати" на Схемі --
// звичайна лінія чи стрілка між двома картками.
//
// Framework-agnostic (той самий підхід, що ../ports/layout-handlers.ts і
// ../ports/structure-handlers.ts) -- звичайна async-функція
// (db, ownerUserId, ...) -> DTO відповідної схеми контракту.
//
// `listConnections` -- ЖОДНИЙ пункт явного завдання його не називав, але
// клієнт (LayoutBoard.tsx) фізично не може намалювати вже наявні зв'язки
// без способу їх прочитати; той самий owner-scoped join, що
// listActiveLayoutPositionsByOwner, і той самий стиль DTO, що
// LayoutPositionPage (без пагінації -- зв'язків на одну Структуру завжди
// мало, той самий MVP-обсяг, що sad.md §11 уже приймає для позицій).

import { listConnectionsByOwner } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { createConnection as createConnectionUseCase } from '../app/create-connection';
import type { RecordAction } from '../app/create-connection';
import { deleteConnection as deleteConnectionUseCase } from '../app/delete-connection';

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.Connection ---

export interface ConnectionDto {
  id: string;
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
  createdAt: string;
}

// --- listConnections -- GET /api/v1/structure/connections -------------------

export async function listConnections(db: Db, ownerUserId: string): Promise<ConnectionDto[]> {
  const connections = await listConnectionsByOwner(db, ownerUserId);
  return connections.map((connection) => ({
    id: connection.id,
    cardIdA: connection.cardIdA,
    cardIdB: connection.cardIdB,
    directed: connection.directed,
    createdAt: connection.createdAt.toISOString(),
  }));
}

// --- createConnection -- POST /api/v1/structure/connections -----------------

export interface CreateConnectionBody {
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
}

export async function createConnection(
  db: Db,
  ownerUserId: string,
  body: CreateConnectionBody,
  recordAction?: RecordAction
): Promise<ConnectionDto> {
  const created = await createConnectionUseCase(
    db,
    { ownerUserId, cardIdA: body.cardIdA, cardIdB: body.cardIdB, directed: body.directed === true },
    recordAction
  );
  return {
    id: created.id,
    cardIdA: created.cardIdA,
    cardIdB: created.cardIdB,
    directed: created.directed,
    createdAt: created.createdAt.toISOString(),
  };
}

// --- deleteConnection -- DELETE /api/v1/structure/connections/{connectionId} --

export async function deleteConnection(
  db: Db,
  ownerUserId: string,
  connectionId: string,
  recordAction?: RecordAction
): Promise<void> {
  await deleteConnectionUseCase(db, { ownerUserId, connectionId }, recordAction);
}
