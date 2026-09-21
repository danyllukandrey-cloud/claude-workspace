// Promote staged docs/features/<slug>/migrations/NN_name.up.sql + .down.sql pairs
// into the live plan/app/migrations/ tree (ADR-0006), in the SQL format node-pg-migrate
// expects: one file, "-- Up Migration" / "-- Down Migration" markers.
//
// Наскрізна нумерація через усі фічі (ADR-0006, п.2) — порядок промоції задається
// вручну в масиві TO_PROMOTE нижче, у крос-фічевому порядку (напр. agent's app_user
// перед FK-міграціями life-area-card/structure, що на нього посилаються).
//
// Кожен запуск дописує НОВІ записи з TO_PROMOTE, яких ще нема в migrations/README.md
// (звіряє за staged-шляхом, не за номером) — вже промоучені пари пропускає мовчки.
//
// Review 2026-09-07 (group D remainder, T51, ADR-0006 §Рушії рішення "скрипт
// має вміти сказати «ця пара вже промоучена і відрізняється»"): кожен запис
// у MIGRATIONS.md тепер несе SHA-256 хеш staged-вмісту в момент promote
// (computeContentHash, promote-migrations-lib.mjs) — уже промоучена пара, чий
// поточний staged-вміст більше НЕ збігається з цим хешем (файл відредагували
// ПІСЛЯ promote, порушивши правило "не редагуємо, робимо наступну міграцію"),
// тепер гучно попереджається в консоль, а не мовчки лишається застарілою.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentHash, detectDrift } from './promote-migrations-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const LIVE_DIR = join(__dirname, '..', 'migrations');
// НЕ всередині migrations/ -- node-pg-migrate трактує кожен файл там як міграцію.
const README_PATH = join(__dirname, '..', 'MIGRATIONS.md');

// Крос-фічевий порядок промоції. Додавай сюди нові пари в тому порядку, в якому вони
// мають лягти в живе дерево -- скрипт сам призначить наступний вільний timestamp.
const TO_PROMOTE = [
  { slug: 'agent', staged: '01_create_app_user', name: 'create-app-user' },
  { slug: 'life-area-card', staged: '01_create_card', name: 'create-card' },
  // Хвиля 2 (T2, T4, T38) -- T38 (07_add_owner_fk) іде ОСТАННІМ у цій групі: потребує
  // і card (вище), і app_user (вище) уже застосованими.
  { slug: 'life-area-card', staged: '02_create_metric_block', name: 'create-metric-block' },
  { slug: 'life-area-card', staged: '04_create_card_lifecycle_event', name: 'create-card-lifecycle-event' },
  { slug: 'life-area-card', staged: '07_add_owner_fk', name: 'add-card-owner-fk' },
  // Хвиля 3 (T3, T5)
  { slug: 'life-area-card', staged: '03_create_entry', name: 'create-entry' },
  { slug: 'life-area-card', staged: '05_add_card_status', name: 'add-card-status' },
  // Хвиля 4 (T32) -- T10 не потребує промоції, лише T32 (staged-міграція).
  { slug: 'life-area-card', staged: '06_add_card_restore', name: 'add-card-restore' },
  // D-103: structure's T1/T2/T26 промоучені ПОЗАЧЕРГОВО (structure як фіча ще не
  // стартувала в /sdd:implement) -- закриває D-69 (архівація картки закриває її
  // позицію в розкладці, AC-16). 01 перед 02 (FK на structure), 03 (owner FK)
  // останній -- потребує і structure(01), і agent's app_user (уже вище).
  { slug: 'structure', staged: 'backend/01_create_structure', name: 'create-structure' },
  { slug: 'structure', staged: 'backend/02_create_structure_layout_position', name: 'create-structure-layout-position' },
  { slug: 'structure', staged: 'backend/03_add_owner_fk', name: 'add-structure-owner-fk' },
  // T27 (AC-16, D-83/ISS-7): logic_variant підвид розкладки "за логікою".
  { slug: 'structure', staged: 'backend/04_add_logic_variant', name: 'add-logic-variant' },
  // T3 (AC-15): Літопис Структури — structure_history_event, реальні cross-feature FK
  // (structure_id -> structure, card_id -> card), обидва ON DELETE CASCADE.
  { slug: 'structure', staged: 'backend/05_create_structure_history_event', name: 'create-structure-history-event' },
  // Review 2026-09-11 (AC-11b/AC-16b/AC-17): cell_index стає nullable -- без цього "картка
  // без клітинки" після зміни режиму/підвиду розкладки фізично неможлива (колонка з 02
  // була NOT NULL, а 02 уже промоучена -- правка йде наступною міграцією, ADR-0006).
  { slug: 'structure', staged: 'backend/06_make_cell_index_nullable', name: 'make-cell-index-nullable' },
  // D-127 (US-17/AC-20): архівація окремого блоку-метрики -- лише додає
  // metric_block.status, жодних крос-фічевих залежностей, тож у самому кінці.
  { slug: 'life-area-card', staged: '08_add_metric_block_status', name: 'add-metric-block-status' },
  // "Лог дій" (2026-09-15): нова, повністю незалежна таблиця (лише FK на
  // вже промоучений app_user) -- жодних крос-фічевих залежностей, тож у
  // самому кінці, як і 08 вище.
  { slug: 'agent', staged: '12_create_action_log', name: 'create-action-log' },
  // Вимоги 14/15 (Андрій, чат): 'single' скасовується, три підвиди "за логікою"
  // (D-83) стають топ-рівневими режимами, додається новий 'staging' -- layout_mode
  // + logic_variant (два поля) зливаються в ОДИН layout_mode із 5 значеннями.
  { slug: 'structure', staged: 'backend/07_flatten_layout_mode', name: 'flatten-layout-mode' },
  // Андрій (чат, 2026-09-15): "Прибрати повністю оті клітинки" -- Схема стає
  // вільним полотном (x/y відсотки) зі зв'язками замість фіксованої сітки.
  { slug: 'structure', staged: 'backend/08_add_position_xy', name: 'add-position-xy' },
  { slug: 'structure', staged: 'backend/09_create_structure_connection', name: 'create-structure-connection' },
  // CH-02 (docs/features/life-area-card/changes.md): "картка: стан без
  // вимірювань" -- adds card.tracking_mode/health_state, жодних крос-
  // фічевих залежностей, тож у самому кінці, як і 08/12 вище.
  { slug: 'life-area-card', staged: '09_add_card_tracking_mode', name: 'add-card-tracking-mode' },
  // life-plan-levels T1: нова таблиця plan_item (три горизонти плану). Єдина
  // залежність -- FK на вже промоучений app_user, тож у самому кінці, як і 08/12/09.
  { slug: 'life-plan-levels', staged: '01_create_plan_item', name: 'create-plan-item' },
  // CH-10 (docs/features/life-area-card/changes.md): tracking_mode
  // 'metrics'/'state' -> 'state'/'ongoing'/'goals' -- лише звужує/розширює
  // CHECK на вже наявній колонці (09 вище), жодних нових крос-фічевих
  // залежностей, тож у самому кінці.
  { slug: 'life-area-card', staged: '10_expand_card_tracking_mode', name: 'expand-card-tracking-mode' },
];

