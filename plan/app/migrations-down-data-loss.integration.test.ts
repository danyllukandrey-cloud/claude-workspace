// Review 2026-09-07 (group D remainder, T51, "down-міграції ламаються на
// непорожній базі (CHECK-констрейнт)"): 05_add_card_status.down.sql і
// 06_add_card_restore.down.sql обидва re-add card_lifecycle_event_transition_check
// з ВУЖЧИМ набором дозволених значень ('archived'/'restored' виключені) --
// Postgres звіряє КОЖЕН наявний рядок з новим CHECK одразу при ADD CONSTRAINT,
// тому запуск down-міграції на базі, де вже стався хоч один архів/розархів,
// падав із порушенням constraint замість повернення до робочої схеми.
//
// Виконуємо ДІЙСНИЙ SQL із живого файлу migrations/ (не переписаний вручну
// текст тут -- правило єдиного джерела), в межах транзакції, яку відкочуємо
// наприкінці -- Postgres DDL транзакційний, тому це безпечно проти спільної
// живої Neon-бази (жоден інший тест цього не побачить).
//
// Запуск: npm run test:integration.

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено
  }
});

/** Down-Migration-секція живого файлу -- той самий SQL, що node-pg-migrate виконає при `migrate:down`. */
function readDownMigration(fileName: string): string {
  const fullText = readFileSync(join(__dirname, 'migrations', fileName), 'utf8');
  const marker = '-- Down Migration';
  const index = fullText.indexOf(marker);
  if (index === -1) throw new Error(`${fileName}: маркер "${marker}" не знайдено`);
  return fullText.slice(index + marker.length);
}

async function insertCardWithLifecycleEvent(
  client: Client,
  transition: string
): Promise<{ ownerId: string; cardId: string }> {
  const ownerId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
    ownerId,
    `t51-down-migration-${cardId}`,
    `t51-${cardId}@example.test`,
  ]);
  await client.query('INSERT INTO card (id, owner_user_id, name, status) VALUES ($1, $2, $3, $4)', [
    cardId,
    ownerId,
    'T51 down-migration test',
    'archived',
  ]);
  await client.query('INSERT INTO card_lifecycle_event (id, card_id, transition) VALUES (gen_random_uuid(), $1, $2)', [
    cardId,
    transition,
  ]);
  return { ownerId, cardId };
}

describe('T51: card_lifecycle_event down migrations на непорожній базі — проти реальної Neon', () => {
  it('05_add_card_status down-migration не падає з existing transition=archived, і рядок дійсно видалено', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const { cardId } = await insertCardWithLifecycleEvent(client, 'archived');

      const downSql = readDownMigration('1788614654221_add-card-status.sql');
      await expect(client.query(downSql)).resolves.not.toThrow();

      const { rows } = await client.query('SELECT transition FROM card_lifecycle_event WHERE card_id = $1', [cardId]);
      // Задокументований data-loss (не помилка тесту) -- рядок з 'archived' мав зникнути,
      // бо narrower CHECK інакше відхилив би ADD CONSTRAINT вище.
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK'); // DDL теж транзакційний у Postgres -- живу схему не зачіпаємо.
      await client.end();
    }
  });

  it('06_add_card_restore down-migration не падає з existing transition=restored, і рядок дійсно видалено', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const { cardId } = await insertCardWithLifecycleEvent(client, 'restored');

      const downSql = readDownMigration('1788615576576_add-card-restore.sql');
      await expect(client.query(downSql)).resolves.not.toThrow();

      const { rows } = await client.query('SELECT transition FROM card_lifecycle_event WHERE card_id = $1', [cardId]);
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('05_add_card_status down-migration лишає інші transition-рядки тієї ж картки читомими (лише archived видаляється)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const { cardId } = await insertCardWithLifecycleEvent(client, 'archived');
      await client.query("INSERT INTO card_lifecycle_event (id, card_id, transition) VALUES (gen_random_uuid(), $1, 'created')", [
        cardId,
      ]);

      const downSql = readDownMigration('1788614654221_add-card-status.sql');
      await client.query(downSql);

      const { rows } = await client.query<{ transition: string }>(
        'SELECT transition FROM card_lifecycle_event WHERE card_id = $1',
        [cardId]
      );
      expect(rows.map((row) => row.transition)).toEqual(['created']);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

// D-131-наступне рішення (Андрій, чат, 2026-09-15): staged-міграція 08
// (add_position_xy) СУПЕРСЕДУЄ 06_make_cell_index_nullable -- вона DROP-ає
// саму колонку `cell_index`, яку 06's down-SQL намагається `ALTER COLUMN ...
// SET NOT NULL`. Виконати 06's down-SQL проти живої (повністю мігрованої, з
// 08 застосованою) схеми більше неможливо -- колонки, яку він шукає, вже
// немає (не помилка тесту, властивість самого ланцюга міграцій: down
// відкочується у ЗВОРОТНОМУ порядку, 09→08→07→...→06, ніколи не "06 окремо
// поверх усього"). Стара сценарна перевірка ("06_make_cell_index_nullable
// down-migration...") прибрана разом із цим переходом; аналогічна перевірка
// нижче тестує ТОЙ САМИЙ клас проблеми (SET NOT NULL / narrower constraint
// проти непорожньої таблиці) для 08's власного down.sql.
describe('08_add_position_xy down-migration на непорожній базі — проти реальної Neon', () => {
  it('не падає, коли в таблиці є кілька активних позицій із x/y, і ранжує їх у cell_index за (y, x)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      const cardOneId = crypto.randomUUID();
      const cardTwoId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-down-08-${ownerId}`,
        'down-08@example.test',
      ]);
      await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardOneId, ownerId, 'down 08 one']);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardTwoId, ownerId, 'down 08 two']);
      const positionOneId = crypto.randomUUID();
      const positionTwoId = crypto.randomUUID();
      await client.query(
        'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 80, 50)',
        [positionOneId, structureId, cardOneId]
      );
      await client.query(
        'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 20, 50)',
        [positionTwoId, structureId, cardTwoId]
      );

      const downSql = readDownMigration('1789479885291_add-position-xy.sql');
      await expect(client.query(downSql)).resolves.not.toThrow();

      const { rows } = await client.query<{ id: string; cell_index: number }>(
        'SELECT id, cell_index FROM structure_layout_position WHERE structure_id = $1 ORDER BY cell_index',
        [structureId]
      );
      // Задокументований data-loss (не помилка тесту): координати x/y
      // втрачені, лишається лише відносний порядок (менший x -> менший
      // cell_index) -- positionTwoId (x=20) стає клітинкою 0, positionOneId (x=80) -- 1.
      expect(rows.map((row) => row.id)).toEqual([positionTwoId, positionOneId]);
      expect(rows.map((row) => row.cell_index)).toEqual([0, 1]);
    } finally {
      await client.query('ROLLBACK'); // DDL транзакційний у Postgres -- живу схему не зачіпаємо.
      await client.end();
    }
  });
});
