# COURSE-INDEX.md — навігаційний індекс курсу «Agentic Engineering з Claude»

> **Призначення файлу.** Це НЕ переказ курсу. Це **карта**: що де лежить і за яким
> точним шляхом це читати. Індекс тримається в контексті постійно; коли треба
> перевірити конкретну річ — Клод іде і читає потрібний файл **повністю**, і звіряє
> дослівно. Переказ для перевірки не годиться: перевірка вимагає точних формулювань.
>
> Складено 2026-07-20 з клону репозиторію.
> Джерело: `github.com/genkovich/agentic-engineering-course-public`
> Плагін SDLC: **версія 3.3.1**, автор Kyrylo Genkov (@genkovich), MIT.

---

## 0. Як цим користуватися

**Правило маршрутизації.** Андрій каже, що робить → Клод знаходить у розділі 2 потрібну
лекцію → бере точний шлях із розділу 3 або 4 → читає файл повністю → перевіряє дослівно
за DoD і анти-патернами з того ж файлу.

**Де лежить істина.** У кожному skill-і джерело правди — сам `SKILL.md`: він містить
протокол кроків, Definition of Done і список анти-патернів. Не переказ, а файл.

## 1. Масштаб (щоб не було ілюзій)

| Показник | Значення |
|---|---|
| Файлів усього | 1 397 |
| Markdown-файлів | 403 |
| Слів у markdown | 212 571 (~300 тис. токенів) |
| Розмір клону | 12 МБ |

**Це більше за контекстне вікно.** Тому — індекс + читання на вимогу, а не «прочитати все».

Розподіл тексту по модулях:

| Модуль | Слів | Частка |
|---|---|---|
| 6 — SDLC | 94 616 | 45% |
| 7 — Execution & Scale | 29 439 | 14% |
| 4 — Prompting Mastery | 21 561 | 10% |
| 5 — Claude Code Extended | 15 632 | 7% |
| 9 — Collaboration | 14 890 | 7% |
| 10 — Agent Teams | 13 034 | 6% |
| 8 — MCP | 8 404 | 4% |
| 3 — Setup | 4 951 | 2% |
| 2 — Ecosystem | 3 624 | 2% |
| 11 — Production | 3 369 | 2% |
| 1 — LLM Mechanics | 1 330 | 1% |

⚠️ **Увага:** кореневий `README.md` репо заявляє модулі 1–10, але в репо є ще
**модуль 11 — Production**. README застарілий.

## 2. Карта лекцій (усі 11 модулів)

### Модуль 1 — LLM Mechanics · `modules/1-llm-mechanics/`
1.1 Що таке LLM · 1.2 Токен і чому це важливо · 1.3 Контекстне вікно ·
1.4 Як модель пише відповідь (autoregression, sampling) · 1.5 Системний vs користувацький промпт ·
1.6 Параметри генерації (temperature, top_p, stop) · 1.7 Stateless природа моделі ·
1.8 Latency · 1.9 Embeddings · 1.10 Multi-modal входи · 1.11 Prompt injection на рівні моделі ·
1.12 Опенсорс vs пропрієтарні · 1.13 Як обирати модель

Демо: `1.2-token-counter/`, `1.3-context-window/`, `1.4-stochasticity/`, `1.9-embeddings/`

### Модуль 2 — Ecosystem · `modules/2-ecosystem/`
2.1 Tool use · 2.2 Coding assistants · 2.3 Agentic loop (observe → think → act) ·
2.4 MCP як стандарт · 2.5 Fine-tuning vs Prompting vs RAG · 2.6 Prompt injection і захисти ·
2.7 Multi-agent системи · 2.8 Memory і long-running агенти · 2.9 Економіка агентного запуску (ROI)

Демо: `2.1-tool-use/`, `2.3-agentic-loop/`, `2.5-rag/`, `2.5-fine-tune/`,
`2.6-prompt-injection/`, `2.7-data-privacy/`

### Модуль 3 — Claude Code Setup · `modules/3-claude-code-setup/`
3.1 Встановлення · 3.2 Налаштування середовища · 3.3 Ввід і команди ·
3.4 Settings.json — повний гід · 3.5 Сесії, контекст, compaction · 3.6 Permissions ·
3.7 Sandboxing · 3.8 Docker і devcontainers · 3.9 Claude Code поза терміналом + capstone

