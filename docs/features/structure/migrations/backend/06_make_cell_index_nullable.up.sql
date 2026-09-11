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
