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
