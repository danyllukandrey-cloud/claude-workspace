# API sync report — agent — 2026-08-27

## Section A — field-origins

| schema_path | origin | confidence |
|---|---|---|
| Message.id | data-model.md → `chat_message.id` | high |
| Message.role | data-model.md → `chat_message.role` (CHECK enum) | high |
| Message.content | data-model.md → `chat_message.content` | high |
| Message.createdAt | data-model.md → `chat_message.created_at` | high |
| MessageCreate.content | data-model.md → `chat_message.content` (input side) | high |
| MessageCreate.attachment | inferred from spec.md AC-10 — no column (транзитне, ніколи не зберігається, `data-model.md` note) | medium |
| MessageTurn.reply | inferred from spec.md AC-01/AC-04/AC-05/AC-07 — composed at request-time, не окрема колонка | medium |
| MessageTurn.proposal | data-model.md → `agent_proposal` (через `Proposal`, референс) | high |
| Proposal.id | data-model.md → `agent_proposal.id` | high |
| Proposal.cardId | data-model.md → `agent_proposal.card_id` (FK, зовнішня сутність `life-area-card.card`) | high |
| Proposal.metricBlockId | data-model.md → `agent_proposal.metric_block_id` (FK, зовнішня сутність `life-area-card.metric_block`) | high |
| Proposal.status | data-model.md → `agent_proposal.status` (CHECK enum) | high |
| Proposal.sourceType | data-model.md → `agent_proposal.source_type` (CHECK enum) | high |
| Proposal.rawInput | data-model.md → `agent_proposal.raw_input` | high |
| Proposal.proposedAmount | data-model.md → `agent_proposal.proposed_amount` | high |
| Proposal.proposedSummary | data-model.md → `agent_proposal.proposed_summary` | high |
| Proposal.createdAt / updatedAt | data-model.md → `agent_proposal.created_at` / `.updated_at` | high |
| ActiveProposalResponse.proposal | derived (single-resource nullable wrapper, не cursor) | high |
| Rule.id | data-model.md → `imperative_rule.id` | high |
| Rule.scopeCardId | data-model.md → `imperative_rule.scope_card_id` (FK, зовнішня сутність `life-area-card.card`) | high |
| Rule.category | data-model.md → `imperative_rule.category` (CHECK enum, 6 D-27) | high |
| Rule.ruleText | data-model.md → `imperative_rule.rule_text` | high |
| Rule.createdAt / updatedAt | data-model.md → `imperative_rule.created_at` / `.updated_at` | high |
| RuleCreate.* | ті самі колонки, вхідна сторона | high |
| Report.id | data-model.md → `activity_report.id` | high |
| Report.periodType | data-model.md → `activity_report.period_type` (CHECK enum) | high |
| Report.periodStart / periodEnd | data-model.md → `activity_report.period_start` / `.period_end` | high |
| Report.content | data-model.md → `activity_report.content` | high |
| Report.status | data-model.md → `activity_report.status` (CHECK enum) | high |
| Report.generatedAt | data-model.md → `activity_report.generated_at` | high |
| OnboardingStatus.welcomeShown | inferred from spec.md AC-13 + sad.md §6 Flow 15 — обчислюється (наявність вітального `chat_message`), не окрема колонка | medium |
| OnboardingStatus.message | data-model.md → `chat_message` (через `Message`, референс, лише коли щойно створено) | high |
| *Page.next_cursor / has_next / has_prev | derived (cursor-обгортка, конвенція skill) | high |

**Немає ендпоінта** для `app_user`, `long_term_memory_fact`, `agent_audit_event` — свідомо, не пропуск:
- `app_user` — ідентичність, доступна лише неявно через Bearer-токен, не окремий CRUD-ресурс.
- `long_term_memory_fact` — редагування/видалення виключно командою в чаті («забудь, що…», `sad.md §4`) через `POST /messages`, задокументовано в `info.description`.
- `agent_audit_event` — внутрішній аудит-слід (§8 SAD), жодна US/AC не вимагає його читання користувачем у цьому проході; майбутній admin/debug-ендпоінт — поза обсягом.

## Section B — drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓. `GET/POST /messages` → `chat_message` (+ `agent_proposal` у відповіді POST); `GET /proposals/active`, `POST /proposals/{id}/confirm` → `agent_proposal`; `GET/POST /rules` → `imperative_rule`; `GET /reports` → `activity_report`; `GET /onboarding` → `chat_message` (створює вітальний запис).
2. **Error code ↔ repo error definition** *(core)* — no error registry found — codes are the contract's proposal; reconcile when the repo defines them (бекенд ще жодного разу не піднімався, `architecture-map.md §Migrations`; той самий стан, що й у звіті `structure`).
3. **Validation ↔ constraint** *(core)* — ✓ з одним задокументованим винятком. Усі `enum` (`Proposal.status`, `Proposal.sourceType`, `Rule.category`, `Report.periodType`, `Report.status`) = відповідні `CHECK` у `data-model.md`. **Виняток:** `data-model.md CHECK (category IS NOT NULL OR rule_text IS NOT NULL)` на `imperative_rule` — крос-польова умова, яку статична JSON Schema `RuleCreate` незручно виражає (потрібен `oneOf`/`anyOf`, що ускладнить контракт заради одного правила). Замість схемного обмеження — рантайм-перевірка, `422 agent.rule_empty`. Свідомий вибір, не забутий CHECK.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ після виправлення однієї прогалини.

