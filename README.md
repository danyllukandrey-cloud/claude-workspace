# ПЛАН

## Що це

Сервіс, за допомогою якого користувач формалізує, структурує та веде свій план життя. Складається із застосунку та сайту.

Для кого продукт і яку задачу знімає — [Product Brief](docs/Product_Overview/Product_Brief.md). Модель, принципи й напрямок розвитку — [Product Vision](docs/Product_Overview/Product_Vision.md).

## Поточний статус

Актуальний стан за фазами SDLC (% готовності, блокери, активна робота) — [DELIVERY-PLAN.md](docs/DELIVERY-PLAN.md). Тут не дублюємо навмисно: цей розділ сам був застарілим (казав «2026-07-05, стадія опису ідеї») до виправлення 2026-08-19 — саме той дубль, якого тепер уникаємо.

> Примітка: поточна розробка (стартова/тестова/навчальна частина) ведеться окремо від довгострокового бачення — одне не заважає іншому.

## Розгортання на новому комп'ютері

Покрокова інструкція: [docs/SETUP-NEW-MACHINE.md](docs/SETUP-NEW-MACHINE.md)

## Документи проєкту

Повний перелік — 36 файлів, згруповані за темою. У кожного один рядок: назва, посилання, одне речення про що він. Хто з чим пов'язаний — дивись «Карту власників» у [CLAUDE.md](CLAUDE.md), тут це навмисно не повторюємо.

### Продукт

- [Product Brief](docs/Product_Overview/Product_Brief.md) — суть продукту, для кого, яку проблему вирішуємо
- [Product Vision](docs/Product_Overview/Product_Vision.md) — довгострокове бачення, модель продукту, принципи
- [Goals](docs/Product_Overview/Goals.md) — цілі проєкту та етапи реалізації
- [Success Metrics](docs/Product_Overview/Success_Metrics.md) — метрики успіху сервісу
- [Concept.md](docs/Product_Overview/Concept.md) — онбординг-текст і мануал заповнення картки (D-76/D-77/D-78)

### Стан і рішення

- [DECISIONS.md](docs/DECISIONS.md) — реєстр усіх рішень: що діє, що скасовано, що відкладено
- [PROJECT-STATE.md](docs/PROJECT-STATE.md) — детальний робочий контекст і історія проєкту
- [DELIVERY-PLAN.md](docs/DELIVERY-PLAN.md) — тактичний план за фазами SDLC, % готовності, блокери
- [CONTEXT.md](docs/CONTEXT.md) — словник домену (терміни продукту)
- [ISSUES.md](docs/ISSUES.md) — реєстр виявлених нестиковок логіки (D-81)

### Архітектура

- [architecture-map.md](docs/architecture-map.md) — технічна архітектура, стек, модулі
- [ADR-0001](docs/adr/0001-frontend-stack.md) — рішення про стек фронтенду
- [ADR-0002](docs/adr/0002-card-module-architecture.md) — архітектура модуля картки
- [ADR-0003](docs/adr/0003-client-only-persistence.md) — зберігання лише на клієнті
- [ADR-0004](docs/adr/0004-scaffold-architecture.md) — архітектура каркасу проєкту
- [plan/app/ARCHITECTURE.md](plan/app/ARCHITECTURE.md) — детальна архітектура застосунку
- [plan/app/CLAUDE.md](plan/app/CLAUDE.md) — конвенції фронтенд-коду для Claude

### Артефакти фіч

- [life-area-card/idea-brief.md](docs/features/life-area-card/idea-brief.md) — бриф ідеї першої фічі (RICE/Feasibility Confirmed, D-79)
- [life-area-card/spec.md](docs/features/life-area-card/spec.md), [structure/spec.md](docs/features/structure/spec.md), [agent/spec.md](docs/features/agent/spec.md) — повні SDD-специфікації трьох фіч (заміняють `plan/app/SPEC.md`, D-80)
- [z-archive/life-area-card-design-review.md](docs/z-archive/life-area-card-design-review.md) — архів: архітектурне інтерв'ю generic-картки (9 блоків), замінено `life-area-card/sad.md` (D-80)
- [z-archive/plan-app-SPEC.md](docs/z-archive/plan-app-SPEC.md) — архів: перша сумарна специфікація v1, замінено трьома `spec.md` вище (D-80)
- [portfolio-rebalancing-card/idea-brief.md](docs/z-archive/portfolio-rebalancing-card/idea-brief.md) — архів: бриф скасованої тестової картки (D-22)
- [portfolio-rebalancing-card/competitive-research.md](docs/z-archive/portfolio-rebalancing-card/competitive-research.md) — архів: конкурентне дослідження

### Курс

- [COURSE-INDEX.md](docs/course/COURSE-INDEX.md) — навігаційна карта курсу «Agentic Engineering»
- [hw-4.10-scaffold-plan.md](docs/course/hw-4.10-scaffold-plan.md) — домашнє завдання 4.10, план каркасу

### Налаштування

- [SETUP-NEW-MACHINE.md](docs/SETUP-NEW-MACHINE.md) — розгортання проєкту на новому комп'ютері
- [_setup/README.md](_setup/README.md) — допоміжні файли початкового налаштування
- [.githooks/README.md](.githooks/README.md) — git-хуки проєкту (перевірка міток рішень)

### Робочий процес і інструменти Claude Code

- [PM-WORKFLOW.md](docs/PM-WORKFLOW.md) — команди `/session-brief`, `/pm-start`, `/pm-end` і коли їх вводити
- [.claude/skills/README.md](.claude/skills/README.md) — паспорт скілів проєкту (свої й скопійовані з курсу)
- [.claude/skills/session-brief/SKILL.md](.claude/skills/session-brief/SKILL.md) — скіл короткого статусу на старті сесії
- [.claude/agents/pm.md](.claude/agents/pm.md) — субагент аналізу стану проєкту
- [.claude/commands/pm-start.md](.claude/commands/pm-start.md) — команда «план на сьогодні»
- [.claude/commands/pm-end.md](.claude/commands/pm-end.md) — команда «звірка сесії»

### Навігація

- [CLAUDE.md](CLAUDE.md) — правила роботи з Андрієм, карта власників фактів, дозволи
- [plan/README.md](plan/README.md) — навігація по папці `plan/`
