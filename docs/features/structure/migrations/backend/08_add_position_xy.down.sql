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
