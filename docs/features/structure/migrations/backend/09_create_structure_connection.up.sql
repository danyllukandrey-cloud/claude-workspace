-- structure: create structure_connection
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
--
-- Андрій (чат, 2026-09-15), вимога 4/5: "Між блоками потрібно створити звязки... якщо ми робимо
-- стрілки то нам потрібно буде додати їх як інструментарій можливого з'єднання" — інструмент
-- "Зв'язати" на Схемі створює або звичайну (недирекційну) лінію між двома картками, або напрямлену
-- стрілку (card_id_a -> card_id_b). Той самий стиль, що structure_layout_position: UUID PK,
-- app-генерований (crypto.randomUUID()), FK на card напряму (та сама база, D-59/D-113).

CREATE TABLE IF NOT EXISTS structure_connection (
    id UUID PRIMARY KEY,
    structure_id UUID NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
    card_id_a UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    card_id_b UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    -- true -- стрілка card_id_a -> card_id_b (напрямок значущий);
    -- false -- звичайна лінія (порядок a/b не несе сенсу, лише пара карток).
    directed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Список зв'язків Структури (екран Схема читає всі одразу разом з позиціями).
CREATE INDEX IF NOT EXISTS idx_structure_connection_structure
    ON structure_connection (structure_id);

-- Жодного UNIQUE на (card_id_a, card_id_b) навмисно: авто-розклад режиму "причина і наслідок"
-- (домен, domain/layout.ts) сам гарантує, що кожна пара з'являється рівно раз у своєму плані, а
-- ручне створення через інструмент "Зв'язати" — це свідома дія користувача щоразу; заборона
-- дубля на рівні БД ускладнила б "розʼєднати й перезʼєднати" (вимога 4 в чаті) без явної користі.
