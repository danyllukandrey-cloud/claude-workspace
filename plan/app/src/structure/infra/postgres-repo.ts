// Мінімальний зріз репозиторію `structure` -- НЕ повний T9 ("Infra: backend
// repository for structure + layout positions"), лише одна функція, потрібна
// щоб закрити D-69/D-103: коли картку архівують, її активна позиція в
// розкладці Структури закривається в тій самій транзакції.
//
// `structure` як фіча ще не пройшла /sdd:implement (tasks.json T4-T25 усе
// ще todo) -- ця функція навмисно випереджає власну чергу фічі, так само,
// як agent's app_user (migration 01) був промоучений заради life-area-card's
// card.owner_user_id ще до першого рядка коду agent. Коли дійде черга T9,
// цей файл розшириться (CRUD над structure + layout positions), а не
// перепишеться -- сигнатура нижче лишається чинною.
//
// DI (ADR-0004): той самий Db-контракт, що й у life-area-card/infra/
// postgres-repo.ts (query(text, params) -> {rows}) -- підходить і pg.Pool,
// і pg.Client, і той самий обʼєкт, який life-area-card вже використовує
// в одній транзакції з archiveCard.

import type { QueryResultRow } from 'pg';

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Закриває активну позицію картки в розкладці Структури (D-69, AC-16) --
 * status: 'active' -> 'closed'. Якщо активної позиції немає (картка ще не
 * розкладена, чи вже закрита раніше через structure's власний closeCard,
 * D-66) -- це НЕ помилка, просто нічого закривати. Не повертає результат:
 * викликачу (archiveCard) байдуже, чи існувала позиція, лише сам факт
 * "якщо була активна -- тепер закрита".
 */
export async function closeActiveLayoutPositionForCard(db: Db, cardId: string): Promise<void> {
  await db.query(
    `UPDATE structure_layout_position
     SET status = 'closed', position_updated_at = now()
     WHERE card_id = $1 AND status = 'active'`,
    [cardId]
  );
}
