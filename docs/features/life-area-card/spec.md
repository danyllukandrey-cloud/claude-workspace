---
status: Draft
owner: "Андрій Данилюк"
reviewers: []
updated_at: "2026-08-24"
feature_size: "M"
---

# Spec — life-area-card

> **Glossary:** [CONTEXT.md](../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/features/life-area-card/idea-brief.md` (§1–§15, три проходи рецензування), `docs/features/life-area-card/design-review.md` (блоки 00–8), `docs/DECISIONS.md` (D-22…D-45, D-54, D-56, D-57), `docs/CONTEXT.md` (глосарій).
> **Ідеаційний прохід (крок 3 `specify`):** конкурентне дослідження й адвокат диявола вже виконані раніше в межах `idea-brief.md` §6 (5 продуктів, дати й запити зазначені) і §10 (два незалежні проходи адвоката диявола) — повторний запуск субагентів визнано зайвим, матеріал свіжий (2026-08-18) і стосується саме цієї фічі.
> **Ревю критика (крок 8):** пройдено 2026-08-23, 7 знахідок опрацьовано — виправлення позначені в тексті нижче.

## 1. Context

Люди, які вже так чи інакше планують своє життя, не мають стратегічного рівня — розуміння руху життя в цілому. Дані про життєві напрямки розпорошені між інструментами (таск-трекери, застосунки активності, нотатки, календарі), і жоден із них не показує зведену картину. Це стосується сегмента 1 (ті, хто вже щось веде і відчуває розпорошеність) — і насамперед фактичного першого користувача, автора продукту.

Тригер зараз — книга опису продукту (D-49) завершена й підтверджена 2026-08-23, а розкидані по 20+ рішеннях (D-23…D-45) деталі картки досі не зведені в жоден технічний документ; це перша фіча продукту (D-5), і саме її бракує, щоб перейти від задуму до коду.

Обраний підхід — Approach A з idea-brief.md §7/§13 («Одне поле, одна схема»): користувач кидає прямий запис в один канал (чат з агентом; формат — будь-який, що приймає платформа Claude, за D-54), агент сам пропонує, до якої картки й блоку-метрики він відноситься, користувач підтверджує. **Підтверджено 2026-08-27 ([D-79](../../DECISIONS.md#d-79))** — кроки 9–11 (RICE, здійсненність, формальне підтвердження) протоколу `sdlc-interview` пройдено, [`idea-brief.md §11–§13`](idea-brief.md) → `status: Confirmed`.

Ця специфікація описує **лише саму картку** — її поля, стани й критерії приймання; вона не описує *як* агент розмовляє (характер, правила, пам'ять — предмет майбутньої фічі `agent`, D-56) і не описує розкладку карток між собою (предмет майбутньої фічі `structure`, D-56).

**Decision override (крок 8, 2026-08-23):** `design-review.md` Блок 2 раніше фіксував «деталі по одиницях — в аналітиці (екран Структури), не на самій картці». Ця специфікація вводить видиму на самій картці історію останніх записів (§4 US-12, §5 AC-12/AC-13) — рішення ухвалено з Андрієм у цій сесії, записане окремо як [D-57](../../DECISIONS.md#d-57), бо змінює раніше зафіксований підхід, а не просто деталізує його.

Джерела: `Product_Brief.md`; `design-review.md` блоки 00–8 (генерик-механізм, стани картки, дані й метрики, доступ); рішення D-23 (generic-тип назавжди), D-28 (Опис/Дані/Відстеження), D-30 (модель блоку-метрики), D-38 (частка виконання цілі, одиниці не складаються), D-54 (формат прямого вводу не обмежений наперед), D-57 (історія записів на картці).

## 2. Goals

- Користувач формалізує одну зону життя як картку (назва + Опис + блоки-метрики) без потреби розуміти внутрішню структуру даних.
- Користувач фіксує прогрес через розмову з агентом і підтвердження, а не через заповнення форм напряму.
- Стан картки чесно відображає реальну залученість користувача (створена → заповнена → ведеться); повний перелік подій життєвого циклу, які саме записуються, — окрема нерозкрита робота (design-review Блок 4, §8).

## 3. Non-goals

- **Розкладка й групування карток між собою** — предмет фічі `structure` (D-56); тут лише сама картка як одиниця.
- **Характер, правила й пам'ять агента** — предмет фічі `agent` (D-56); тут лише факт, що картка приймає підтверджений запис від агента.
- **Механізм синхронізації між пристроями й деградації при недоступності зовнішнього ШІ** (як саме влаштована мережа/черга/повторні спроби) — предмет фічі `agent`/архітектури. **Не non-goal:** бізнес-правило картки «конфліктні близькі за часом записи й записи, що чекають на перевірку, ніколи не рахуються мовчки» — воно тут (§5 AC-06, AC-11), бо це поведінка самої картки, яку бачить користувач.
- **Готові інтеграції зовнішніх конекторів** (Google Fit, Goodreads тощо) — поза v1 (idea-brief §5). Поведінка картки на випадок конфлікту ручного вводу з даними конектора вже спроєктована (`design-review` Блок 6), але активується лише з першим реальним конектором — не перевіряється AC цієї версії.
- **Пороги «ефективно/неефективно» виконання метрик (Q-6) та мануал/концепція як окремі документи (Q-7)** — явно поза обсягом v1, ідея-бриф §5.

## 4. User stories

### US-01: Створити картку

**As a** user
**I want** створити нову картку, вказавши лише назву
**So that** я можу почати описувати зону життя, не проходячи одразу через усі рішення

### US-02: Налаштувати картку

**As a** user
**I want** заповнити Опис (навіщо) і задати ціль хоча б для одного блоку-метрики
**So that** картка стає готовою відстежувати прогрес

### US-03: Записати подію через чат

**As a** user
**I want** розповісти агенту про подію прямим вводом (текст, голос чи інший формат) і підтвердити запропонований запис
**So that** дані на картці оновлюються без ручного заповнення форми

### US-04: Побачити прогрес

**As a** user
**I want** бачити пораховані числа й частку виконання цілі на картці
**So that** я знаю, наскільки просунувся, не рахуючи вручну

### US-05: Дізнатись про підозрілі дані

**As a** user
**I want**, щоб агент повідомив, коли щось на картці виглядає некоректно
**So that** я можу розібратись і виправити, не втрачаючи довіри до цифр

### US-06: Вести ціль без кінцевої дати

**As a** user
**I want** позначити ціль блоку-метрики як «постійний процес»
**So that** я можу відстежувати звичку, а не лише дедлайн

### US-07: Уникнути дублю при близьких за часом записах

**As a** user
**I want**, щоб агент перепитав, коли два записи одного параметра прийшли майже одночасно (наприклад, з різних пристроїв)
**So that** мої цифри не подвоюються й не спотворюються непомітно

### US-08: Отримати допомогу з невимірною ціллю

**As a** user
**I want**, щоб агент допоміг перетворити розмиту ціль на вимірну
**So that** я все одно можу відстежувати щось конкретне, а не відмовлятись від метрики

### US-09: Тримати суто декларативну картку

**As a** user
**I want** створити картку для зони життя без природного числа для підрахунку (наприклад «Стосунки»)
**So that** я можу тримати цю зону в своїй картині життя навіть без метрик

### US-10: Мати приватні картки

**As a** user
**I want**, щоб мої картки бачив і редагував лише я
**So that** мої особисті дані про життя лишаються моїми

### US-11: Не втратити запис, поки агент його не перевірив

**As a** user
**I want**, щоб запис, який прийшов, поки агент не міг його одразу перевірити, лишався в очікуванні, а не губився чи рахувався мовчки
**So that** я можу довіряти: кожне число на картці пройшло підтвердження

### US-12: Переглянути й виправити історію записів

**As a** user
**I want** розгорнути на картці історію останніх записів і разом з агентом виправити чи відкотити помилковий
**So that** я лишаюсь господарем того, що записано, і довіряю підсумковим цифрам

### US-13: Прийняти перенесену метрику з іншої картки

**As a** user
**I want** щоб метрика, перенесена із закритої картки (`structure` AC-12), опинилась у картці-отримувачі з усією своєю історією записів
**So that** я не втрачаю минулі дані, коли перестаю вести два напрямки, що перетинаються, окремо

### US-14: Архівувати картку, якою більше не користуюсь

**As a** user
**I want** прибрати картку зі своєї колоди, коли я більше не веду цей напрямок
**So that** моя колода відображає лише те, що я справді відстежую зараз

### US-15: Розархівувати картку
**As a** user
**I want** знову відкрити раніше закритий напрямок
**So that** я можу передумати без втрати історії

### US-16: Переглянути архівовані картки
**As a** user
**I want** бачити список закритих (архівованих) напрямків і їхню історію
**So that** я можу повернутись до старих даних, навіть не відновлюючи картку

## 5. Acceptance criteria

### AC-01 (US-03) — happy path

**Given** an authorized user has an existing filled card with an active metric-block goal
**When** the user tells the agent about a relevant event through direct input and confirms the agent's proposed record
**Then** the system updates the card's tracked count and shows the new share of goal completion

### AC-02 (US-01) — error

**Given** a user is creating a new card
**When** the user tries to save it without a name
**Then** the system blocks the creation and explains that a name is required before a card can exist

### AC-03 (US-02) — error

**Given** a user is setting up a card's Опис (навіщо)
**When** the user tries to mark the card as filled while leaving Опис empty
**Then** the system blocks marking it filled and explains that a short "навіщо" is required first

### AC-04 (US-10) — authorization

**Given** an authorized user is signed in
**When** the user attempts to view or record on a card that does not belong to their own picture of life
**Then** the system denies access and does not confirm or deny that such a card exists

### AC-05 (US-06) — domain invariant

**Given** a user has set a metric-block's goal as "постійний процес" (no end date)
**When** the system computes that metric-block's share of completion
**Then** the system shows it as an ongoing count rather than a percentage computed against a missing deadline

### AC-06 (US-07) — cross-context

**Given** two changes to the same metric-block arrive close together in time from different devices
**When** the system detects this near-simultaneous conflict
**Then** the agent asks the user whether it's a duplicate or a genuinely separate entry before either one counts toward progress

### AC-07 (US-08)

**Given** a user is defining a new metric-block goal
**When** the user names a goal they cannot express as a countable number
**Then** the agent helps the user find a measurable number for it instead of accepting an unmeasurable goal or blocking the card

### AC-08 (US-09)

**Given** a user creates a card with an Опис but no metric-block
**When** the user leaves it without any metric-block
**Then** the card exists and is usable, but never reaches the "actively tracked" state — it stays a declarative-only card

### AC-09 (US-04)

**Given** a user has a card with one or more metric-blocks that have recorded events
**When** the user opens the card
**Then** the system shows the computed share of completion per metric-block and the card's aggregated progress

### AC-09b (US-04) — domain invariant (concurrent edge of AC-09)

**Given** a user's metric-block count exceeds its stated goal
**When** the system computes that metric-block's share
**Then** the system caps the displayed share at a full completion and separately notes the amount over goal, rather than showing a share above full

### AC-10 (US-05)

**Given** a user's card has data the agent flags as inconsistent with what the user described
**When** the user opens the card or asks the agent about it
**Then** the agent points out what looks wrong and offers to correct it together, without blocking the rest of the card

### AC-11 (US-11) — domain invariant

**Given** a record arrives while the agent is unable to verify it immediately
**When** the agent becomes available again
**Then** the system does not count the record toward progress until the agent has reviewed it and clarified it with the user

### AC-12 (US-12)

**Given** a user opens a card's history of recent entries
**When** the user flags one they believe is wrong
**Then** the agent walks through correcting or rolling it back together with the user, and the card's progress reflects the correction

### AC-13 (US-12)

**Given** a user has a card with recorded entries
**When** the user expands the card's history area
**Then** the system shows the most recent entries in order, each with what was recorded and when

### AC-14 (US-13) — happy path

**Given** a user confirms moving a metric-block from a closing card into another existing card (`structure` AC-12)
**When** the transfer completes
**Then** the metric-block and all its recorded entries now belong to the destination card, and its history and computed progress include the moved entries exactly as they were before the move

### AC-15 (US-13) — name collision

**Given** the destination card already has a metric-block with the same label and unit as the one being moved
**When** the user confirms the transfer
**Then** the system offers to rename the moved metric-block before finishing, rather than silently merging the two into one

### AC-16 (US-14)

**Given** a user decides to stop tracking a card, with or without recorded entries
**When** the user deletes it
**Then** the system marks the card archived — never physically removed — and it disappears from the deck and from any layout that references it (`structure`), while remaining technically recoverable

### AC-17 (US-15) — happy path
**Given** картка має статус `archived`
**When** користувач ініціює розархівацію (зі списку архівованих карток, US-16)
**Then** система повертає `card.status` в `active`; позиція в розкладці Структури НЕ відновлюється автоматично на стару клітинку (D-69) — користувач розкладає картку заново

### AC-18 (US-16) — happy path
**Given** у користувача є хоча б одна архівована картка
**When** користувач відкриває список архівованих карток
**Then** система показує їх окремо від активної колоди, з можливістю відкрити картку в режимі перегляду — історія записів видима, новий запис додати не можна, поки картку не розархівовано (AC-17)

### AC-19 (US-02) — rename
**Given** користувач відкрив картку і хоче змінити її назву
**When** торкається назви або обирає «Перейменувати» в меню «...» поруч із «Архівувати»
**Then** система дозволяє ввести нову назву й зберігає її — зміна одразу відображається в колоді й фіксується подією в Літописі Структури (`structure/spec.md` AC-15), як уже описано для наслідку перейменування

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Latency p95 запис підтвердженої події (без часу відповіді агента) | ≤ 300 ms | клієнтський таймер від підтвердження до оновленого стану картки |
| Latency p95 відкриття картки (показ Відстеження з кешу) | ≤ 150 ms | клієнтський таймер |
| Throughput | N/A — одноосібний клієнтський застосунок, операції картки не обмежені пропускною здатністю сервера | — |
| Офлайн-доступність (читання) | 100% — картка й історія відкриваються з кешу без мережі | ручна перевірка без з'єднання |
| Офлайн-доступність (запис) | Запис приймається офлайн, але лишається "в очікуванні" до підтвердження агентом (AC-11), не рахується одразу | ручна перевірка: запис офлайн → підключення → підтвердження |
| Ізоляція даних (Concurrency/Accuracy) | кожне читання/запис фільтрується власником картки | перевіряється на кожному доступі до картки |

## 6.1 Security / privacy

- **Data classification:** confidential — картка містить особисті дані про життя користувача (мета, здоров'я, кар'єра тощо), чутливі для людини навіть без формального регулювання.
- **Personal data touched:** так — довільний текст Опису й записів метрик-блоків, який користувач вводить сам і який може містити чутливі теми (здоров'я, стосунки, кар'єра).
- **AuthZ/AuthN impact:** кожне читання й запис картки перевіряє, що вона належить автору запиту (AC-04); нових ролей понад `user` не додається.
- **Abuse cases:**
  - міжкористувацький доступ: спроба переглянути чи змінити чужу картку → відмова, існування картки не підтверджується й не спростовується (AC-04).
  - близькі за часом конфліктні записи: система ніколи не рахує обидва мовчки — завжди уточнення в діалозі (AC-06).
  - надмірне створення карток: жорсткого технічного ліміту немає, агент попереджає про перевантаження при наближенні до практичної стелі (`design-review` блок 4).
  - довільний текст в Опис/записах: зберігається й показується лише як текст для читання людиною, ніколи не інтерпретується як команда системі.
- **Security review:** Required — нові чутливі особисті дані + нова межа авторизації «лише свої картки» (раніше цього не було, картка була суто клієнтською без входу).

## 7. Metrics / KPIs

- **Частка нових карток, заповнених назвою й Описом за першу сесію** — baseline: 0 (нова фіча), target: ≥90% протягом 30 днів від першого використання.
- **Частка записів через чат, підтверджених без подальшого виправлення** — baseline: 0 (даних ще немає), target: 8 із 10 останніх записів (орієнтир Approach A з idea-brief.md — метрика прив'язана до потоку записів, не до календарного вікна, D-40).
- **Медіанний час від стану «створена, не заповнена» до «створена та заповнена»** — baseline: невідомо (нова фіча), target: ≤1 день медіанно, вимірюється протягом 90 днів після запуску.

## 8. Open questions

- [x] ~~Підхід A досі «запропоновано, не підтверджено» в idea-brief (RICE/Feasibility — TBD)~~ Закрито 2026-08-27 ([D-79](../../DECISIONS.md#d-79)) — RICE (Reach 1 × Impact 3 × Confidence 0.8 / Effort M) і Feasibility (Tech/Skills/Time усі Feasible) підтверджені, [`idea-brief.md`](idea-brief.md) → `status: Confirmed`.
- [x] ~~Максимальна кількість карток?~~ — перенесено у власника: [`structure/spec.md` §8](../structure/spec.md) («щільність поля розкладки») — це питання розкладки, не картки.
- [x] ~~Чи фіксуємо правило «похідні числа (прогрес, частка) не зберігаємо, лише перераховуємо з сирих подій» (Engineer, design-review блок 8)?~~ — закрито: так, [sad.md ADR-0001](sad.md) відповідає «так», прогрес рахується спільним кодом клієнт+бекенд з сирих подій.
- [x] ~~Q-6 — пороги «ефективно / неефективно» виконання метрик, залежні від типу групування Структури.~~ Закрито 2026-08-23 ([D-60](../../DECISIONS.md#d-60)) — таких порогів не буде: середнє рахується порівну незалежно від розкладки, без вердикту «добре/погано»
- [x] ~~Синхронізація архівації з розкладкою Структури (AC-16, [D-66](../../DECISIONS.md#d-66)) — коли картку архівують тут, позиція в `structure_layout_position` не закривається сама собою.~~ Закрито 2026-08-24 ([D-69](../../DECISIONS.md#d-69)) — той самий бекенд-запит, що архівує картку, у тій самій транзакції закриває її активну позицію в `structure_layout_position` (обидві таблиці в одній базі, D-59, окремий зв'язок/черга не потрібні).
- [ ] **Пошук/фільтр записів за датою в історії картки** (Крок 3 опитувальника, 2026-08-29) — `EntryHistoryList` (SCR-03) і `GET /cards/{cardId}/entries` показують лише пагінований список «останніх», без пошуку чи фільтра за датою. **Позначка: наступний етап.** — owner: Андрій, due: коли обсяг історії зробить це відчутною проблемою
