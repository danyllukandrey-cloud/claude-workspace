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

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
];

function readReadme() {
  if (!existsSync(README_PATH)) return '';
  return readFileSync(README_PATH, 'utf8');
}

function alreadyPromoted(readmeText, slug, staged) {
  return readmeText.includes(`${slug}/migrations/${staged}`);
}

if (!existsSync(LIVE_DIR)) mkdirSync(LIVE_DIR, { recursive: true });
if (!existsSync(README_PATH)) {
  writeFileSync(
    README_PATH,
    '# Живе дерево міграцій -- мапа "живий файл <- застейджений файл"\n\n' +
      '> Наскрізна нумерація через усі фічі (ADR-0006). Застейджений файл ПІСЛЯ promote\n' +
      '> не редагуємо -- нова правка йде наступною міграцією (staged-копія лишається\n' +
      '> зафіксованим design-record, git її пам\'ятає).\n\n' +
      '| Живий файл | Застейджений файл |\n|---|---|\n',
  );
}

let readme = readReadme();
let promotedCount = 0;

for (const { slug, staged, name } of TO_PROMOTE) {
  if (alreadyPromoted(readme, slug, staged)) continue;

  const stagedDir = join(REPO_ROOT, 'docs', 'features', slug, 'migrations');
  const upPath = join(stagedDir, `${staged}.up.sql`);
  const downPath = join(stagedDir, `${staged}.down.sql`);

  if (!existsSync(upPath) || !existsSync(downPath)) {
    console.error(`ПРОПУСК: не знайдено ${upPath} чи ${downPath}`);
    continue;
  }

  const up = readFileSync(upPath, 'utf8').trimEnd();
  const down = readFileSync(downPath, 'utf8').trimEnd();

  // Timestamp зростає з кожним промоутом у цьому запуску, щоб порядок TO_PROMOTE
  // не зламався колізією однакових мілісекунд.
  const ts = Date.now() + promotedCount;
  const liveFileName = `${ts}_${name}.sql`;
  const liveContent = `-- Up Migration\n\n${up}\n\n-- Down Migration\n\n${down}\n`;

  writeFileSync(join(LIVE_DIR, liveFileName), liveContent);
  appendFileSync(README_PATH, `| \`${liveFileName}\` | \`${slug}/migrations/${staged}.{up,down}.sql\` |\n`);
  readme = readReadme();

  console.log(`Промоучено: ${liveFileName} <- ${slug}/migrations/${staged}`);
  promotedCount += 1;
}

if (promotedCount === 0) {
  console.log('Нічого нового промоутити -- усе з TO_PROMOTE вже є в migrations/README.md.');
} else {
  console.log(`Готово: ${promotedCount} нових міграцій у plan/app/migrations/.`);
}
