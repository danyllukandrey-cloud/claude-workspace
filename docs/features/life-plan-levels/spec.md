---
status: Draft
owner: "Андрій"
reviewers: []
updated_at: "2026-09-20"
feature_size: "S"
---

# Spec — life-plan-levels

> **Glossary:** [CONTEXT.md](../../CONTEXT.md)
> **Reference module / docs / channels used:** None — only the interview + `idea-brief.md` + `CONTEXT.md` + `architecture-map.md`.

## 1. Context

Продукт ПЛАН має Декларацію (текстова картина світу), Картки (вимірювані зони життя) і Схему (візуальна розкладка пріоритетів) — але жодна з трьох фіч не описує план у часових рамках. Єдиний реальний користувач продукту (Андрій) сформулював це прямо: «Відсутність цієї сторінки — логічний розрив у сервісі. Маємо Схему, маємо зону у вигляді картки, маємо декларацію, а плану в часових рамках нема.»

Це не інцидент і не дедлайн — завершене відчуття структурної неповноти. Три з чотирьох очікуваних шарів картини життя (Декларація, Картки, Схема) вже готові й використовуються — усі три змержовані в `main` станом на 2026-09-19 (PR #9-#12) — четвертий (часові горизонти) досі не спроєктований.

Обраний підхід — «Три горизонти одним екраном» (Approach A, `idea-brief.md` §7/§13): одна сторінка, три незалежні списки (тактичний/оперативний/стратегічний), пункт додається й позначається виконаним прямо на місці, без окремого зв'язку з картками. Усі три ideation-перспективи (Engineer/Executive/UX, `idea-brief.md` §8) оцінили цей підхід позитивно без жодного мінуса — Approach B (обов'язковий зв'язок із картками) і Approach C (необов'язковий зв'язок) відхилені/припарковані (`idea-brief.md` §14). «Без окремого редактора-кроку» в описі підходу (`idea-brief.md` §7) стосується відсутності обов'язкового підтвердження через чат для кожного пункту, а не відсутності самого повноекранного редактора — сам редактор прямо названий у первинній ідеї (`idea-brief.md` §1) і лишається частиною v1.

Рішення цієї сесії (2026-09-20), що звужують обсяг v1: текст пункту й чекбокс «виконано» — пряма дія користувача, агент лише опційно допомагає сформулювати текст у чаті, і його пропозиція лишається виключно в чаті, доки не підтверджена; перенесення пункту між горизонтами відкладено на v2; кожен пункт показує дату, коли він був доданий; очищення тексту пункту в редакторі — єдиний спосіб прибрати пункт зі списку (м'яко, без фізичного видалення), окремої кнопки видалення нема; чекбокс «виконано» — реверсивна дія.

**Decision override:** вимога «історія не втрачається» (raw idea §1, повторена в `idea-brief.md` §13 як обов'язкова навіть без окремого екрана відновлення) — v1 задовольняє її записом факту зміни (що і коли змінилось) у спільний Лог дій продукту, БЕЗ можливості переглянути чи відновити сам старий текст пункту. Rationale: під час цієї сесії спершу розглядали повне збереження версій тексту з екраном відновлення — але це вимагає окремого сховища попередніх версій і окремого UI, що вивело б фічу за межі вже узгодженого розміру «мала, ~1 тиждень» (`idea-brief.md` §11 сам оцінював зусилля в 3 людино-тижні — навіть без версій, тож повна історія точно підняла б обсяг). Користувач свідомо обрав лишити повне відновлення на v2, коли реальне використання покаже, чи ця можливість справді потрібна.

## 2. Goals

- Закрити логічний розрив продукту — дати користувачу єдине місце побачити наміри в трьох часових горизонтах, яких Декларація/Картки/Схема не показують.
- Дозволити зафіксувати намір і рух до нього без обов'язкової участі агента в кожній дрібній правці.
- Гарантувати, що жодна зміна пункту плану не проходить непоміченою — завжди лишається слід у спільному Лозі дій продукту.

## 3. Non-goals

- Зв'язок пункту плану з карткою — свідомо відкладено; Approach C (необов'язковий зв'язок) припарковано до появи реального використання v1, яке покаже, чи бракує цього зв'язку (`idea-brief.md` §14).
- Автоматичний каскад «стратегічний → оперативний → тактичний» — кожен горизонт незалежний, нічого не переносить пункти сам.
- Ручне перенесення пункту між горизонтами — рішення цієї сесії (2026-09-20): відкладено на v2, порядок додавання достатній зараз.
- Ручне перевпорядкування пунктів усередині горизонту — порядок додавання вважається достатнім для v1.
- Автоматична міграція чи каскадне перенесення дати додавання пункту при редагуванні — дата фіксується один раз при створенні й не змінюється редагуванням тексту.
- Повноцінне відновлення попереднього тексту пункту після редагування (окремий екран «стара версія / відновити») — v1 гарантує лише запис факту зміни в Лозі дій, не перегляд чи відкат попереднього формулювання; свідомо відкладено на v2, щоб не виходити за межі вже узгодженого розміру фічі (§1 ¶4, Decision override).

## 4. User stories

### US-01: Побачити три горизонти одним екраном

**As a** user
**I want** відкрити сторінку «ПЛАН» і побачити всі три горизонти (тактичний/оперативний/стратегічний) одночасно
**So that** я одразу бачу повну картину своїх намірів у часі, не перемикаючи екрани

### US-02: Додати пункт плану напряму

**As a** user
**I want** написати новий пункт плану прямо в повноекранному редакторі горизонту
**So that** я фіксую намір без зайвих кроків

### US-03: Отримати допомогу агента з формулюванням пункту

**As a** user
**I want** попросити агента в чаті допомогти сформулювати розмитий намір як чіткий пункт плану
**So that** я не застрягаю на формулюванні й усе одно фіксую намір

### US-04: Позначити пункт виконаним

**As a** user
**I want** поставити чекбокс «виконано» на пункті прямо на сторінці ПЛАН
**So that** я бачу прогрес без відкриття редактора

### US-05: Відредагувати чи прибрати пункт

**As a** user
**I want** відредагувати текст пункту (включно з очищенням, якщо він більше не потрібен) у повноекранному редакторі
**So that** я не тримаю в списку застарілі чи помилкові наміри, не маючи окремої кнопки видалення

### US-06: Побачити, що зміна пункту зафіксована

**As a** user
**I want** бачити факт редагування пункту в загальному Лозі дій продукту
**So that** я маю слід того, що і коли змінилось, навіть без перегляду старого тексту

### US-07: Мати приватний ПЛАН

**As a** user
**I want**, щоб мій ПЛАН бачив і редагував лише я
**So that** мої особисті наміри лишаються моїми

### US-08: Не бачити чужого/незавершеного тексту на сторінці

**As a** user
**I want**, щоб пропозиція агента щодо тексту пункту лишалась лише в чаті, доки я її не підтвердив
**So that** на сторінці ПЛАН ніколи не з'являється чужий чи незавершений текст

## 5. Acceptance criteria

### AC-01 (US-02) — happy path

**Given** an authorized user has opened the full-screen editor for one of the three horizons
**When** the user types a non-empty text for a new plan-item and saves it
**Then** the system adds the plan-item to that horizon's list, shown unchecked and stamped with today's date, without requiring any chat confirmation

### AC-02 (US-02) — error

**Given** an authorized user is creating a new plan-item in a horizon's editor
**When** the user tries to save it with empty text
**Then** the system blocks the save and explains that a plan-item needs text before it can exist

### AC-03 (US-04) — happy path

**Given** an authorized user has a plan-item in one of the three horizons
**When** the user clicks its checkbox directly on the ПЛАН page
**Then** the system marks it done immediately and keeps it visible in the same horizon's list — marking done never removes a plan-item from view

### AC-03b (US-04) — reversible toggle (concurrent edge of AC-03)

**Given** a plan-item is currently marked done
**When** the user clicks its checkbox again
**Then** the system returns it to not-done — marking done is a reversible toggle, not a one-way transition like a card reaching "filled"

### AC-04 (US-05) — domain invariant

**Given** an authorized user no longer wants to track a plan-item
**When** the user clears its text entirely in the horizon's editor and saves
**Then** the system removes the plan-item from the visible list — there is no delete action anywhere in the product for a plan-item; clearing its text via editing is the only way it stops being shown

### AC-05 (US-06) — cross-context

**Given** an authorized user creates a plan-item, edits its text, or changes its done/not-done state, whether typed directly or drafted with the agent's help
**When** any of these changes is saved
**Then** the system records the fact of the change (what changed and when) in the product's shared action log — the same log already used by cards and Structure

### AC-06 (US-08) — cross-context

**Given** an authorized user has asked the agent in chat to help formulate a plan-item's text
**When** the agent proposes wording the user has not yet confirmed
**Then** the system shows that wording only inside the chat — the ПЛАН page's horizon lists show no trace of it until the user explicitly saves it as a plan-item

### AC-07 (US-07) — authorization

**Given** an authorized user is signed in
**When** anyone (or anything acting on their behalf) attempts to view or change plan-items belonging to a different user's ПЛАН
**Then** the system denies access and does not confirm or deny that such a plan-item exists

### AC-08 (US-01) — happy path

**Given** an authorized user has plan-items across one or more of the three horizons
**When** the user opens the ПЛАН page
**Then** the system shows all three horizons at once, each listing its own plan-items with their current done/not-done state and the date each one was added

### AC-09 (US-03) — happy path

**Given** an authorized user has described a vague or hard-to-word intention to the agent in chat
**When** the agent proposes plan-item text and the user confirms it
**Then** the system creates the plan-item with the confirmed text in the horizon the user specified — exactly as if the user had typed it directly in the editor

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Latency p95 запис пункту (створення / редагування тексту чи чекбокса) | ≤ 300 ms | клієнтський таймер від збереження до оновленого стану сторінки |
| Latency p95 завантаження сторінки ПЛАН (усі три горизонти) | ≤ 500 ms | клієнтський таймер від відкриття сторінки до відображення всіх пунктів |
| Throughput | N/A — одноосібний клієнтський застосунок | не перевіряється, бо користувач один |
| Ідемпотентність збереження | подвійне швидке збереження того самого пункту не створює дублю | ручна перевірка / тест на debounce |

## 6.1 Security / privacy

- **Data classification:** confidential — текст пункту плану може описувати особисті наміри (здоров'я, гроші, стосунки), той самий клас чутливості, що декларація Структури.
- **Personal data touched:** так — вільний текст пункту плану.
- **AuthZ/AuthN impact:** кожне читання/запис ПЛАНу перевіряє власника (AC-07); один ПЛАН на користувача (singleton, як Структура), нових ролей понад `user` не додається.
- **Abuse cases:**
  - міжкористувацький доступ до чужого ПЛАНу → відмова, існування не підтверджується й не спростовується (AC-07).
  - вільний текст пункту зберігається й показується лише як текст, ніколи не інтерпретується як команда системі.
- **Security review:** Required — та сама межа авторизації й клас чутливих даних, що й `structure`/`life-area-card` §6.1.

## 7. Metrics / KPIs

- **Частка активних сесій, де заповнено всі три горизонти** — baseline: 0% (сторінки не існує), target: ≥50% протягом 30 днів від релізу.
- **Кількість пунктів, зафіксованих напряму vs через агента** — baseline: 0/0, target: спостережувана пропорція протягом перших 30 днів (перевіряє, чи опційна участь агента взагалі використовується).
- **Медіанний час від відкриття сторінки ПЛАН до першого доданого пункту** — baseline: немає даних; план вимірювання: зафіксувати час у Логах дій протягом перших 30 днів використання, конкретну ціль поставити на наступному перегляді KPI.

## 8. Open questions

- [ ] Feasibility §12 idea-brief — Time не підтверджено (коли з'явиться часове вікно на повний цикл SDD)? Default now: старт відкладено до підтвердження. — owner: Андрій, due: перед `sdd:tasks`
