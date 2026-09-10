// Review 2026-09-07 (backend hardening, T50, "не-UUID id в шляху -- 500
// замість 404 (діра non-disclosure)"): id-колонки цих таблиць мають тип
// `uuid` (data-model.md) -- Postgres відхиляє будь-яке значення, що не
// парситься як UUID, ДО того, як WHERE взагалі щось порівнює (код помилки
// 22P02, "invalid input syntax for type uuid"). Це виняток, не "рядок не
// знайдено", тож без обробки він пробивав насквізь до generic 500-гілки
// error-middleware (server/app.ts) -- раптовий Postgres-текст замість
// контрактного non-disclosure 404, який findXById-виклики й так дають для
// звичайного "не існує" (AC-04). Підроблюємо db.query, що кидає саме такий
// об'єкт помилки (та сама форма, що видає реальний драйвер `pg`).

import { findCardById, findEntryById, findMetricBlockById } from './postgres-repo';
import type { Db } from './postgres-repo';

function invalidUuidError(): Error & { code: string } {
  const err = new Error('invalid input syntax for type uuid: "not-a-uuid"') as Error & { code: string };
  err.code = '22P02';
  return err;
}

test('findCardById повертає null (не пробрасує) на не-UUID cardId', async () => {
  const query = vi.fn().mockRejectedValue(invalidUuidError());
  const db: Db = { query };

  await expect(findCardById(db, 'user-1', 'not-a-uuid')).resolves.toBeNull();
});

test('findMetricBlockById повертає null (не пробрасує) на не-UUID metricBlockId', async () => {
  const query = vi.fn().mockRejectedValue(invalidUuidError());
  const db: Db = { query };

  await expect(findMetricBlockById(db, 'not-a-uuid')).resolves.toBeNull();
});

test('findEntryById повертає null (не пробрасує) на не-UUID entryId', async () => {
  const query = vi.fn().mockRejectedValue(invalidUuidError());
  const db: Db = { query };

  await expect(findEntryById(db, 'not-a-uuid')).resolves.toBeNull();
});

test('findCardById все одно пробрасує будь-яку ІНШУ помилку бази (не ковтає реальні збої)', async () => {
  const query = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
  const db: Db = { query };

  await expect(findCardById(db, 'user-1', 'card-1')).rejects.toThrow('connection terminated unexpectedly');
});
