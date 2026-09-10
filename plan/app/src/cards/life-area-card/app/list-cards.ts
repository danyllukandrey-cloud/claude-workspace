// Читання колоди карток -- активної (за замовчуванням) або архіву (T34).
// AC-18: перегляд архіву -- та сама колода, лише інший фільтр статусу.
//
// Навмисно НЕ окремий use-case на кожен статус, а тонка параметризація
// наявного читання: обидві repo-функції (listActiveCardsByOwner,
// listArchivedCardsByOwner) уже готові й самі відповідають за SQL-фільтр
// і сортування (data-model.md, T10) -- цей шар лише обирає, яку з двох
// викликати.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам зʼєднання не створює.
// Non-disclosure (AC-04) тут дотримано автоматично -- обидві repo-функції
// вже скеровані на ownerUserId, окремої перевірки власника тут не потрібно.

import type { CardRecord, CardStatusRow, Db } from '../infra/postgres-repo';
import { listActiveCardsByOwner, listArchivedCardsByOwner } from '../infra/postgres-repo';

export async function listCards(
  db: Db,
  ownerUserId: string,
  status: CardStatusRow = 'active'
): Promise<CardRecord[]> {
  if (status === 'archived') {
    return listArchivedCardsByOwner(db, ownerUserId);
  }
  return listActiveCardsByOwner(db, ownerUserId);
}