Starters: `3.9-starters/{nodejs-typescript,python-fastapi,go-chi,rust-axum}/`

**4 рівні захисту:** Settings (3.4) → Permissions (3.6) → Sandbox (3.7) → Devcontainer (3.8)

### Модуль 4 — Prompting Mastery · `modules/4-prompting-mastery/`
4.1 Як писати промпти · 4.2 Як давати контекст · 4.3 Папка `.claude/` як база ·
**4.4 CLAUDE.md — конвенції проєкту** · 4.5 Rules (path-rules) · 4.6 Режими Plan і Think ·
4.7 Контекст у довгій сесії · 4.8 Bounded Contexts · 4.9 Legacy Refactoring · 4.10 Scaffold

Демо: `4.1-prompts/PROMPTS.md`, `4.8-bc/` (Go×TS×Py × 3 стадії), `4.9-legacy-refactor/` (7 skills)

### Модуль 5 — Claude Code Extended · `modules/5-claude-code-extended/`
5.1 Custom Commands · 5.2 Agent Skills · 5.3 Створення власних Skills ·
5.4 Hooks · **5.5 Plugins: встановлення і створення** · 5.6 Marketplace для команди ·
5.7 Claude Agent SDK + capstone

Демо: `5.2-skills-intro/pdf-form-filler/`, `5.3-skills-creation/audit-api-endpoint/`,
`5.4-hooks/` (13 hooks), `5.5-plugins/` (before/after/red-flag), `5.7-sdk/sdk-cli/`

> 5.5 — найближча лекція до нашої **проблеми з плагіном** (`sdd` vs `sdlc`).

### Модуль 6 — SDLC через артефакти · `modules/6-sdlc/` ⭐ ГОЛОВНИЙ
6.1 SDLC через артефакти — мапа фаз і гейтів, **«чому файли, а не пам'ять сесії»** ·
6.2 Gate 1: словник домену → idea-brief (`fix-term`, `interview`, `classify-size`) ·
6.3 PRD (`write-prd`; Claude.ai/Projects як альтернативний транспорт) ·
6.4 Architecture Design (`architecture-design`; arc42 12 секцій + ADR + C4 L1/L2) ·
6.5 Sequence diagrams + data model (`complete-sequence-diagrams`, `generate-data-model`;
міграції expand/backfill/contract) · 6.6 API contracts (`api-forge`; drift check) ·
6.7 Tasks (`break-tasks`, `plan-tests`; 3-stage breakdown, `_epic.md` + `tracker.md`)

### Модуль 7 — Execution & Scale · `modules/7-execution-scale/`
7.1 Execution map · 7.2 Ralph loop · 7.3 `/goal` · 7.4 Dynamic workflows
(`agent()`/`parallel()`/`pipeline()`) · 7.5 Фонове виконання і розклад ·
7.6 Feedback loops (Playwright) · 7.7 TDD як execution discipline

### Модуль 8 — MCP · `modules/8-mcp/`
8.1 Що таке MCP · 8.2 Примітиви (tools/resources/prompts) · 8.3 Підключення серверів
(`.mcp.json`) · 8.4 Екосистема · 8.5 `claude mcp serve` · 8.6 Власний MCP-сервер ·
8.7 MCP Inspector · 8.8 Канали · 8.9 Безпека MCP

### Модуль 9 — Collaboration · `modules/9-collaboration/` ⭐ ВАЖЛИВИЙ ДЛЯ СИНХРОНІЗАЦІЇ
9.1 Git workflow (trunk-based, bisect, відкат, секрет-guard) · 9.2 Git worktrees ·
9.3 Worktree merge + cleanup · 9.4 Pull requests · 9.5 Code review локально
(`/code-review`, `/security-review`) · 9.6 GitHub platform · 9.7 Release + docs

> Саме тут відповідь на задачу «один проєкт на двох ПК».

### Модуль 10 — Agent Teams · `modules/10-agent-teams/`
10.1 Subagents · 10.2 Custom subagents · 10.3 Evals і регресії ·
10.4 Agent teams · 10.5 Agentic debugging

