-- Up Migration

-- structure: make structure_layout_position.cell_index nullable
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Review 2026-09-11 (Частина 1/Частина 2, AC-11b/AC-16b/AC-17): «картка без клітинки»
-- фізично неможлива, поки колонка NOT NULL — reset після зміни режиму/підвиду мусив писати
-- РЕАЛЬНИЙ номер клітинки замість «клітинки немає», тож AC-11b/AC-16b/AC-17 не спостережувані.
-- Міграцію 02 (уже промоучена) не редагуємо — правка йде наступною міграцією (ADR-0006).
--
-- NULL = картка в треї нерозкладених, користувач тягне її на вільну клітинку сам
-- (той самий принцип «NULL = ще не обрано», що вже діє для structure.layout_mode).
--
-- Частковий UNIQUE uq_layout_position_active_cell (structure_id, cell_index) WHERE
-- status = 'active' НЕ чіпаємо: у Postgres два NULL не вважаються рівними, тож будь-яка
-- кількість активних позицій без клітинки в одній Структурі не конфліктує, а обмеження
-- «одна клітинка = одна картка» (AC-02, D-62) для реальних номерів лишається чинним.

ALTER TABLE structure_layout_position
    ALTER COLUMN cell_index DROP NOT NULL;

-- Down Migration

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
