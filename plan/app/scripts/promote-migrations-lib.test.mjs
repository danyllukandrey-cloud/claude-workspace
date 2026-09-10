// Review 2026-09-07 (group D remainder, T51, ADR-0006 §Рушії рішення
// "скрипт-склейка міграцій -- нова поверхня для дрейфу... скрипт має вміти
// сказати «ця пара вже промоучена і відрізняється»"): promote-migrations.mjs
// раніше вважав пару "вже промоучено" за самою ПРИСУТНІСТЮ staged-шляху в
// MIGRATIONS.md (alreadyPromoted), незалежно від вмісту -- якщо застейджений
// .up.sql/.down.sql відредагували ПІСЛЯ promote (порушуючи правило "після
// promote не редагуємо"), живе дерево мовчки лишалось застарілим, ніхто про
// це не дізнавався.
//
// Чисті функції винесені в окремий lib-модуль (той самий підхід, що App.tsx
// з main.tsx, jwt-config.ts з index.ts) -- сам promote-migrations.mjs лишається
// тонким запускачем із побічними ефектами (читає/пише реальні файли
// репозиторію), тому НЕ юніт-тестується напряму.

import { computeContentHash, detectDrift } from './promote-migrations-lib.mjs';

test('computeContentHash повертає однаковий хеш для того самого вмісту, різний -- для різного', () => {
  const hashA = computeContentHash('CREATE TABLE foo (id uuid);', 'DROP TABLE foo;');
  const hashB = computeContentHash('CREATE TABLE foo (id uuid);', 'DROP TABLE foo;');
  const hashC = computeContentHash('CREATE TABLE foo (id uuid, name text);', 'DROP TABLE foo;');

  expect(hashA).toBe(hashB);
  expect(hashA).not.toBe(hashC);
});

// Виявлено живим прогоном на цій самій задачі (Windows, core.autocrlf=true):
// `git checkout --` на щойно відредагований staged-файл повернув його з CRLF
// замість LF (git нормалізує до LF у самому сховищі, але матеріалізує CRLF в
// робочому дереві) -- без нормалізації тут ЦЕ САМЕ по собі виглядало б як
// "дрейф", хоча жоден символ SQL не змінився. Хешувати треба логічний
// вміст, не байти конкретного checkout.
test('computeContentHash ігнорує CRLF vs LF -- те саме логічне SQL дає той самий хеш незалежно від закінчень рядків', () => {
  const lf = 'CREATE TABLE foo (\n    id uuid\n);';
  const crlf = 'CREATE TABLE foo (\r\n    id uuid\r\n);';

  expect(computeContentHash(lf, 'DROP TABLE foo;')).toBe(computeContentHash(crlf, 'DROP TABLE foo;'));
});

test('detectDrift: staged-пара, якої ще нема в README -- "not_promoted"', () => {
  const readme = '| Живий файл | Застейджений файл | Хеш |\n|---|---|---|\n';

  const result = detectDrift(readme, 'life-area-card', '01_create_card', 'abc123');

  expect(result.status).toBe('not_promoted');
});

test('detectDrift: той самий хеш, що записаний при promote -- "unchanged"', () => {
  const hash = computeContentHash('up sql', 'down sql');
  const readme =
    '| Живий файл | Застейджений файл | Хеш |\n|---|---|---|\n' +
    `| \`123_create-card.sql\` | \`life-area-card/migrations/01_create_card.{up,down}.sql\` | \`${hash}\` |\n`;

  const result = detectDrift(readme, 'life-area-card', '01_create_card', hash);

  expect(result.status).toBe('unchanged');
});

test('detectDrift: staged-файл відредагували ПІСЛЯ promote (хеш не збігається) -- "drift"', () => {
  const oldHash = computeContentHash('up sql v1', 'down sql v1');
  const newHash = computeContentHash('up sql v2 (відредаговано після promote)', 'down sql v1');
  const readme =
    '| Живий файл | Застейджений файл | Хеш |\n|---|---|---|\n' +
    `| \`123_create-card.sql\` | \`life-area-card/migrations/01_create_card.{up,down}.sql\` | \`${oldHash}\` |\n`;

  const result = detectDrift(readme, 'life-area-card', '01_create_card', newHash);

  expect(result.status).toBe('drift');
  expect(result.recordedHash).toBe(oldHash);
});

test('detectDrift: рядок без хеша (записаний до цього фіксу) -- "no_recorded_hash", не хибний "drift"', () => {
  const readme =
    '| Живий файл | Застейджений файл |\n|---|---|\n' +
    '| `123_create-card.sql` | `life-area-card/migrations/01_create_card.{up,down}.sql` |\n';

  const result = detectDrift(readme, 'life-area-card', '01_create_card', 'будь-який-хеш');

  expect(result.status).toBe('no_recorded_hash');
});

test('detectDrift: не плутає staged-шляхи з однаковим префіксом (01_create_card vs 01_create_card_extra)', () => {
  const hash = computeContentHash('up', 'down');
  const readme =
    '| Живий файл | Застейджений файл | Хеш |\n|---|---|---|\n' +
    `| \`1_x.sql\` | \`life-area-card/migrations/01_create_card_extra.{up,down}.sql\` | \`${hash}\` |\n`;

  const result = detectDrift(readme, 'life-area-card', '01_create_card', 'будь-який-хеш');

  expect(result.status).toBe('not_promoted');
});