### Модуль 11 — Production · `modules/11-production/`
11.1 Security / red-team (GitHub issue-worker, prompt injection у issue) ·
11.2 Від порожньої VPS до першого deploy (Contabo, Ubuntu, self-hosted runner, Docker Compose) ·
11.2.1 Agent on duty (Prometheus, Grafana, Loki — згадується як наступна лекція)

## 3. Модуль 6 — точні шляхи (використовувати найчастіше)

Корінь: `modules/6-sdlc/sdlc/`

### 3.1 Гейти й процес — `00-overview/`

| Файл | Що всередині |
|---|---|
| `process-map.md` | Mermaid-схема всього SDLC + таблиця гейтів + хто що пише |
| `definition-of-ready.md` | 13 пунктів DoR — що готове ДО першого рядка коду |
| `definition-of-done.md` | 9 пунктів DoD + «що НЕ є DoD» |
| `mvp-vs-full.md` | матриця MVP проти повного циклу |
| `file-structure.md` | як розкладати файли |
| `process-metrics.md` | метрики процесу |
| `rollout-plan.md` | план викочування |

**4 гейти, які блокують рух далі:**

| # | Гейт | Що блокує |
|---|---|---|
| 03 | SPEC | без SPEC немає контракту ЩО/НАВІЩО — архітектура гадатиме |
| 04 | Architecture brief | без брифу arc42 пишеться наосліп |
| 11 | ADR | без записаних рішень у задачах будуть дірки |
| 16 | Review checklist | без чек-листа рев'ю нерівномірне |

**Хто що пише:** PM — idea-brief, SPEC (співавтор), KPI. Tech Lead — SPEC (співавтор),
sequence, рев'ю ADR, DoR sign-off, task-breakdown, claude-context, review-checklist, KB note.
Architect — architecture-brief, arc42, C4. Backend Lead — data-model, міграції, API, ADR.
QA — план тестів. Release manager — CHANGELOG.

### 3.2 Одинадцять skills — `plugin/skills/<name>/SKILL.md`

Порядок = порядок проходження. 9 стадійних + 2 наскрізні.

| # | Skill | Команда | Шаблони в `templates/` |
|---|---|---|---|
| 1 | `interview` | `/sdlc-interview <slug>` | `idea-brief.md` |
| 2 | `write-prd` | `/sdlc-write-prd` | `PRD-template.md` |
| 3 | `architecture-design` | `/sdlc-architecture-design` | `sad-template.md`, `adr-template.md`, `c4-context.md`, `c4-container.md`, `deployment.md` |
| 4 | `complete-sequence-diagrams` | `/sdlc-complete-sequence-diagrams` | `seq-flow.md` |
| 5 | `generate-data-model` | `/sdlc-generate-data-model` | `data-model.md`, `rules-migrations-baseline.md` |
| 6 | `api-forge` | `/sdlc-api-forge` | `openapi.yaml`, `events.md` |
| 7 | `break-tasks` | `/sdlc-break-tasks` | — |
| 8 | `plan-tests` | `/sdlc-plan-tests` | `test-plan.md` |
| 9 | `decide-adr` | `/sdlc-decide-adr` | — |
| — | `fix-term` (наскрізний) | `/sdlc-fix-term` | `CONTEXT.md` |
| — | `classify-size` (наскрізний) | `/sdlc-classify-size` | — |

**Ключова механіка:** GATE-skills **жорстко відмовляються** запускатися, якщо немає
обов'язкового вхідного артефакту. Кожен skill сам копіює свої шаблони з
`skills/<name>/templates/` у `delivery/<slug>/`.

### 3.3 Приклади — `examples/`

| Приклад | Файли | Для чого |
|---|---|---|
| `course-lesson-mvp/` | CONTEXT, idea-brief, PRD, sad, 2 ADR, data-model, openapi.yaml, `tasks/` (27 story-файлів + `_epic.md` + `tracker.md` + `_generation.md`) | **наскрізний, найповніший** — весь ланцюжок від ідеї до задач |
| `goals-tracking/` | `arc42.md` | модуль з OKR-логікою — **тематично найближчий до «ПЛАНу»** |
| `rate-limiting/` | SPEC, idea-brief, brainstorm, architecture-brief, data-model, ADR×2, openapi, diagrams/, test-plan, implementation-pack, review-checklist, feature-rollout-plan, kb-note, CHANGELOG, claude-context | cross-cutting фіча, **найбільше типів документів** |

