---
status: Living
tool: code
figma_file: ""
pen_file: ""
updated_at: "2026-08-24"
---

# Design system — ПЛАН

> Проєктний **дизайн-канон**, вироблений один раз на весь репозиторій скілом `design-system` і читаний скілами `ux-flows` / `screens` / `implement` / `review`. Закомічений — вибір інструмента й перелік компонентів спільні для всього проєкту, не персональні. [`architecture-map.md` §Frontend / UI foundation](architecture-map.md) лишається інвентарем **коду**; цей файл — **дизайн-сторона** канону (інструмент, орієнтація, джерело токенів, компоненти, наскрізні конвенції). Оновлюється через `/sdd:design-system`, коли міняється фундамент.

## Platform posture

- **Posture:** mobile-first — PWA встановлюється на телефон (D-24), головний сценарій використання — телефон; екрани спершу проєктуються під вузький екран, потім адаптуються вгору.
- **Breakpoints / device classes:** ще не зафіксовано — Tailwind матиме стандартні брейкпоінти, коли з'явиться `tailwind.config.ts` (`implement`).

## Design tool

- **Tool:** code — жодного MCP для Figma чи Pencil в сесіях цього проєкту немає; екрани описуються markdown-текстом у `screens.md` кожної фічі.
- **Library location:** «бібліотека» — самі компоненти в репозиторії, `plan/app/src/shared/ui/`.

## Token source

- **Colors:** ще не існує — `plan/app/tailwind.config.ts` (з'явиться разом з `implement`).
- **Spacing / sizing:** те саме джерело, коли з'явиться.
- **Typography:** те саме джерело, коли з'явиться.

## Component inventory

| Component | Source (`file:line` / node / URL) | States it supports | Notes |
|---|---|---|---|
| `CardShell` | `plan/app/src/shared/ui/index.ts:4` | — | **Заплановано, ще не написано.** Каркас картки, що перевертається (лицьова / зворотна сторона) |
| `Button` | `plan/app/src/shared/ui/index.ts:5` | — | **Заплановано, ще не написано** |
| `NumberField` | `plan/app/src/shared/ui/index.ts:5` | — | **Заплановано, ще не написано** |
| `TextField` | `plan/app/src/shared/ui/index.ts:5` | — | **Заплановано, ще не написано** |

`screens.md` кожної фічі описує екрани цими назвами; коли `implement` напише компонент насправді, рядок оновлюється реальним `file:line` і переліком станів.

## Interaction & writing conventions

- **Errors:** інлайн, прямо на екрані/картці, де сталась помилка — ніколи `alert`/`confirm` (уже зафіксовано, [`plan/app/CLAUDE.md`](../plan/app/CLAUDE.md), `structure/sad.md` §2).
- **Empty states:** простий текст — що тут порожньо і яка наступна дія (без ілюстрацій) — *запропонований дефолт, не остаточне рішення, можна змінити при першому реальному екрані.*
- **Loading:** спінер (не skeleton) — простіше зробити, відповідає обсягу MVP — *запропонований дефолт.*
- **Validation:** on-submit (перевірка при спробі зберегти/підтвердити, не при виході з поля) — *запропонований дефолт.*
- **Microcopy tone:** чесно й прямо, без пом'якшення формулювань («тон без вердикту» — [D-42](DECISIONS.md#d-42), [D-60](DECISIONS.md#d-60): продукт показує числа як є, без «добре/погано»).
