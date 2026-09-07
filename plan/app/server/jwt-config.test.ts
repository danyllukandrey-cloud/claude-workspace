// Review 2026-09-07 (backend hardening, T50, "слабкий JWT_SECRET без
// перевірки довжини"): index.ts (composition root) раніше приймало
// process.env.JWT_SECRET будь-якої довжини, аби він взагалі був заданий
// (`if (!JWT_SECRET) throw`) -- закороткий ключ підпису робить HS256-підпис
// підбірним brute-force. index.ts сам НЕ юніт-тестується (шапка файлу:
// "реальна мережа/БД/Google" -- покриття лише test:integration/ручний
// прогін), тому перевірка винесена в цю чисту функцію (той самий підхід, що
// App.tsx винесено з main.tsx для тестованості).

import { assertJwtSigningKeyStrength, MIN_JWT_SIGNING_KEY_BYTES } from './jwt-config';

test(`кидає для ключа коротшого за ${MIN_JWT_SIGNING_KEY_BYTES} байт`, () => {
  const shortKey = 'a'.repeat(MIN_JWT_SIGNING_KEY_BYTES - 1);

  expect(() => assertJwtSigningKeyStrength(shortKey)).toThrow(/32/);
});

test(`не кидає для ключа рівно ${MIN_JWT_SIGNING_KEY_BYTES} байт`, () => {
  const exactKey = 'a'.repeat(MIN_JWT_SIGNING_KEY_BYTES);

  expect(() => assertJwtSigningKeyStrength(exactKey)).not.toThrow();
});

test('не кидає для довшого ключа', () => {
  const longKey = 'a'.repeat(64);

  expect(() => assertJwtSigningKeyStrength(longKey)).not.toThrow();
});

test('рахує БАЙТИ (UTF-8), не символи -- багатобайтові символи не можуть штучно "подовжити" закороткий ключ', () => {
  // 20 кириличних символів -- 2 байти кожен у UTF-8 = 40 байт (>=32 за
  // байтами), але лише 20 ЗА СИМВОЛАМИ (<32) -- якби перевірка рахувала
  // символи (.length), цей ключ помилково вважався б закоротким.
  const cyrillicKey = 'а'.repeat(20);

  expect(() => assertJwtSigningKeyStrength(cyrillicKey)).not.toThrow();
});
