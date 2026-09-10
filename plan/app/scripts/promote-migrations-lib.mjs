// Чиста логіка promote-migrations.mjs, винесена сюди САМЕ для тестованості --
// сам promote-migrations.mjs лишається тонким запускачем (читає/пише реальні
// файли репозиторію на рівні модуля), тому НЕ юніт-тестується напряму (той
// самий підхід, що App.tsx з main.tsx, jwt-config.ts з index.ts).
//
// ADR-0006 §Рушії рішення ("скрипт-склейка міграцій -- нова поверхня для
// дрейфу"): "скрипт має вміти сказати «ця пара вже промоучена і
// відрізняється»" -- detectDrift нижче саме це й робить, звіряючи хеш
// поточного staged-вмісту з хешем, записаним у MIGRATIONS.md у момент
// promote.

import { createHash } from 'node:crypto';

/**
 * Windows/git core.autocrlf: `git checkout` матеріалізує CRLF в робочому
 * дереві для файлів, які git зберігає як LF -- виявлено живим прогоном на
 * цій самій задачі, коли звичайнісінький `git checkout --` (без жодної
 * зміни SQL) сам по собі змінив хеш файлу. Нормалізуємо до LF ПЕРЕД
 * хешуванням, щоб дрейф відображав зміну логічного вмісту, не випадковість
 * checkout/git-конфігурації конкретної машини.
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

/** SHA-256 гекс-хеш staged up+down вмісту в момент promote -- підстава для виявлення дрейфу нижче. */
export function computeContentHash(up, down) {
  return createHash('sha256')
    .update(normalizeLineEndings(up))
    .update('\n---\n')
    .update(normalizeLineEndings(down))
    .digest('hex');
}

/**
 * Рядок таблиці MIGRATIONS.md, що містить саме цей staged-шлях (`slug/migrations/staged`),
 * чи null, якщо пара ще не промоучена. Межа шляху -- крапка чи закриваюча лапка
 * одразу після staged (`.{up,down}.sql` чи кінець рядка з лапкою) -- без цього
 * "01_create_card" збігся б і з "01_create_card_extra".
 */
function findPromotedRow(readmeText, slug, staged) {
  const marker = `${slug}/migrations/${staged}`;
  return (
    readmeText.split('\n').find((line) => {
      const index = line.indexOf(marker);
      if (index === -1) return false;
      const nextChar = line[index + marker.length];
      return nextChar === '.' || nextChar === '`';
    }) ?? null
  );
}

/** Третя комірка `| live | staged | hash |` рядка таблиці, якщо є -- старі рядки (до цього фіксу) мають лише дві комірки. */
function extractRecordedHash(row) {
  const cells = row
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const hashCell = cells[2];
  if (!hashCell) return null;
  return hashCell.replace(/`/g, '');
}

/**
 * status: 'not_promoted' (нема рядка -- скрипт може вільно промоутити),
 * 'unchanged' (хеш збігається -- пропустити мовчки, як і раніше),
 * 'drift' (хеш є, але відрізняється -- staged відредаговано ПІСЛЯ promote,
 * попереджаємо ГОЛОСНО, не блокуємо запуск і не переписуємо живий файл
 * автоматично -- ADR-0006 каже "робимо наступну міграцію", не "тихо
 * перезаписуємо історію"), 'no_recorded_hash' (рядок є, але без третьої
 * комірки -- записаний до цього фіксу, порівнювати нема з чим).
 */
export function detectDrift(readmeText, slug, staged, currentHash) {
  const row = findPromotedRow(readmeText, slug, staged);
  if (!row) return { status: 'not_promoted' };

  const recordedHash = extractRecordedHash(row);
  if (recordedHash === null) return { status: 'no_recorded_hash' };
  if (recordedHash !== currentHash) return { status: 'drift', recordedHash };
  return { status: 'unchanged' };
}