### Знайдена й виправлена прогалина

**Flow 2 (`sad.md §6`, Claude API недоступний)** спершу не мала відповідного error-response у контракті — `POST /messages` мала лише `422`/`429`. Додано `503 agent.llm_unavailable` до фіналізації, з описом «без retry, текст не втрачено» (accepted debt, `sad.md §11`).

### Зафіксовані свідомі межі (не помилки)

- **`409 agent.proposal_not_active`** (`POST /proposals/{id}/confirm`) — жоден §6-потік не малює цю гілку явно (Flow 1 показує лише щасливий шлях підтвердження). Походження — домен-інваріант `uq_agent_proposal_active_user` (`data-model.md`) + AC-03, не намальована послідовність. Це стандартний ідемпотентний захист (повторний виклик confirm на вже неактивній пропозиції), не діра в апстрімі — тому **Accept**, не Save-as-OQ.
- **AC-04/AC-05/AC-06/AC-09/AC-13(частково)/AC-15** — поведінкові критерії, реалізовані як звичайна відповідь `POST /messages` (`reply`), а не окремий код помилки чи поле схеми. Контрактно видима лише форма (`reply: string`), не сама коректність розпізнавання — це очікувано для природномовної взаємодії, перевіряється тестами на рівні `implement`/`review`, не структурою контракту.

## `events.md` — свідомо не написано

`sad.md §6` Flow 14 (автозвіт активності) намальовано за async-шаблоном (idempotency-check, retry, dead-letter) — формальна ознака для `events.md` є. Але учасники потоку — лише `Worker` і `DB`, жодного `<message-bus>` чи зовнішнього консьюмера (ADR-0002: «без окремої черги/брокера», worker сам читає ту саму базу за розкладом). Немає міжсервісного контракту повідомлення, який варто було б документувати — retry/dead-letter поведінка вже описана `activity_report.status` у `data-model.md`. Написання порожнього `events.md` без реального консьюмера додало б файл заради формату, не змісту.

## Back-feed coverage — §4 use-case pass

| US | Операція(ї) |
|---|---|
| US-01 | `POST /messages` (текст + вкладення) |
| US-02 | `POST /proposals/{id}/confirm`, `POST /messages` (уточнення AC-02b, мовчазне відкидання AC-03) |
| US-03 | `POST /rules` (власний текст), `POST /messages` (діалог формулювання, AC-14) |
| US-04 | `GET/POST /rules` (меню категорій, card-override) |
| US-05 | `POST /messages` (уточнююча відповідь, AC-04) |
| US-06 | `POST /messages` (поведінка пам'яті, без окремого ендпоінта — AC-09/AC-15) |
| US-07 | `POST /messages` (неоднозначна картка, AC-05) |
| US-08 | `GET /reports` |
| US-09 | `GET /onboarding` |

Усі 9 US мають ≥1 операцію.

## Back-feed coverage — §5 AC pass

| AC | Операція / відповідь |
|---|---|
| AC-01, AC-10 | `POST /messages` 201, `proposal` присутній |
| AC-02 | `POST /proposals/{id}/confirm` 200 |
| AC-02b | `POST /messages` 201 (оновлює активну пропозицію) |
| AC-03 | `POST /messages` (мовчазне відкидання, внутрішньо) + `409` на confirm неактивної (Accept, див. вище) |
| AC-04 | `POST /messages` 201, `reply` без `proposal` |
| AC-05 | `POST /messages` 201, `reply` без `proposal` |
| AC-06 | глобально — `401`/`403` через `BearerAuth` + скоуп бекенда, не окрема операція |
| AC-07 | `POST /rules` 201 + поведінка `POST /messages` |
| AC-08 | `GET/POST /rules` |
| AC-09 | `POST /messages` (поведінка, без структурного маркера) |
| AC-10b | `POST /messages` 422 `agent.attachment_unrecognized` |
| AC-11 | `GET /reports` 200 |
| AC-12 | `POST /rules` зі `scopeCardId` |
| AC-13 | `GET /onboarding` 200 |
| AC-14 | `POST /rules` 409 `agent.rule_conflict` |
| AC-15 | `POST /messages` (поведінка, без структурного маркера) |

Усіх 17 AC зі `spec.md §5` показано.

## Підсумок

1 core-знахідка не була помилкою (validation-виняток, задокументовано), 1 supporting-прогалина знайдена й виправлена до фіналізації (Flow 2 → `503`). 0 core-помилок лишилось, <3 flags — запуск не призупинявся.

**Наступний крок:** `/sdd:screens agent` (`target_surfaces` включає `web-frontend` — чат-панель).
