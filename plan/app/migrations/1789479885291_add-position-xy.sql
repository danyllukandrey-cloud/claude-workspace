-- Up Migration

-- structure_layout_position: replace the fixed cell_index grid with free-form x/y canvas coordinates
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
--
-- Андрій (чат, 2026-09-15): "Схема не працює і вона жахлива. Пропоную прибрати повністю оті
-- клітинки." Схема стає вільним полотном (canvas) зі зв'язками, не сіткою пронумерованих
-- клітинок — картки перетягуються (миша й дотик) на будь-яку точку, координата зберігається як
-- відсоток (0-100) розміру канви, не номер клітинки.
--
-- Крок 1: додаємо position_x/position_y як NULLABLE REAL — той самий принцип "NULL = картка без
-- позиції" (трей нерозкладених знизу екрана), що вже діяв для cell_index (міграція 06).

ALTER TABLE structure_layout_position
    ADD COLUMN position_x REAL NULL,
    ADD COLUMN position_y REAL NULL;

-- Крок 2 (трансформація живих даних, Neon, 2026-09-15, перевірено прямим SQL SELECT card_id,
-- cell_index, status FROM structure_layout_position): рівно 3 active-рядки з cell_index 0/1/2
-- (картки "Філософія"/"Інвестиції"/"Побут") + 1 closed-рядок. Розкладаємо активні по горизонталі,
-- по центру висоти канви — та сама відносна послідовність зліва направо, що вони мали в
-- клітинках 0/1/2, не втрачена, лише перевиражена у відсотках канви замість номера клітинки.

UPDATE structure_layout_position SET position_x = 20, position_y = 50 WHERE cell_index = 0 AND status = 'active';
UPDATE structure_layout_position SET position_x = 50, position_y = 50 WHERE cell_index = 1 AND status = 'active';
UPDATE structure_layout_position SET position_x = 80, position_y = 50 WHERE cell_index = 2 AND status = 'active';
-- Будь-який інший наявний рядок (closed, чи гіпотетичний cell_index поза 0..2 в іншому
-- середовищі) лишається position_x/position_y = NULL (трей нерозкладених) — жодного
-- детермінованого сенсу для довільного номера клітинки на вільному полотні немає, чесне
-- "не розкладено" краще за вигадану координату.

-- Крок 3: cell_index більше не читається жодним живим кодом (domain/layout.ts переписаний на
-- x/y, D-131-наступне рішення) — колонку прибираємо, а не лишаємо мертвою: мертва колонка, яку
-- код більше не пише й не читає, — джерело майбутньої плутанини ("чи це ще щось означає?"),
-- гірше за постійне посилання в MIGRATIONS.md на цю ж staged-міграцію, якщо колись знадобиться
-- згадати, як саме рахувались старі клітинки. Частковий унікальний індекс на (structure_id,
-- cell_index) втрачає сенс разом із колонкою — вільне позиціювання дозволяє картки, що
-- перекриваються, це НЕ помилка (той самий принцип, що вимога 3 в чаті: "пересуватись вільно").

ALTER TABLE structure_layout_position DROP CONSTRAINT IF EXISTS uq_layout_position_active_cell;
ALTER TABLE structure_layout_position DROP COLUMN cell_index;

-- Down Migration

-- structure_layout_position: revert free-form x/y back to cell_index
-- Staged migration — NOT live.
--
-- LOSSY (той самий принцип, що 06_make_cell_index_nullable.down.sql): down НЕ відновлює точні
-- координати користувача, лише робить колонку cell_index знову існуючою й заповненою чимось
-- узгодженим. Вільно розставлені x/y не мають єдиного природного мапінгу назад у номер клітинки
-- фіксованої сітки — ранжуємо зверху вниз, зліва направо (position_y, потім position_x) і
-- нумеруємо послідовно від 0: найближчий чесний еквівалент "порядку на екрані", не точне
-- відновлення старої схеми.

ALTER TABLE structure_layout_position ADD COLUMN cell_index INTEGER NULL;

WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY structure_id
            ORDER BY position_y NULLS LAST, position_x NULLS LAST, created_at, id
        ) - 1 AS rn
    FROM structure_layout_position
    WHERE position_x IS NOT NULL AND position_y IS NOT NULL AND status = 'active'
)
UPDATE structure_layout_position p
SET cell_index = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

-- Картки без позиції (трей) лишаються cell_index NULL — той самий стан, що NULL уже означав до
-- up (міграція 06 уже зробила колонку nullable раніше, до цього фіксу).

ALTER TABLE structure_layout_position DROP COLUMN position_x;
ALTER TABLE structure_layout_position DROP COLUMN position_y;

-- Частковий UNIQUE, знятий на up, навмисно НЕ відновлюємо тут: після ранжування вище кілька
-- рядків з різних "рангів" можуть випадково збігтись у номері лише якщо ranked.rn перетнеться
-- між структурами — цього не станеться (PARTITION BY structure_id), тож відновлення було б
-- безпечним, але старий уже прибраний спосіб (клітинки) свідомо не реанімується цим down —
-- він лише повертає СХЕМУ (колонку), не інваріант, що на ній стояв.
