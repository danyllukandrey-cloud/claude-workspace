---
status: Draft
owner: "Андрій Данилюк"
reviewers: []
updated_at: "2026-08-23"
feature_size: "M"
target_surfaces: [backend-service, web-frontend]
---

# Software Architecture Document — life-area-card

<!-- 12 Arc42 sections. Empty section → <!-- N/A: <one-line reason> -->. -->
<!-- C4 Context (L1) lives inline in §3. C4 Container (L2) lives inline in §5. -->
<!-- Numbers in §10 come VERBATIM from spec.md §6 NFR — no inventing, no rounding. -->

## 1. Introduction and goals

**Intent.** Картка — generic-механізм, що описує одну зону життя користувача (spec.md §2): назва, Опис (навіщо), блоки-метрики (кількість + частота + ціль у часі), Відстеження (порахований прогрес). Користувач фіксує події через розмову з агентом і підтвердження, бачить чесний прогрес, і — за новим рішенням цієї сесії ([D-57](../../DECISIONS.md#d-57)) — переглядає й виправляє історію своїх записів разом з агентом.

**Top-3 quality goals (1-liners; full scenarios в §10):**

1. Офлайн-доступність читання й запису — картка й історія працюють без мережі, запис не губиться, поки немає з'єднання.
2. Цілісність даних — жоден запис не враховується в прогресі мовчки: конфліктні й неперевірені записи чекають на агента (spec.md AC-06, AC-11).
3. Швидкість відгуку — запис і перегляд картки відчуваються миттєвими (spec.md §6 NFR).

**Stakeholders.**

| Role | Interest | Sign-off owner? |
|---|---|---|
| user | створює й веде власні картки, читає прогрес і історію | No |
| Tech Lead (Андрій) | архітектурні рішення, ADR | Yes |

## 2. Constraints

**Technical.**
- TypeScript на Node.js (інструменти збірки), React 18+ — компонент на картку (architecture-map.md)
- Vite — збірка й dev-сервер
- PWA — встановлюваний застосунок, частково офлайн
- Tailwind CSS — стилізація
- Vitest + React Testing Library — тести
- ESLint + Prettier — лінт/форматування
- `localStorage` як локальний кеш (~2 МБ, через шар абстракції `shared/storage/`) + мінімальний бекенд-сервер (D-24) на PostgreSQL 16+ ([D-59](../../DECISIONS.md#d-59)) — джерело правди для синхронізації

**Organisational.**
- Одна людина (Андрій) у темпі ~1–2 год/тиждень (idea-brief §11) — Клод як асистент розробки
- Жорсткого дедлайну немає; ефект фази — рухаємось як з робочою гіпотезою (spec.md §8, Approach A не підтверджений формально)

**Conventions.**
- [`architecture-map.md`](../../architecture-map.md) — повний перелік конвенцій продукту
- Реєстрація картки-типу: один код назавжди (`domain/`, `ui/`, `index.ts`), нова картка користувача = новий запис даних, не нова папка коду (D-23)
- Обробка помилок: валідація й попередження агента показуються прямо на лицьовій стороні картки, ніколи `alert`/`confirm` ([architecture-map.md](../../architecture-map.md) §Конвенції)
- ID: `crypto.randomUUID()` для будь-яких збережених записів
- Зберігання: лише через `shared/storage/`, ніколи напряму `localStorage`

**Regulatory / external.**
- Формальне регулювання (GDPR тощо) не застосовується — не комерційний сервіс для третіх осіб на цьому етапі
- spec.md §6.1: Security review — Required (нові чутливі особисті дані + нова межа авторизації «лише свої картки»)

## 3. Context and scope

Картка — одиниця, яку користувач заповнює й веде через розмову з агентом; вона показує прогрес і приймає підтверджені записи. Ця фіча описує лише саму картку — не Структуру (розкладка карток) і не характер/правила агента (спеки `structure`/`agent`, D-56).

<!-- brownfield: N/A — greenfield-фіча; scaffold є (architecture-map.md), робочого коду картки ще немає -->

**External systems (in / out):**

| Actor or system | Type | Interaction |
|---|---|---|
| user | Person | створює й веде картки, спілкується з агентом, переглядає прогрес та історію |
| Агент (Claude API через бекенд) | System (external, за межами цієї фічі) | розбирає прямий ввід, підтверджує запис, перевіряє конфлікти й неперевірені записи |
| Google | System (external) | вхід користувача (D-33) — дає відповідь на «чиї це дані» для AC-04 |

**C4 Context (L1):**

```mermaid
C4Context
    title life-area-card — System Context

    Person(user, "Користувач", "Веде власну картину життя в ПЛАН")
    System(plan, "ПЛАН", "Показує картки, рахує прогрес, приймає підтверджені записи")
    System_Ext(claude, "Claude API (агент)", "Розбирає ввід, підтверджує записи, перевіряє конфлікти")
    System_Ext(google, "Google", "Вхід користувача (OAuth)")

    Rel(user, plan, "Створює картки, записує події, читає прогрес і історію")
    Rel(plan, claude, "Запит на розбір/підтвердження запису", "HTTPS, через бекенд")
    Rel(plan, google, "Автентифікація", "OAuth")
```

## 4. Solution strategy

**Top strategic choices (the seeds for ADRs):**

1. **Поверхні фічі — успадковано, не нове рішення.** `target_surfaces: [backend-service, web-frontend]` — веб-інтерфейс картки (PWA) + власні дані-ендпоінти на вже наявному мінімальному бекенді (D-24). Обидві поверхні й сам факт бекенда вже зафіксовані на рівні продукту (продуктовий [ADR-0001 «Стек фронтенду»](../../adr/0001-frontend-stack.md), D-3, D-24), тут лише успадковуються. UI-архітектура (SPA, клієнтський рендер, встановлюваний PWA) так само успадкована з продуктового ADR-0001 — нового ADR немає.
2. **Прогрес рахується завжди з сирих подій, ніколи не кешується готовим числом — і рахується ОДНИМ спільним кодом, а не окремо на клієнті й на бекенді.** — [ADR-0001 «Recompute progress from raw events»](adr/0001-recompute-progress-from-raw-events.md) (фічевий, не плутати з продуктовим вище). Історія записів (US-12) все одно вимагає сирих даних; кешоване число було б другим джерелом правди. Бекенд лишається джерелом правди (записує підтверджені події); клієнт кешує ті самі сирі події офлайн і виконує **той самий** чистий розрахунок локально — не другу незалежну реалізацію (деталі — §5).
3. **Неперевірені й конфліктні записи мають статус `pending`, не рахуються в прогресі до підтвердження агентом** — [ADR-0002 «Hold unconfirmed records as pending»](adr/0002-hold-unconfirmed-records-pending.md). Покриває і AC-06 (конфлікт пристроїв), і AC-11 (агент був недоступний).
4. **Вікно виявлення «близьких за часом» конфліктів — коротке, точне число визначається пізніше** (spec AC-06). Тактична деталь під пунктом 3, окремого ADR не потребує — зміна самого числа згодом не є переробкою на дні (не 2 з 3 критеріїв blast radius: змінюється легко, зачіпає модуль конфлікту, альтернатива не принципова).

Кожне тактичне рішення в розділах нижче простежується до одного з цих чотирьох.

## 5. Building block view

Шарова архітектура всередині картки (`domain/` + `ui/`), як і решта продукту ([ADR-0004 «Scaffold архітектура»](../../adr/0004-scaffold-architecture.md), продуктовий): чиста доменна логіка (розрахунок прогресу, статуси записів) окремо від UI-компонентів.

**Спільна доменна логіка клієнт/бекенд (закриває F1 критика):** `domain/progress.ts`, `domain/conflict.ts`, `domain/entry.ts` — це **один і той самий** чистий код (без залежності від React чи мережі), який імпортують і бекенд (авторитетний розрахунок над базою — джерело правди), і PWA (офлайн-розрахунок над кешем сирих подій). Не дві реалізації одного правила — одна бібліотека, підключена в двох місцях. Технічно: пакується як окремий internal-модуль, який бере на вхід масив сирих подій і повертає прогрес/конфлікти/статуси — без побічних ефектів.

**Internal decomposition (клієнт, PWA):**

```
plan/app/src/cards/life-area-card/
├── domain/
│   ├── progress.ts       # частка виконання цілі з сирих подій (ADR-0001), capping при перевищенні (AC-05b) — спільний з бекендом
│   ├── entry.ts          # модель запису: confirmed | pending | rejected (ADR-0002) — спільний з бекендом
│   ├── conflict.ts        # виявлення близьких за часом записів (AC-06) — спільний з бекендом
│   └── card.ts             # стани картки (created/filled/in_use/archived) — "некоректні дані" (AC-10) сюди НЕ входять: тимчасовий прапорець із T20/T12, не стан життєвого циклу
├── ui/
│   ├── CardFace.tsx        # лицьова сторона: назва, Опис, попередження (без alert)
│   ├── CardBack.tsx        # зворот: Відстеження, прогрес (перерахований локально з кешу)
│   └── EntryHistory.tsx    # US-12: розгортна історія останніх N записів
└── index.ts                # реєстрація картки в app-shell (одна картка-тип назавжди, D-23)
```

**Internal decomposition (бекенд, `backend-service`):** конкретна структура папок серверного коду ще не встановлена на рівні продукту — мінімальний бекенд (D-24) досі не піднімався жодного разу (DELIVERY-PLAN «Розробка» 5%). Тут фіксуються лише відповідальності, які ця фіча додає до нього (реалізація й точна структура — рішення, коли бекенд вперше scaffold-иться, можливо разом із фічею `agent`):

- Ендпоінти картки: створити картку, записати подію, прочитати історію/прогрес.
- Перевірка власника на кожному читанні/записі картки (AC-04) — використовує вхід через Google (D-33).
- Виявлення близького за часом конфлікту (`domain/conflict.ts`, спільний з клієнтом) і статус `pending`/`confirmed`/`rejected` (ADR-0002) над базою-джерелом правди.
- Звернення до Claude API для розбору/підтвердження/уточнення конфлікту.

Відкрите архітектурне питання (де саме на диску/в репозиторії живе цей код) зафіксовано в §11.

**C4 Container (L2):**

```mermaid
C4Container
    title life-area-card — Containers

    Person(user, "Користувач")

    Container_Boundary(plan, "ПЛАН") {
        Container(pwa, "ПЛАН PWA", "React + TypeScript + Vite", "Картка: форма, прогрес, історія записів")
        ContainerDb(cache, "Локальний кеш", "Browser localStorage, ~2 МБ", "Кеш сирих подій картки (не лише підсумкового стану) — дозволяє офлайн-перерахунок прогресу тим самим кодом, що й на бекенді (ADR-0001)")
        Container(backend, "Мінімальний бекенд", "сервер-проксі (D-24)", "Ендпоінти картки: створення, запис події, історія, статус pending/confirmed")
        ContainerDb(store, "База бекенда", "джерело правди (схема — предмет data-model)", "Сирі події картки, статус кожного запису")
    }

    System_Ext(claude, "Claude API", "Агент: розбір, підтвердження, перевірка конфліктів")

    Rel(user, pwa, "Створює картку, пише агенту, читає прогрес/історію")
    Rel(pwa, cache, "Читає/пише через shared/storage/")
    Rel(pwa, backend, "Синхронізація картки, запис події", "HTTPS")
    Rel(backend, store, "Читає/пише сирі події й статуси")
    Rel(backend, claude, "Запит на розбір/підтвердження/перевірку конфлікту", "HTTPS")
```

## 6. Runtime view

**Critical flow 1: Створення картки без назви — блокується (AC-02)**

```mermaid
sequenceDiagram
    actor User
    participant PWA

    User->>PWA: намагається зберегти нову картку без назви
    PWA->>PWA: перевіряє наявність назви (клієнтська валідація)
    PWA-->>User: блокує створення, пояснює, що потрібна назва
    Note over PWA: postcondition: картка не створена, доки немає назви
```

**Critical flow 2: Позначення «заповнена» без Опису — блокується (AC-03)**

```mermaid
sequenceDiagram
    actor User
    participant PWA

    User->>PWA: намагається позначити картку заповненою, Опис порожній
    PWA->>PWA: перевіряє наявність Опису
    PWA-->>User: блокує позначення «заповнена», пояснює, що потрібен короткий «навіщо»
    Note over PWA: postcondition: картка лишається у стані «створена», не «заповнена»
```

**Critical flow 3: Запис події з підтвердженням (happy path, AC-01)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Claude as Агент
    participant Store as База бекенда

    User->>PWA: розповідає про подію (прямий ввід)
    PWA->>Backend: передає запис
    Backend->>Claude: просить розібрати й запропонувати картку/блок
    Claude-->>Backend: пропозиція запису
    Backend-->>PWA: показує пропозицію
    PWA-->>User: "записати в картку Х?"
    User->>PWA: підтверджує
    PWA->>Backend: підтверджений запис
    Backend->>Store: зберігає подію (status=confirmed)
    Store-->>Backend: ok
    Backend-->>PWA: оновлений прогрес (перерахований, ADR-0001)
    PWA-->>User: показує новий прогрес
```

**Critical flow 4: Перегляд прогресу, включно з capping при перевищенні цілі (AC-09/AC-09b)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Cache as Локальний кеш

    User->>PWA: відкриває картку
    PWA->>Cache: читає сирі події картки
    Cache-->>PWA: сирі події
    PWA->>PWA: рахує частку виконання цілі по кожному блоку-метриці (domain/progress.ts, ADR-0001)
    alt лічильник перевищує ціль блоку-метрики
        PWA->>PWA: обмежує показ часткою 100%, окремо показує суму понад ціль (AC-09b)
    end
    PWA-->>User: показує пораховані числа й агрегований прогрес картки
```

**Critical flow 5: Агент вказує на підозрілі дані (AC-10)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Claude as Агент

    Note over Backend,Claude: precondition: дані картки виглядають несумісними з тим, що описав користувач
    User->>PWA: відкриває картку або питає агента про неї
    PWA->>Backend: запит стану картки
    Backend->>Claude: перевіряє дані на суперечність
    Claude-->>Backend: знайдена невідповідність
    Backend-->>PWA: показує пояснення агента
    PWA-->>User: бачить, що саме виглядає некоректно, і пропозицію виправити разом
    Note over PWA: postcondition: решта картки лишається доступною, нічого не заблоковано
```

**Critical flow 6: Ціль «постійний процес» — показ без відсотка (AC-05)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Cache as Локальний кеш

    Note over User,PWA: precondition: блок-метрика має ціль «постійний процес» (без кінцевої дати)
    User->>PWA: відкриває картку
    PWA->>Cache: читає сирі події
    Cache-->>PWA: сирі події
    PWA->>PWA: рахує накопичену кількість (без відсотка від відсутнього дедлайну)
    PWA-->>User: показує кількість як триваючий підрахунок, не відсоток
```

**Critical flow 7: Близький за часом конфлікт і неперевірений запис (AC-06, AC-11, ADR-0002)**

```mermaid
sequenceDiagram
    actor User
    participant PwaA as PWA (пристрій A)
    participant PwaB as PWA (пристрій B)
    participant Backend
    participant Claude as Агент
    participant Store as База бекенда

    PwaA->>Backend: запис з пристрою A
    Backend->>Store: зберігає (status=pending)
    PwaB->>Backend: запис з пристрою B (близько за часом, той самий блок-метрика)
    Backend->>Store: зберігає (status=pending)
    Backend->>Store: виявляє конфлікт (короткий часовий проміжок, domain/conflict.ts)
    alt агент доступний одразу
        Backend->>Claude: чи дублікат, чи окремий запис?
        Claude-->>Backend: уточнення потрібне
        Backend-->>PwaA: передає питання агента (чат — глобальний елемент, D-28)
        PwaA-->>User: агент перепитує в чаті
        User->>PwaA: відповідає (дублікат / окремий)
        PwaA->>Backend: передає відповідь
        Backend->>Store: оновлює статус (confirmed або rejected)
    else агент тимчасово недоступний
        Note over Backend,Store: обидва записи лишаються pending, у прогрес не входять (AC-11)
        PwaA->>Backend: користувач відкриває картку/чат пізніше
        Backend->>Claude: перевірка доступності + розбір накопичених pending-записів
        Claude-->>Backend: агент знову доступний, уточнення готове
        Backend-->>PwaA: передає уточнення агента
        PwaA-->>User: агент уточнює під час цього звернення
        User->>PwaA: відповідає
        PwaA->>Backend: передає відповідь
        Backend->>Store: оновлює статуси
    end
```

**Critical flow 8: Допомога з невимірною ціллю (AC-07)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Claude as Агент

    User->>PWA: називає ціль, яку не може виразити числом
    PWA->>Backend: передає формулювання цілі
    Backend->>Claude: просить допомогти знайти вимірне число
    Claude-->>Backend: пропонує вимірну версію цілі
    Backend-->>PWA: показує пропозицію
    PWA-->>User: бачить вимірну ціль, підтверджує або уточнює
    Note over PWA: postcondition: ціль не блокується і не приймається невимірною — завжди зводиться до числа
```

**Critical flow 9: Декларативна картка без метрики (AC-08)**

```mermaid
sequenceDiagram
    actor User
    participant PWA

    User->>PWA: створює картку з Описом, без жодного блоку-метрики
    PWA->>PWA: перевіряє наявність блоків-метрик
    PWA-->>User: картка існує і доступна, але не переходить у стан «ведеться»
    Note over PWA: postcondition: картка лишається декларативною — це дозволений стан, не помилка
```

**Critical flow 10: Доступ лише до своїх карток (AC-04)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Store as База бекенда

    User->>PWA: намагається переглянути чи записати на картку
    PWA->>Backend: запит з ідентифікатором картки + токен сесії
    Backend->>Backend: перевіряє, що картка належить автору запиту (Google-вхід, D-33)
    alt картка належить іншому користувачу або не існує
        Backend-->>PWA: відмова, без підтвердження чи спростування існування картки
        PWA-->>User: бачить відмову доступу
    else картка належить цьому користувачу
        Backend->>Store: читає/пише дані картки
        Store-->>Backend: ok
        Backend-->>PWA: дані картки
        PWA-->>User: бачить свою картку
    end
```

**Critical flow 11: Перегляд і виправлення історії записів (AC-12, AC-13)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Claude as Агент
    participant Store as База бекенда

    User->>PWA: розгортає історію останніх записів картки
    PWA->>Backend: запит історії
    Backend->>Store: читає останні записи
    Store-->>Backend: записи (що і коли записано)
    Backend-->>PWA: історія
    PWA-->>User: бачить останні записи в порядку, кожен з деталями (AC-13)
    User->>PWA: позначає один запис як помилковий
    PWA->>Backend: передає запис на перевірку
    Backend->>Claude: просить допомогти виправити чи відкотити
    Claude-->>Backend: пропозиція виправлення/відкату
    Backend-->>PWA: показує пропозицію
    PWA-->>User: погоджує виправлення разом з агентом
    User->>PWA: підтверджує
    PWA->>Backend: підтверджене виправлення
    Backend->>Store: оновлює запис, перераховує прогрес
    Store-->>Backend: ok
    Backend-->>PWA: оновлений прогрес
    PWA-->>User: бачить виправлену історію й оновлений прогрес (AC-12)
```

**Critical flow 12: Прийняття перенесеної метрики, включно з колізією назви (AC-14, AC-15)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Store as База бекенда

    Note over Backend,Store: precondition: користувач підтвердив перенесення блоку-метрики із закритої картки (structure AC-12)
    Backend->>Store: читає блок-метрику й усі її записи із закритої картки
    Store-->>Backend: блок-метрика + історія
    Backend->>Backend: перевіряє колізію назви й одиниці з наявними блоками картки-отримувача
    alt колізія назви й одиниці
        Backend-->>PWA: пропонує перейменувати блок-метрику перед завершенням
        PWA-->>User: обирає нову назву
        User->>PWA: підтверджує назву
        PWA->>Backend: нова назва
    end
    Backend->>Store: переносить блок-метрику й усю історію в картку-отримувача
    Store-->>Backend: ok
    Backend-->>PWA: оновлена картка з перенесеними даними
    PWA-->>User: бачить блок-метрику й історію на новій картці, прогрес враховує перенесені записи (AC-14)
```

**Critical flow 13: Видалення (м'яка архівація) картки (AC-16)**

```mermaid
sequenceDiagram
    actor User
    participant PWA
    participant Backend
    participant Store as База бекенда

    User->>PWA: вирішує видалити картку (з записами чи без)
    PWA-->>User: просить підтвердити видалення
    User->>PWA: підтверджує
    PWA->>Backend: запит на видалення картки
    Backend->>Store: позначає картку архівованою (status=archived), не видаляє фізично
    Store-->>Backend: ok
    Backend-->>PWA: картка архівована
    PWA-->>User: картка зникає з колоди й розкладки Структури, лишається відновлюваною
```

**Coverage check (`/sdd:sequences`, крок 7).**

*Use-case pass (§4):* усі 14 US мають ≥1 потік — US-01→Flow 1, US-02→Flow 2, US-03→Flow 3, US-04→Flow 4, US-05→Flow 5, US-06→Flow 6, US-07→Flow 7, US-08→Flow 8, US-09→Flow 9, US-10→Flow 10, US-11→Flow 7 (AC-11), US-12→Flow 11, US-13→Flow 12, US-14→Flow 13.

*AC pass (§5):* усі 17 AC показані — AC-01→Flow 3, AC-02→Flow 1, AC-03→Flow 2, AC-04→Flow 10, AC-05→Flow 6, AC-06→Flow 7, AC-07→Flow 8, AC-08→Flow 9, AC-09/AC-09b→Flow 4, AC-10→Flow 5, AC-11→Flow 7, AC-12/AC-13→Flow 11, AC-14/AC-15→Flow 12, AC-16→Flow 13.

**Flagged for review:** жодного нового учасника поза §5 не знадобилось (`Cache` — те саме, що вже задекларований контейнер «Локальний кеш» у C4 Container).

## 7. Deployment view

<!-- N/A: фіча використовує вже заплановану топологію продукту (PWA-хостинг + спільний мінімальний бекенд, D-24) — власної нової інфраструктури не вводить. Сам бекенд ще жодного разу не розгортався (DELIVERY-PLAN «Розробка» 5%) — це продуктовий, не фічевий гоп, топологія визначиться коли бекенд вперше піднімають. -->

## 8. Crosscutting concepts

| Concept | Convention | Where defined |
|---|---|---|
| Logging | успадковано з конвенцій продукту, деталей на рівні картки немає | architecture-map.md |
| Authentication | Google-вхід (OAuth), кожен запит бекенда перевіряє власника картки (AC-04) | D-33, spec.md §6.1 |
| Error handling | валідація й попередження агента — на лицьовій стороні картки, ніколи `alert`/`confirm` | architecture-map.md §Конвенції |
| ID strategy | `crypto.randomUUID()` для картки й кожного запису | architecture-map.md |
| Internationalisation | N/A — лише українська мова на цьому етапі | — |
| Observability | клієнтські таймери для NFR (spec.md §6): p95 запис ≤300ms, p95 читання ≤150ms | spec.md §6 |
| Events | N/A — прямі виклики бекенда, без шини подій | — |

## 9. Architecture decisions

| # | Title | Status | Section |
|---|---|---|---|
| 0001 | Recompute progress from raw events, never store a derived percentage | Accepted | §4 |
| 0002 | Hold unconfirmed records as pending, exclude them from progress until the agent confirms | Accepted | §4 |

ADR files live under `docs/features/life-area-card/adr/NNNN-<title>.md`.

## 10. Quality requirements

**QG-1. Офлайн-доступність**
- **When:** користувач відкриває картку без мережі
- **Then:** читання картки й історії з кешу — 100% (spec.md §6, рядок «Офлайн-доступність (читання)»); запис приймається офлайн, але лишається «в очікуванні» до підтвердження (spec.md §6, рядок «Офлайн-доступність (запис)»)
- **How verify:** ручна перевірка без з'єднання — відкрити картку, записати подію, підключитись, перевірити підтвердження

**QG-2. Цілісність даних**
- **Then:** конфліктні (AC-06) і неперевірені (AC-11) записи ніколи не входять у прогрес до підтвердження агентом (ADR-0002)
- **How verify:** інтеграційний тест, що симулює два близькі за часом записи одного блоку-метрики й перевіряє, що прогрес не змінюється до підтвердження

**QG-3. Швидкість відгуку**
- **When:** користувач підтверджує запис / відкриває картку
- **Then:** p95 запис підтвердженої події ≤ 300 ms (без часу відповіді агента); p95 відкриття картки ≤ 150 ms — spec.md §6, verbatim
- **How verify:** клієнтський таймер від дії до оновленого стану картки

## 11. Risks and technical debt

| Risk / debt | Severity | Mitigation | Owner | Due |
|---|---|---|---|---|
| Перерахунок прогресу на льоту (ADR-0001) може сповільнитись при великій кількості записів на картку | Low | не оптимізуємо зараз (MVP — десятки записів); за потреби — кеш з інвалідацією пізніше | Андрій | після MVP, за потреби |
| Модель картки додає третій статус запису (`pending`) — складніше, ніж «є/немає» | Medium | покрито ADR-0002 явно; UI показує pending видимо, не приховує | Андрій | — (прийнято) |
| Open architectural decision: де саме (шлях/репозиторій) живе код мінімального бекенда — не встановлено на рівні продукту | Open question | зафіксувати при першому scaffold бекенда, ймовірно разом з фічею `agent` | Андрій | перед `/sdd:tasks life-area-card` |
| Open architectural decision: точне число «короткого вікна» виявлення конфлікту (AC-06) | Open question | узгодити на `/sdd:data-model life-area-card` | Андрій | перед `/sdd:data-model life-area-card` |
| ~~Open architectural decision: максимальна кількість карток не визначена~~ | — | перенесено у власника: [`structure/spec.md` §8](../structure/spec.md) («щільність поля розкладки») — питання розкладки, не картки | — | — |
| Open architectural decision: Approach A ще не підтверджений формально, RICE/Feasibility TBD (spec.md §8) | Open question | рухаємось як з робочою гіпотезою | Андрій | перед `/sdd:tasks life-area-card` |

**Accepted debt (acceptable in v1, plan to fix later):**
- Модель картки додає третій статус запису (`pending`) — прийнято свідомо разом з ADR-0002, складність виправдана вимогами AC-06/AC-11.

**Звірка зі spec.md §8 (single source of truth, CLAUDE.md):** питання «чи фіксуємо правило "похідні числа не зберігаємо"» — **закрито цим SAD**, [ADR-0001](adr/0001-recompute-progress-from-raw-events.md) відповідає «так». `spec.md` §8 потребує правки — прибрати цей рядок і додати посилання на ADR-0001 (виконується разом з фіналізацією цього SAD, крок 7).

## 12. Glossary

| Term | Meaning |
|---|---|
| card | картка — один інстанс generic-механізму (CONTEXT.md) |
| metric-block | блок-метрика — кількість + частота + ціль у часі (CONTEXT.md) |
| description | Опис — декларація «навіщо» на картці (CONTEXT.md) |
| tracking | Відстеження — пораховані числа й прогрес (CONTEXT.md) |
| agent | агент — за межами цієї фічі, взаємодія лише через підтвердження (CONTEXT.md) |
| connector | конектор — зовнішнє джерело даних, поза v1 (CONTEXT.md) |
| user | користувач (CONTEXT.md) |
| pending / confirmed / rejected | статуси запису картки (ADR-0002) — `pending`: чекає на перевірку агента; `confirmed`: враховується в прогресі; `rejected`: визначено дублікатом чи помилкою, не враховується |