function readReadme() {
  if (!existsSync(README_PATH)) return '';
  return readFileSync(README_PATH, 'utf8');
}

if (!existsSync(LIVE_DIR)) mkdirSync(LIVE_DIR, { recursive: true });
if (!existsSync(README_PATH)) {
  writeFileSync(
    README_PATH,
    '# Живе дерево міграцій -- мапа "живий файл <- застейджений файл"\n\n' +
      '> Наскрізна нумерація через усі фічі (ADR-0006). Застейджений файл ПІСЛЯ promote\n' +
      '> не редагуємо -- нова правка йде наступною міграцією (staged-копія лишається\n' +
      '> зафіксованим design-record, git її пам\'ятає). Хеш -- SHA-256 staged up+down\n' +
      '> вмісту В МОМЕНТ promote (computeContentHash) -- наступний запуск скрипта\n' +
      '> звіряє його з поточним staged-вмістом і гучно попереджає при розбіжності.\n\n' +
      '| Живий файл | Застейджений файл | Хеш |\n|---|---|---|\n',
  );
}

let readme = readReadme();
let promotedCount = 0;
let driftCount = 0;

for (const { slug, staged, name } of TO_PROMOTE) {
  const stagedDir = join(REPO_ROOT, 'docs', 'features', slug, 'migrations');
  const upPath = join(stagedDir, `${staged}.up.sql`);
  const downPath = join(stagedDir, `${staged}.down.sql`);

  if (!existsSync(upPath) || !existsSync(downPath)) {
    console.error(`ПРОПУСК: не знайдено ${upPath} чи ${downPath}`);
    continue;
  }

  const up = readFileSync(upPath, 'utf8').trimEnd();
  const down = readFileSync(downPath, 'utf8').trimEnd();
  const currentHash = computeContentHash(up, down);

  const drift = detectDrift(readme, slug, staged, currentHash);

  if (drift.status === 'drift') {
    console.warn(
      `\n⚠️  ДРЕЙФ: ${slug}/migrations/${staged} відредаговано ПІСЛЯ promote -- поточний вміст більше не збігається з тим, що вже в plan/app/migrations/.\n` +
        `   Записаний хеш: ${drift.recordedHash}\n` +
        `   Поточний хеш:  ${currentHash}\n` +
        `   ADR-0006: застейджений файл після promote не редагуємо -- зроби НАСТУПНУ міграцію замість правки цієї. Живий файл НЕ перезаписано автоматично.\n`
    );
    driftCount += 1;
    continue;
  }

  if (drift.status === 'unchanged' || drift.status === 'no_recorded_hash') continue;

  // status === 'not_promoted' -- нова пара, промоутимо.
  // Timestamp зростає з кожним промоутом у цьому запуску, щоб порядок TO_PROMOTE
  // не зламався колізією однакових мілісекунд.
  const ts = Date.now() + promotedCount;
  const liveFileName = `${ts}_${name}.sql`;
  const liveContent = `-- Up Migration\n\n${up}\n\n-- Down Migration\n\n${down}\n`;

  writeFileSync(join(LIVE_DIR, liveFileName), liveContent);
  appendFileSync(README_PATH, `| \`${liveFileName}\` | \`${slug}/migrations/${staged}.{up,down}.sql\` | \`${currentHash}\` |\n`);
  readme = readReadme();

  console.log(`Промоучено: ${liveFileName} <- ${slug}/migrations/${staged}`);
  promotedCount += 1;
}

if (promotedCount === 0 && driftCount === 0) {
  console.log('Нічого нового промоутити -- усе з TO_PROMOTE вже є в migrations/README.md.');
} else {
  console.log(`Готово: ${promotedCount} нових міграцій у plan/app/migrations/, ${driftCount} попереджень про дрейф.`);
}
