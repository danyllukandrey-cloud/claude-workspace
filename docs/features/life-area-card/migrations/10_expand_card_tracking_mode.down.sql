-- life-area-card: revert card.tracking_mode 'ongoing'/'goals' split back to 'metrics' (CH-10)
-- Staged migration — NOT live.
--
-- DATA LOSS (той самий "deliberate trade-off" підхід, що 06_add_card_restore's
-- down-migration): 'ongoing' і 'goals' обидва згортаються назад у 'metrics' --
-- різниця між "без цілі" й "з ціллю", яку CH-10 увів, губиться на відкаті.
-- Це навмисно, не недогляд.

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS card_health_state_requires_state_tracking;

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS card_tracking_mode_check;

UPDATE card SET tracking_mode = 'metrics' WHERE tracking_mode IN ('ongoing', 'goals');

ALTER TABLE card
    ALTER COLUMN tracking_mode SET DEFAULT 'metrics';

ALTER TABLE card
    ADD CONSTRAINT card_tracking_mode_check
        CHECK (tracking_mode IN ('metrics', 'state'));

ALTER TABLE card
    ADD CONSTRAINT card_health_state_requires_state_tracking
        CHECK (
            (tracking_mode = 'state' AND health_state IS NOT NULL)
            OR (tracking_mode = 'metrics' AND health_state IS NULL)
        );
