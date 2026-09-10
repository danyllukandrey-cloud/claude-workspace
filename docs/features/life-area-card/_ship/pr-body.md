<!-- PR body -- gh pr create --body-file docs/features/life-area-card/_ship/pr-body.md -->

## Summary

Перша фіча продукту «ПЛАН»: картки зон життя з генерик-блоками-метриками (кількість/частота/ціль), внесенням і виправленням записів, обчисленим прогресом, перенесенням блоку між картками, архівацією/розархівацією й перейменуванням — на реальному бекенді (Express + Neon), захищена входом через Google. Спеки: [spec.md](../spec.md).

## Acceptance criteria

- AC-01 — happy path: підтверджений запис оновлює прогрес ✓
- AC-02 — картка без назви блокується ✓
- AC-03 — заповнена картка вимагає непорожній Опис ✓
- AC-04 — non-disclosure: чужа картка й неіснуюча картка невідрізнимі (той самий `card.not_found`/404) ✓
- AC-05 — "постійний процес" показує накопичену кількість, не відсоток без дедлайну ✓
- AC-06 — близькі за часом конфліктні записи не рахуються мовчки, обидва `pending` до вирішення ✓
- AC-07 — агент допомагає знайти вимірне число для невимірної цілі ✓
- AC-08 — картка без блоку-метрики лишається декларативною, ніколи не "actively tracked" ✓
- AC-09 (+AC-09b) — прогрес по блоку + агрегат (середнє арифметичне часток bounded-блоків), перевищення цілі — capped share + окремий надлишок ✓
- AC-10 — агент вказує на підозрілі дані, не блокує картку (fail-open) ✓
- AC-11 — запис, що чекає на перевірку агентом, не рахується до підтвердження ✓
- AC-12 — виправлення/відкат запису з історії, прогрес перераховується ✓
- AC-13 — історія останніх записів показує, що і коли записано ✓
- AC-14/AC-15 — перенесення блоку-метрики між картками, колізія назва+одиниця пропонує перейменування ✓
- AC-16 — видалення картки = м'яка архівація, ніколи не фізичне видалення ✓
- AC-17 — розархівація повертає `active`, позиція в розкладці НЕ відновлюється автоматично (D-104) ✓
- AC-18 — архівні картки окремо від колоди, режим перегляду без можливості нового запису ✓
- AC-19 — перейменування картки (дотик до назви або меню «...») ✓

## Design

- Spec: `docs/features/life-area-card/spec.md`
- Architecture: `docs/features/life-area-card/sad.md`
- Decisions: `docs/features/life-area-card/adr/0001-recompute-progress-from-raw-events.md`, `docs/features/life-area-card/adr/0002-hold-unconfirmed-records-pending.md`; repo-рівня: `docs/adr/0001`…`0006` (стек, архітектура модуля, персистентність, scaffold, datastore, backend HTTP+міграції); ключові рішення в `docs/DECISIONS.md`: D-22, D-23…D-33, D-57, D-69, D-87, D-93, D-97, D-98, D-102…D-112.
- Data model + migration: `docs/features/life-area-card/data-model.md` (7 міграцій, промоучені в `plan/app/migrations/`: create-card, create-metric-block, create-entry, create-card-lifecycle-event, add-card-status, add-card-restore, add-owner-fk)
- API: `docs/features/life-area-card/contracts/openapi.yaml`

## Tasks (SDD-Task trailers)

52/52 задачі `tasks.json` (38 оригінальних хвиль 1-9 + 14 review-remediation T39-T52), кожна своїм комітом — повний перелік: `git log --oneline --grep="SDD-Task" -E`. Ключові: T1-T5/T32/T38 (міграції проти реальної Neon), T9-T12 (domain), T10 (Postgres-репозиторій), T13-T23/T33-T35 (use-case + ports шар), T25-T29/T36-T37 (UI, 7 екранів), T30 (Express composition root + сесія), T31 (cross-cutting e2e), T39-T52 (виправлення за `/sdd:review`: транзакційність, Claude-клієнт fail-open, backend hardening, a11y).

## Verification

- Unit: 352/352 passed (`npm test`, щойно перепрогнано)
- Integration: 67/67 passed проти реальної Neon (`npm run test:integration`, щойно перепрогнано)
- Lint + vet: чисто (`npm run lint` — `tsc --noEmit` × 2 tsconfig, щойно перепрогнано)
- Ran the feature: спот-перевірено вручну проти РЕАЛЬНОГО HTTP-сервера (реальний `createApp`/Express, реальна Neon; JWT test-double замість Google, той самий підхід що `server/cross-cutting.integration.test.ts`) — 6/6: AC-02 (422 `card.name_required`), AC-01 (201, запис прийнято), AC-09 (`aggregateProgress=0.4` для 4/10 — формула середнього арифметичного), AC-04 (404 `card.not_found`, та сама форма що для дійсно неіснуючої картки), AC-16 (архівація 200), AC-17 (розархівація 200, `status:'active'`). Незалежне рев'ю двома проходами вже PASS: [`_review/review-2026-09-07.md`](../_review/review-2026-09-07.md) → [`_review/review-2026-09-07-followup.md`](../_review/review-2026-09-07-followup.md).

## Operational notes

- Migration: 7 міграцій уже застосовані/промоучені (`plan/app/migrations/`), деплой не потребує ручного кроку понад `npm run migrate`; відкат — `npm run migrate:down`.
- Feature flag / config: обов'язкові `.env`: `DATABASE_URL`, `DATABASE_URL_POOLED`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`; опційний `CLAUDE_API_KEY` (fail-open, вимикає лише AC-10).

**Відомі, свідомо відкладені якісні знахідки** (не блокують ship, зафіксовані з owner/due): ISS-88 (non-UUID усередині транзакції), ISS-90 (необмежений виклик Claude на кожен `GET /cards/{id}`), ISS-91 (`computeProgress` кидає на отруєних до T43 рядках, яких фізично не існує), ISS-92/93 (клавіатурна доступність — редагування Опису, focus trap у `ConfirmDialog`), ISS-94 (`clearAllCachedData` чистить увесь `localStorage` origin) — деталі й умова повернення в [`docs/ISSUES.md`](../../ISSUES.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
