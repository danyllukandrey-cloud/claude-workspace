-- Up Migration

-- structure: flatten layout_mode + logic_variant into ONE 5-value layout_mode enum
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
--
-- Андрій (вимоги 14/15, чат): "Одна картка" ('single') скасовується як концепція взагалі —
-- навіщо режим "одна картка", якщо картку й так можна створити рівно одну. Три підвиди
-- "за логікою" (balance / focus / cause_effect, D-83) перестають бути вкладеним підвидом
-- і стають топ-рівневими режимами нарівні з 'free'. Новий режим 'staging' ("готово до
-- розкладання") додається — картки з'являються внизу екрана без клітинки, користувач сам
-- розкладає. Підсумок: 5 значень у ОДНОМУ полі замість 3×3 дворівневої комбінації.
--
-- Крок 1 (перевірка живих даних, Neon, 2026-09-15, прямий SQL SELECT layout_mode,
-- logic_variant, count(*) FROM structure GROUP BY ...): рівно 2 рядки structure у проді —
-- {layout_mode: NULL, logic_variant: NULL} і {layout_mode: 'free', logic_variant: NULL}.
-- Жодного 'single', жодного 'logic'+variant рядка живим не було — трансформація нижче все
-- одно написана узагальнено (інші середовища/майбутні рядки можуть мати ці значення).

ALTER TABLE structure DROP CONSTRAINT structure_layout_mode_check;

-- layout_mode='logic' + logic_variant=X -> layout_mode=X напряму: підвид більше не
-- вкладений, він сам стає режимом.
UPDATE structure
SET layout_mode = logic_variant
WHERE layout_mode = 'logic' AND logic_variant IS NOT NULL;

-- layout_mode='single' -> NULL ("режим ще не обрано наново"), НЕ 'free'. Рішення пояснене
-- в summary staged-міграції: 'single' означав "рівно одна картка на екрані" — це інша
-- заява, ніж 'free' ("багато карток без порядку"), і мовчки перепризначити на 'free' було б
-- приписати користувачу вибір, якого він не робив. NULL — той самий принцип "не обрано",
-- що вже діє для AC-09 (немає вибору — не блокує); користувач обирає режим заново на
-- екрані Декларація.
UPDATE structure
SET layout_mode = NULL
WHERE layout_mode = 'single';

ALTER TABLE structure
    ADD CONSTRAINT structure_layout_mode_check
        CHECK (layout_mode IN ('balance', 'focus', 'cause_effect', 'free', 'staging'));

-- Підвид більше не існує окремо від режиму (одне поле, не два) — logic_variant прибирається
-- повністю, а не лишається невикористаним стовпцем.
ALTER TABLE structure DROP COLUMN logic_variant;

-- Down Migration

-- structure: revert the flattened layout_mode back to layout_mode + logic_variant (two-field model)
-- Staged migration — NOT live.
--
-- Сенс втрати (той самий шаблон коментаря, що 06_make_cell_index_nullable.down.sql): down НЕ
-- відновлює точний стан ДО up. 'staging' — новий режим, якого у дворівневій моделі не існувало
-- взагалі, тож down не може "згадати", чим рядок був раніше — мапиться на найближчий старий
-- еквівалент 'free' (обидва: "без заданої логічної схеми, розкладка вручну"). 'single', стертий
-- на up у NULL, теж не відновлюється — факт "рядок КОЛИСЬ був 'single'" уже загублений під час up,
-- відновлювати нема з чого.

ALTER TABLE structure DROP CONSTRAINT structure_layout_mode_check;

ALTER TABLE structure
    ADD COLUMN logic_variant TEXT NULL
        CHECK (logic_variant IN ('balance', 'focus', 'cause_effect'));

-- Три колишні топ-рівневі режими повертаються під layout_mode='logic' + logic_variant=X.
UPDATE structure
SET logic_variant = layout_mode,
    layout_mode = 'logic'
WHERE layout_mode IN ('balance', 'focus', 'cause_effect');

-- 'staging' -- лоссі fallback на 'free' (пояснення вище).
UPDATE structure
SET layout_mode = 'free'
WHERE layout_mode = 'staging';

ALTER TABLE structure
    ADD CONSTRAINT structure_layout_mode_check
        CHECK (layout_mode IN ('single', 'free', 'logic'));
