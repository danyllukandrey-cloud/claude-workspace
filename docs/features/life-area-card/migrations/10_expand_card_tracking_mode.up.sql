-- life-area-card: CH-10 (docs/features/life-area-card/changes.md) --
-- expands card.tracking_mode from 2 values ('metrics' | 'state') to 3
-- ('state' | 'ongoing' | 'goals'). Live тестування 2026-09-21: одна назва
-- "Постійний процес з метриками (без дати)" одночасно позначала і режим
-- картки, і чекбокс у формі блоку-метрики -- та сама назва, різні речі,
-- плутало. Розведено на два окремі режими картки:
--   'ongoing' -- метрики без цілі/дати взагалі (форма показує лише
--                "Що рахуємо"+"Одиниця", "Постійний процес" більше не
--                окреме поле -- це вже значення режиму картки).
--   'goals'   -- те, чим "metrics" був раніше: ціль+дата в блоці-метриці.
-- Staged migration — NOT live. Promoted (real sequence number assigned) by db:promote.
--
-- Порядок навмисний: старий CHECK (і комбінований health_state-constraint,
-- що явно згадує 'metrics') мусить піти ДО backfill -- 'goals' порушив би
-- його; backfill мусить піти ДО нового CHECK -- інакше ADD CONSTRAINT сам
-- впаде на ще незмінених рядках (Postgres валідує ВСІ наявні рядки одразу,
-- якщо не додати NOT VALID).

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS card_health_state_requires_state_tracking;

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS card_tracking_mode_check;

-- Існуючі картки з trackingMode='metrics' зберігали ціль/дату в блоках --
-- 'goals' лишається найбільш сумісним вибором, нічого в даних не втрачається.
UPDATE card SET tracking_mode = 'goals' WHERE tracking_mode = 'metrics';

ALTER TABLE card
    ADD CONSTRAINT card_tracking_mode_check
        CHECK (tracking_mode IN ('state', 'ongoing', 'goals'));

ALTER TABLE card
    ALTER COLUMN tracking_mode SET DEFAULT 'goals';

-- Узагальнено на булеву еквівалентність (замість переліку значень, крім
-- 'state') -- працює для будь-якої кількості не-'state' режимів, не лише
-- рівно двох, тож наступний режим не вимагатиме чіпати цей constraint знову.
ALTER TABLE card
    ADD CONSTRAINT card_health_state_requires_state_tracking
        CHECK ((tracking_mode = 'state') = (health_state IS NOT NULL));
