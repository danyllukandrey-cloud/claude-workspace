# Урок 4.10 «Scaffold» — виконано 2026-08-07

> Стисла версія. Повний план з обґрунтуваннями, рев'ю критика і картками блоків — в історії Git, коміт `bb0863d`.

**Завдання:** створити каркас проєкту — структуру папок і базові файли — і зробити коміт `initial scaffold`. [Урок в LMS](https://lms.agenticengineering.it.com/courses/agentic-engineering-PhA/urok-10-scaffold-iak-kulminatsiia-materializatsiia-bc-u-failovu-sistemu).

## Блоки

| # | Дія | Результат | |
|---|---|---|:--:|
| 1 | Прибрати биті посилання, оголосити переїзд коду | 8 посилань, 4 документи | ✅ |
| 2 | Записати архітектурне рішення | [`ADR-0004`](../adr/0004-scaffold-architecture.md) | ✅ |
| 3 | Створити скелет папок | 8 файлів-заглушок у `plan/app/src/` | ✅ |
| 4 | Написати правила для Claude | [`CLAUDE.md`](../../plan/app/CLAUDE.md) · [`ARCHITECTURE.md`](../../plan/app/ARCHITECTURE.md) | ✅ |
| 5 | Зафіксувати, що будуємо | [`SPEC.md`](../../plan/app/SPEC.md) | ✅ |
| 6 | Налаштувати команди й збірку | `package.json`, `Makefile`, `.env.example`, конфіги Vite | ✅ |
| 7 | Записати рішення, закомітити, влити в `main` | D-16…D-18, push | ✅ |
| 8 | Зібрати здачу | 5 пунктів для LMS | ✅ |

## Факти

| Що | Значення |
|---|---|
| Коміт каркасу | `bb0863d` — `initial scaffold` |
| Коміт зі штампом | `5f8d07e` |
| Гілка | `urok-10-scaffold` → влита в `main`, видалена |
| Корінь коду | `plan/app/` |
| Архітектура | шари всередині картки: `domain/` + `ui/` + `index.ts` |
| ADP-паттерн для здачі | **#6 Planning** |

## Три відхилення від задуму

1. **Комітів вийшло два, а не один.** Штамп `reflects_commit` неможливо вписати до того, як коміт існує.
2. **Блок 6 захопив частину задачі S1** з [`tasks.json`](../../docs/features/_scaffold/tasks.json) — додали `tsconfig.json`, `vite.config.ts`, `index.html`. Без них `Makefile` містив би команди, які не працюють.
3. **Дві папки перейменовано:** `ПЛАН/` → `plan/` (кирилиця ламала `git status` і скріни), `portfolio-rebalance` → `portfolio-rebalancing-card` (збіг із назвою папки документів).

## Що лишилось

- `npm install` ще не запускався — команди перевірені лише на папері
- Відкриті питання Q-4 (дві папки артефактів) і Q-5 (розмір допуску) — у [`DECISIONS.md`](../DECISIONS.md)
- ADR-0001…0003 досі «прийнято за замовчуванням» — [`PROJECT-STATE §9.3`](../PROJECT-STATE.md)
