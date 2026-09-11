-- structure: revert cell_index back to NOT NULL
-- Staged migration — NOT live.
--
-- ALTER COLUMN ... SET NOT NULL звіряє КОЖЕН наявний рядок одразу і падає, якщо хоч один
-- cell_index дорівнює NULL (той самий клас проблеми, що T51 уже ловив для CHECK-констрейнтів:
-- migrations-down-data-loss.integration.test.ts). Після reset розкладки (AC-11b/AC-16b) таких
-- рядків у живій базі рівно стільки, скільки активних карток, тож down мусить спершу їх заповнити.
--
-- Заглушка — ВІД'ЄМНІ номери, різні в межах однієї Структури (-1, -2, ...): одне й те саме
-- число для всіх зламало б частковий UNIQUE uq_layout_position_active_cell
-- (structure_id, cell_index) WHERE status = 'active' уже на другому рядку. Від'ємні значення
-- поза реальною нумерацією клітинок (0..N), тому вони не конфліктують і з уже розкладеними
-- картками. Порядок (created_at, id) зберігає базовий порядок трею, а не перемішує його.
--
-- Сенс втрати: після down «немає клітинки» стає несправжнім номером клітинки — це НЕ
-- відновлення попереднього стану, а вимушене приведення до старої, менш виразної схеми
-- (у ній стану «без клітинки» просто не існувало).

WITH numbered AS (
    SELECT
        id,
        -row_number() OVER (PARTITION BY structure_id ORDER BY created_at, id) AS filler_cell_index
    FROM structure_layout_position
    WHERE cell_index IS NULL
)
UPDATE structure_layout_position p
SET cell_index = n.filler_cell_index
FROM numbered n
WHERE p.id = n.id;

ALTER TABLE structure_layout_position
    ALTER COLUMN cell_index SET NOT NULL;
