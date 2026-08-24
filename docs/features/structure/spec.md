---
status: Draft
owner: "Андрій Данилюк"
reviewers: []
updated_at: "2026-08-23"
feature_size: "M"
---

# Spec — structure

> **Glossary:** [CONTEXT.md](../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/features/life-area-card/design-review.md` (блок 2, блок 3, блок 4), `docs/DECISIONS.md` (D-29, D-38, D-39, D-42, D-44, D-56, D-60, D-61, D-62), `docs/CONTEXT.md` (глосарій), `docs/features/life-area-card/spec.md` + `sad.md` (межа з карткою, cross-context джерело прогресу).
> **Ідеаційний прохід (крок 3 `specify`):** конкурентне дослідження й адвокат диявола повторно не запускались — `idea-brief.md` §6/§10 (тієї ж сесії ідеації продукту, 2026-08-18) уже покривають Структуру як частину загального задуму ПЛАНу. **Ризик з §10, який стосується саме Структури, не закрито мовчки** — «предмет аналітики не визначений… система підтверджує людині її ж власні цифри, незалежного джерела факту немає» — перенесено в §8 як відкрите питання, а не приховано посиланням.

## 1. Context

Користувач веде кілька карток (зон життя), але без Структури немає жодного місця, де побачити картину цілком: як усі напрямки виглядають разом, чи справді зусилля йдуть туди, куди заявлено пріоритетом. Це та сама «управлінська аналітика над життям», заради якої існує ПЛАН (Product_Brief.md) — рівень одного напрямку (картка) її дати не може за визначенням.

Тригер зараз — `life-area-card` (перша частина плану деталізації, D-56) пройшла `specify → design → data-model` повністю; Структура — природний наступний крок, і більшість її дизайну вже ухвалена рішеннями D-29/D-38/D-39/D-42/D-44 розкидано по реєстру — саме її й бракує звести в один документ.

Обраний підхід: один об'єкт на користувача — Структура — тримає (а) власну декларацію «картина світу, навіщо, пріоритет», окрему від Опису кожної картки; (б) розкладку карток одна відносно одної за одним із трьох варіантів групування (D-29); (в) екран зведеної аналітики — середній прогрес карток, що мають обчислюваний відсоток, порівну (D-38, [D-60](../../DECISIONS.md#d-60), [D-61](../../DECISIONS.md#d-61) — картки без відсотка виключені, їх кількість показана окремо) і чесний розрив між заявленим і фактичним, без вердикту (D-42, D-44, [D-60](../../DECISIONS.md#d-60), [D-61](../../DECISIONS.md#d-61)). Зміни картини світу (перейменовано / змінено місце в розкладці «за логікою» / закрито напрямок) записуються Структурою з першого дня; момент заведення картки вже записаний самою карткою (`life-area-card`) — Структура на нього посилається, не дублює. Екран перегляду цієї історії — поза цією версією (D-39, узгоджено з Андрієм 2026-08-23).

Ця специфікація описує лише Структуру — не поля самої картки (`life-area-card`) і не поведінку агента (`agent`, D-56). Аналітика **отримує прогрес кожної картки через уже наявний розрахунок картки** (`life-area-card` ADR-0001 — спільна доменна логіка клієнт+бекенд, **не збережене число**) — Структура не реалізує власну формулу підрахунку прогресу картки, лише зводить отримані значення.

Джерела: D-29 (три варіанти групування, вплив лише на аналіз навантаження), D-38 (частка виконання цілі, зведення), D-39 (історія Структури), D-42 (продукт показує і рух, і розрив), D-44 (розрив = заявлене vs реальне), [D-60](../../DECISIONS.md#d-60) (середнє порівну, без вердикту — закриває Q-6), [D-61](../../DECISIONS.md#d-61) (визначення розриву за типом розкладки, зведення карток без відсотка — закриває Q-10), [D-62](../../DECISIONS.md#d-62) (одна клітинка = одна картка).

## 2. Goals

- Користувач формулює власну декларацію «картина світу, навіщо, пріоритет» — окремо від Опису будь-якої картки.
- Користувач розкладає картки одна відносно одної за зручним для нього способом і будь-коли перекладає їх наново перетягуванням.
- Користувач бачить на одному екрані середній прогрес напрямків з обчислюваним відсотком (решта — окремим лічильником) і чесний розрив між заявленим пріоритетом і фактичними зусиллями — без готового вердикту.

## 3. Non-goals

- **Поля й поведінка самої картки** — предмет `life-area-card`; Структура лише отримує вже розрахований прогрес через її доменну логіку, не дублює формулу.
- **Характер, правила й пам'ять агента** — предмет `agent` (D-56).
- **Екран перегляду історії змін Структури** — запис іде з першого дня (D-39), але сам екран перегляду — не в цій версії продукту; повертаємось, коли накопичиться реальна історія використання (тижні/місяці), не тижні розробки.
- **Повноцінний інструмент «об'єднати дві картки»** (спільний профіль, спільна історія двох карток, що зливаються в одну) — у v1 не будуємо; розглядається пізніше, якщо практика покаже потребу (рішення 2026-08-23). Вужчий випадок — перенесення окремих метрик закритої картки в іншу існуючу картку — **у v1 є** (AC-12, [D-65](../../DECISIONS.md#d-65)).
- **Вердикт «ефективно/неефективно»** — Структура ніколи не показує оцінку «добре»/«погано» чи колірний індикатор; лише числа: прогрес, розрив, тренд ([D-60](../../DECISIONS.md#d-60)).

## 4. User stories

### US-01: Задекларувати картину світу

**As a** user
**I want** написати декларацію «картина світу, навіщо, пріоритет» на рівні Структури
**So that** вона зафіксована окремо від Опису будь-якої окремої картки

### US-02: Обрати спосіб розкладки

**As a** user
**I want** обрати один із трьох варіантів групування карток (одна картка / вільно без порядку / за логікою)
**So that** розкладка відповідає тому, як я реально бачу свої пріоритети

### US-03: Перекласти картки будь-коли

**As a** user
**I want** перетягнути картку на нову позицію в будь-який момент
**So that** розкладка лишається чесною, коли пріоритети змінюються

### US-04: Побачити зведений прогрес

**As a** user
**I want** побачити на одному екрані середній прогрес усіх моїх карток
**So that** я маю картину цілого, не відкриваючи кожну картку окремо

### US-05: Побачити розрив

**As a** user
**I want** побачити різницю між тим, що я заявив важливим, і тим, що показують дані — у формі, що підходить моєму способу розкладки
**So that** я можу чесно оцінити ситуацію, а не покладатись лише на відчуття

### US-06: Побачити тренд розриву

**As a** user
**I want** бачити, чи розрив по напрямку росте, чи меншає з часом
**So that** я знаю, стає краще чи гірше, а не лише поточний стан

### US-07: Почати без обраного способу розкладки

**As a** user
**I want** додавати картки, не обираючи спосіб групування заздалегідь
**So that** мене не блокує рішення, до якого я ще не готовий

### US-08: Закрити напрямок замість об'єднання

**As a** user
**I want**, коли два напрямки перетинаються, закрити один і продовжити в іншому вручну
**So that** мені не потрібен спеціальний інструмент об'єднання, яким я, може, й не скористаюсь

### US-09: Мати приватну Структуру

**As a** user
**I want**, щоб мою Структуру бачив і редагував лише я
**So that** моя картина життя лишається моєю

### US-11: Мати надійний слід змін картини світу

**As a** user
**I want**, щоб перейменування картки й зміна її місця в розкладці «за логікою» записувались автоматично, як і закриття
**So that** коли з'явиться екран історії, у нього буде що показати — включно з тим, як мінявся заявлений пріоритет, не лише сам факт існування картки

## 5. Acceptance criteria

### AC-01 (US-04) — happy path

**Given** an authorized user has one or more cards with computed progress
**When** the user opens the aggregated analytics screen
**Then** the system shows the average progress across all their cards that have a computable percentage

### AC-02 (US-03) — error

**Given** a user has chosen the logic-based layout, where each cell holds exactly one card
**When** the user drags a card onto a cell already occupied by another card
**Then** the system blocks the placement and explains the cell is taken, letting the user pick a free one

### AC-03 (US-09) — authorization

**Given** an authorized user is signed in
**When** the user attempts to view or edit a Structure that isn't their own
**Then** the system denies access and does not confirm or deny that such a Structure exists

### AC-04 (US-04) — domain invariant

**Given** a user's cards sit in different layout positions (e.g. one marked highest-priority, others not)
**When** the system computes the aggregated progress
**Then** the layout position never changes the calculation — every included card counts equally in the average

### AC-05 (US-04) — cross-context

**Given** a card's own screen and the Structure's analytics screen are both open to the same card's progress
**When** a recorded entry on that card is corrected or rolled back (`life-area-card` AC-12)
**Then** the Structure's aggregate reflects the same updated number the card itself shows — never a separately computed value that could disagree with it

### AC-06 (US-05) — logic-based layout

**Given** a user has arranged their cards in the logic-based layout (an explicit priority scheme by position)
**When** the user opens the analytics screen
**Then** the system shows, per card, the gap between its position-derived priority rank and its actual progress — honestly, with no "good/bad" verdict attached

### AC-06b (US-05) — layouts without a priority scheme

**Given** a user has arranged their cards in a layout with no priority scheme (single card or free arrangement)
**When** the user opens the analytics screen
**Then** the system shows no rank-based gap — instead it flags any card that was created (declared important enough to track) but shows no real tracking activity, as the signal "card declared important, not maintained"

### AC-07 (US-06)

**Given** a gap has been observed across more than one point in time for a card
**When** the user views that card's gap
**Then** the system also shows whether the gap is growing or shrinking, not only its current size

### AC-08 (US-03)

**Given** a user drags a card to a new free position
**When** the user releases it
**Then** the system saves the new position immediately and shows it there on the next view

### AC-09 (US-07)

**Given** a user has not chosen a layout mode yet
**When** the user adds a new card
**Then** the system places it using the default layout, without forcing a mode choice first

### AC-10 (US-01) — domain invariant

**Given** a user writes their Structure-level declaration
**When** the system saves it
**Then** it is stored and shown completely separately from any individual card's own Опис — the two are never merged or shown as one field

### AC-11 (US-02)

**Given** a user picks one of the three layout modes
**When** they confirm the choice
**Then** the system applies it to how their cards are arranged from that point on

### AC-11b (US-02) — зміна способу розкладки з уже розкладеними картками

**Given** a user has cards already arranged under one layout mode
**When** the user switches to a different layout mode
**Then** the system moves every card to the bottom of the screen in a fixed base order, shows the new mode's grid of allowed cells, and the user re-arranges each card into it by dragging

### AC-12 (US-08)

**Given** a user decides two cards overlap in what they track
**When** the user closes one of them
**Then** the system asks, for each metric on the closing card, whether to move it into another existing card; declined metrics are simply left behind, and the closure itself is recorded as a history event once the user confirms

### AC-13 (US-04) — domain invariant

**Given** a card has no computable progress percentage (an all-ongoing metric with no denominator, or a purely declarative card with no metric-block)
**When** the system computes the Structure's average
**Then** that card is excluded from the average and the count of excluded cards is shown separately, rather than treated as zero or silently distorting the average

### AC-15 (US-11) — domain invariant

**Given** a user renames a card, or moves it to a new position in the logic-based layout
**When** the action completes
**Then** the system records it as a Structure-history event with a timestamp, the same way closure is already recorded (AC-12) — regardless of whether a viewing screen exists yet. A card's creation moment is not recorded twice: it is already captured by the card's own history (`life-area-card`); Structure references it rather than duplicating it

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Latency p95 відкриття екрана зведеної аналітики (з кешу) | ≤ 300 ms | клієнтський таймер |
| Latency p95 запис зміни розкладки (перетягування) | ≤ 200 ms | клієнтський таймер |
| Throughput | N/A — одноосібний клієнтський застосунок | — |
| Офлайн-доступність (читання) | 100% — аналітика отримує прогрес карток через їхню ж offline-здатну доменну логіку, без мережі | ручна перевірка без з'єднання |
| Офлайн-доступність (запис) | розкладка й декларація приймаються офлайн, синхронізуються при відновленні з'єднання | ручна перевірка офлайн → онлайн |

## 6.1 Security / privacy

- **Data classification:** confidential — декларація «картина світу, навіщо» описує особисті цінності та пріоритети користувача.
- **Personal data touched:** так — вільний текст декларації.
- **AuthZ/AuthN impact:** кожне читання/запис Структури перевіряє власника (AC-03); одна Структура на користувача (singleton), нових ролей понад `user` не додається.
- **Abuse cases:**
  - міжкористувацький доступ до чужої Структури → відмова, існування не підтверджується й не спростовується (AC-03).
  - вільний текст декларації зберігається й показується лише як текст, ніколи не інтерпретується як команда системі.
- **Security review:** Required — та сама межа авторизації й клас чутливих даних, що й `life-area-card` §6.1.

## 7. Metrics / KPIs

- **Частка користувачів, що написали непорожню декларацію Структури за першу сесію** — baseline: 0 (нова фіча), target: ≥80% протягом 30 днів від першого використання.
- **Частка переглядів розриву, що привели до зміни розкладки/пріоритету протягом тижня** — baseline: 0, target: ≥20% протягом 60 днів (перевіряє, чи чесний розрив справді щось міняє, а не лишається цифрою).
- **Частка користувачів з обраним способом розкладки протягом перших 7 днів від першої створеної картки** — baseline: 0 (нова фіча), target: ≥50% протягом 90 днів після запуску (той, хто лишається без вибору — не помилка, AC-09, але метрика мусить рахувати спостережуваний потік, а не гіпотетичну «свідому відмову»).

## 8. Open questions

- [x] ~~Щільність поля розкладки (запас вільних клітинок чи клітинки з половинним кроком, design-review Блок 4)?~~ Закрито 2026-08-24 через `/sdd:design structure` — обрано «запас вільних клітинок» ([sad.md §5.2](sad.md#5-building-block-view)).
- [x] ~~Як спроєктувати форми так, щоб декларація Структури й Опис картки структурно не могли перетнутись?~~ Закрито 2026-08-24 через `/sdd:design structure` — три різні екрани/файли (Декларація / Схема / Аналітика), Опис картки лишається виключно всередині `life-area-card`, Структура його не рендерить ([sad.md §5.3](sad.md#5-building-block-view)).
- [ ] Коли реально знадобиться інструмент «об'єднати» напрямки (US-08 non-goal)? Default now: не будуємо, повертаємось за сигналом від практики. — owner: Андрій, due: за потреби, після MVP
- [ ] Як відрізнити змістовну зміну картини світу від виправлення одруківки в назві картки (D-39, відкрито з серпня — чи кожне перейменування (AC-15) варте рядка в майбутній історії, чи лише «суттєві»)? Default now: записуємо кожне перейменування без фільтра. — owner: Андрій, due: перед побудовою екрана історії (поза цією версією)
- [ ] Незалежне джерело факту для аналітики (idea-brief §10, адвокат диявола, двічі незалежно) — розрив і прогрес спираються лише на дані, які сам користувач вносить; системі нема з чим звірити це ззовні. Default now: приймаємо свідомо — немає плану на MVP. — owner: Андрій, due: перегляд після MVP, якщо стане реальною проблемою
- [x] ~~Перенесення метрики закритої картки в іншу (AC-12, [D-65](../../DECISIONS.md#d-65)) — `life-area-card` spec.md ще не має acceptance criterion на прийом перенесеної метрики з чужої картки.~~ Закрито 2026-08-24 — `life-area-card/spec.md` US-13/AC-14/AC-15: метрика лишається окремим блоком зі своєю історією, колізія назви пропонує перейменування.
- [x] ~~Реальне видалення картки з колоди карток ([D-66](../../DECISIONS.md#d-66)) — `life-area-card` не має власного стану «видалено»/«архівовано» взагалі.~~ Закрито 2026-08-24 — `life-area-card/spec.md` US-14/AC-16: м'яка архівація (`card.status`), як `entry.status`. Синхронізація з `structure_layout_position` при архівації — окреме відкрите питання в `life-area-card/spec.md` §8.
