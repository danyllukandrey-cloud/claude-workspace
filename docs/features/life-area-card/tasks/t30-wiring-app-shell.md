---
id: T30
title: "Wiring: register life-area-card module + backend transport (Express)"
layer: "wiring"
deps: ["T25", "T26", "T27", "T28", "T29", "T36", "T37"]
acs: []
files_hint: ["plan/app/src/cards/life-area-card/index.ts", "plan/app/src/app/main.tsx", "plan/app/server/ (composition root, ADR-0006)"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T30 — Wiring: register life-area-card module + backend transport

## Why

Реєстрація модуля в app-shell — той самий патерн, що вже застосований у `structure`'s T24/`agent`'s T29. Крім цього — [D-107](../../../DECISIONS.md#d-107)/[ISS-45](../../../ISSUES.md): `ports/*.ts` (T21-T23, T35) написані framework-agnostic саме в очікуванні цього кроку — без нього застосунок не здатний реально відповісти на жоден HTTP-запит, попри готовий use-case- і ports-шар.

## What

Дві частини, та сама задача (розширено D-107, раніше — лише перша):

1. **Frontend:** Колода — типовий екран (чи один із них поруч із Чатом `agent`, порядок навігації — деталь реалізації). Один код картки-типу назавжди (D-23), реєструється один раз в `index.ts`.
2. **Backend (нове, D-107):** composition root `plan/app/server/` (ADR-0006 §Обґрунтування — поза `src/`, куди дотягується Vite, щоб ключ Claude API не потрапив у браузерний бандл) — `express()` застосунок, монтування `ports/*.ts` (card-handlers/metric-block-handlers/entry-handlers) на реальні маршрути `/api/v1/...` за `contracts/openapi.yaml`, error-middleware на `AppError` (ADR-0006 §Обґрунтування, "Envelope помилки"), `app.listen()`.
3. **Ендпоінт сесії (нове, D-109):** `POST /api/v1/session` — обмін Google ID-токена на власний JWT, точна форма запиту/відповіді й кроки хендлера в [ADR-0006 §Додаток: Ендпоінт сесії](../../../adr/0006-backend-http-and-migration-tool.md#додаток-ендпоінт-сесії-d-109). Не входить у жоден `openapi.yaml` — це інфраструктура composition root, не product-AC. Спільний auth-middleware перевіряє цей JWT на решті маршрутів усіх трьох фіч.

## Definition of Done

- [x] Застосунок запускається з Колодою, доступною з навігації
- [x] `index.ts` відповідає `sad.md §5`
- [x] `plan/app/server/` реально піднімає Express, усі змонтовані маршрути відповідають формою за `contracts/openapi.yaml` (контрактний тест — ADR-0006 §Рішення, п.3)
- [x] `POST /api/v1/session` видає JWT за Google ID-токеном точно за формою з ADR-0006 §Додаток: Ендпоінт сесії (D-109); невалідний Google-токен → 401 `auth.invalid_google_token`
- [x] Спільний auth-middleware перевіряє JWT на решті маршрутів (усіх трьох фіч, той самий composition root) і кладе `ownerUserId` у контекст запиту для хендлерів
- [x] Помилки (`AppError`) мапляться в JSON-конверт контракту одним error-middleware, не в кожному хендлері окремо
- [x] lint + vet clean

## Notes

`npm test` 38/38 файлів, 201/201 тестів; `npm run lint` (обидва tsconfig — браузерний і `tsconfig.server.json`) чисто; `npm run build` перевірено — серверні залежності (`express`/`pg`/`jose`/`google-auth-library`) не потрапляють у браузерний бандл.

**Свідомо поза обсягом цієї задачі (не блокери DoD, лишаються відкритими дороговказами):**
- Немає екрана логіну — ніщо ще не пише `localStorage['plan.jwt']`, який читає `main.tsx`. До появи екрана входу Колода показуватиме банер помилки (401). Тобто транспорт готовий, UI для самого входу — ще ні.
- `onOpenCard` у `main.tsx` — заглушка (`console.log`); переходу на деталі картки (`CardFace`/`CardBack`) ще немає в жодній задачі app-shell.
- **Перед реальним запуском (`npm run dev` зі справжнім сервером) потрібні дві нові змінні середовища, яких ще немає в `.env`:** `JWT_SECRET` (згенерувати самостійно, довільний випадковий рядок) і `GOOGLE_CLIENT_ID` (з Google Cloud Console — окрема ручна дія користувача, не автоматизується). `DATABASE_URL_POOLED` уже є (D-96).