### 3.4 Інше

- `document-templates/` — cross-feature / manual / legacy: SPEC, CONTEXT-MAP, arc42, ADR,
  migration plan, rollback, review checklist, task breakdown
- `scripts/generate-gates.sh`, `scripts/sdlc_lint.py` — допоміжні скрипти
- `plugin/plugin.json` — маніфест, `name: sdlc`, version 3.3.1

## 4. Що вже прочитано повністю (не треба перечитувати)

| Файл | Коли |
|---|---|
| кореневий `README.md` | 2026-07-20 |
| `modules/6-sdlc/README.md` | 2026-07-20 |
| `modules/6-sdlc/sdlc/README.md` | 2026-07-20 |
| `plugin/skills/interview/SKILL.md` | 2026-07-20 |
| `plugin/skills/fix-term/templates/CONTEXT.md` | 2026-07-20 |
| `00-overview/definition-of-ready.md` | 2026-07-20 |
| `00-overview/definition-of-done.md` | 2026-07-20 |
| `00-overview/process-map.md` | 2026-07-20 |
| `modules/3-claude-code-setup/README.md` | 2026-07-20 |
| `modules/4-prompting-mastery/README.md` | 2026-07-20 |

Конспект прочитаного — у `CONTEXT.md`, розділ 10.

## 5. Прогалини — чого в репо НЕМА

1. **Теорія лекцій.** Кореневий README прямо каже: «Лекції та теорія — у LMS курсу.
   Цей репо тримає тільки код, що клонується і запускається». Відео і текст лекцій
   доступні лише на сайті курсу за логіном Андрія.
2. **Відео.** Клод відео не дивиться в принципі. Потрібні **транскрипти** — текстові
   записи сказаного.
3. **Домашні завдання.** «Деталі — у LMS-уроках відповідної лекції».
4. **Модулі 9 і 10 не мають кореневого README** — назви лекцій відновлені за іменами
   каталогів, описи лекцій відсутні.

## 6. Як дати Клоду постійний доступ

Зараз клон живе у **тимчасовому середовищі Клода** і зникне з кінцем сесії.
Для постійного доступу потрібні три кроки.

**Крок 1 — клон на комп'ютер Андрія.** Git Bash:

```bash
cd ~/Desktop
git clone https://github.com/genkovich/agentic-engineering-course-public.git
```

⚠️ Клонувати **поруч** із `claude-workspace`, а не всередину: репозиторій усередині
репозиторію ламає Git.

**Крок 2 — під'єднати папку.** Клод викликає `request_cowork_directory`, Андрій обирає
папку, що містить і проєкт, і клон курсу. Після цього Клод читає будь-який файл курсу
у будь-якій сесії.

**Крок 3 — транскрипти LMS.** Складати у `docs/course/lms/` за схемою `<номер>-<тема>.md`,
напр. `docs/course/lms/6.2-gate-1.md`. Робити поступово — по уроку, коли Андрій до нього
доходить. Без цього Клод знає практику курсу, але не теорію лекцій.

**Оновлення курсу:** репо змінюється (модуль 11 з'явився після README). Періодично:

```bash
cd ~/Desktop/agentic-engineering-course-public && git pull
```

## 7. Відкриті питання

- [ ] **Плагін:** `SETUP_DONE.md` каже `genkovich/sdd` + `/sdd:specify`; курсовий репо
      дає `sdlc` v3.3.1 + `/sdlc-interview`. Дві різні версії. **Блокер** — з'ясувати,
      що реально стоїть на паралельному ПК. Дотична лекція — 5.5.
- [ ] **Конфлікт імен `CONTEXT.md`:** курсовий = словник домену; наш = стан проєкту.
      Пропозиція — наш перейменувати на `PROJECT-STATE.md`.
- [ ] Прочитати решту 10 SKILL.md (прочитано лише `interview`)
- [ ] Розібрати `examples/goals-tracking/arc42.md` — найближчий до «ПЛАНу»
- [ ] Прочитати модуль 9 (Git workflow) — це рішення задачі «два ПК»
- [ ] Транскрипти LMS — жодного ще немає
