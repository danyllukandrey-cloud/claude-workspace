<!-- PR body -- gh pr create --body-file docs/features/life-plan-levels/_ship/pr-body.md -->

## Summary

Нова сторінка продукту «ПЛАН» — три фіксовані часові горизонти намірів (тактичний / оперативний / стратегічний), кожен зі своїм списком пунктів. Пункт додається напряму або через підтвердження в чаті з агентом; чекбокс "виконано" — реверсивний тумблер; очищення тексту пункту = м'яке видалення. Спеки: [spec.md](../spec.md).

## Acceptance criteria

- AC-01 — пряме додавання пункту плану ✓
- AC-02 — порожній чи лише-пробільний текст блокується (422 `plan_item.text_required`) ✓
- AC-03/AC-03b — чекбокс "виконано" — реверсивний тумблер, не одноразова дія ✓
- AC-04 — очищення тексту наявного пункту = м'яке видалення; whitespace-only НЕ те саме, що порожньо (виправлено during review) ✓
- AC-05 — ідемпотентність збереження, вікно 1с (`Idempotency-Key`) ✓
- AC-06 — редактор відкривається на ОДНОМУ пункті, з власною кнопкою "+" на додавання ✓
- AC-07 — non-disclosure: чужий і неіснуючий пункт невідрізнимі (той самий `plan_item.not_found`/404) ✓
- AC-08 — усі три горизонти видно одночасно, з датою додавання (рік показується, коли не поточний — для БУДЬ-ЯКОГО горизонту, виправлено during review) ✓
- AC-09 — пункт, підтверджений у чаті, з'являється на сторінці ПЛАН одразу, без ручного перезаходу (виправлено during review) ✓
- AC-11 — порожній горизонт має власну робочу кнопку "+", не текстову заглушку ✓

## Design

- Spec: `docs/features/life-plan-levels/spec.md`
- Architecture: `docs/features/life-plan-levels/sad.md` — 0 нових ADR (усе успадковує прецедент `structure`'s ADR-0003 + D-114, §9 пояснює чому)
- Data model + migration: `docs/features/life-plan-levels/data-model.md` (1 таблиця `plan_item`, промоучена в `plan/app/migrations/1789912813806_create-plan-item.sql`)
- API: `docs/features/life-plan-levels/contracts/openapi.yaml`

## Tasks (SDD-Task trailers)

14/14 задачі `tasks.json` (T1-T14), кожна своїм комітом — повний перелік: `git log --oneline --grep="SDD-Task" -E life-plan-levels`. Домен (`plan-item.ts`), Postgres-репозиторій, use-case шар (create/update/delete/list з ін'єкцією `recordAction`), ports-хендлери з ідемпотентністю, UI (`PlanScreen`, `PlanItemEditor`), допомога агента в чаті (T12), підключення в навігації app-shell (T11).

## Verification

- Unit: 1224/1224 passed (`npm test`, щойно перепрогнано)
- Integration: 96/96 passed проти реальної Neon (`npm run test:integration`, щойно перепрогнано; 2 таймаути в непов'язаних тестах `life-area-card` T16/T17 підтверджені як мережева флакі — проходять чисто в ізоляції)
- Lint + vet: чисто (`npm run lint` — `tsc --noEmit` × 2 tsconfig, щойно перепрогнано)
- Ran the feature: спот-перевірено вручну проти РЕАЛЬНОГО HTTP-сервера (`localhost:3000`, реальний Express, реальна Neon, JWT підписаний тим самим `JWT_SECRET`, що й `server/index.ts` — не test-double) — 8/8 кроків: AC-08/AC-11 (`GET /plan-items` → 200, порожній список легітимний), AC-02 (`POST` з пробілами → 422 `plan_item.text_required`), AC-01 (`POST` → 201, реальний рядок у Neon), AC-03/AC-03b (`PATCH done:true` → 200, потім `PATCH done:false` → 200), фікс E (`PATCH {}` → 400 `plan_item.nothing_to_update`), AC-04 (`DELETE` → 204, пункт зникає зі списку активних — `stillThere:false`).
- Незалежне рев'ю двома паралельними проходами (7 знахідок, усі виправлені) вже PASS: [`_review/review-2026-09-20.md`](../_review/review-2026-09-20.md).

## Operational notes

- Migration: `1789912813806_create-plan-item.sql` уже промоучена й застосована, деплой не потребує ручного кроку понад `npm run migrate`; відкат — `npm run migrate:down`.
- Feature flag / config: використовує ті самі обов'язкові `.env`, що й решта продукту (`DATABASE_URL`, `DATABASE_URL_POOLED`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`) — жодних нових.

**Відомі, свідомо відкладені якісні знахідки** (не блокують ship, зафіксовані з owner/due): ISS-151 (commit-msg хук D-101 не розпізнає `plan/app/src/plan-horizons/` як частину `life-plan-levels` — нешкідливе попередження на комітах задач), ISS-152 (контракт позначає `Idempotency-Key` як `required: true`, реалізація це не перевіряє — без реального впливу, бо підключений фронтенд завжди його шле) — деталі в [`docs/ISSUES.md`](../../ISSUES.md).

**Перед мерджем:** Андрій ще проводить власне ручне тестування в браузері (dev-сервери лишені запущеними: backend `:3000`, frontend `:5173`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
