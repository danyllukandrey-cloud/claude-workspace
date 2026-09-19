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
