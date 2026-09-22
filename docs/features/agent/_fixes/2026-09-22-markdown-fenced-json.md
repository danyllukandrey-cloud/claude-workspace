---
slug: agent
date: 2026-09-22
triage: gap
acs: [AC-22]
commit: 279f0e3
recurrence_of: none
---

# Fix: агент показує сирий JSON-конверт замість reply, коли модель обгортає відповідь у markdown code fence

## Symptom

Живе тестування (2026-09-22, одразу після додавання `ANTHROPIC_API_KEY`): користувач написав "тук" у чат агента. Очікувано — звичайне уточнююче питання простими словами. Отримано — весь службовий JSON-конверт разом із декоративними позначками коду ` ```json ... ``` ` показаний як є в бульбашці чату.

Зачіпає всіх користувачів, будь-коли модель вирішує обгорнути відповідь у markdown code fence — не залежить від конкретного повідомлення чи сценарію (proposal/clarification).

## Root cause

`parseAgentDecision` (`src/agent/app/handle-message.ts:253`) викликає `JSON.parse(raw)` напряму на сирій відповіді моделі. Коли модель обгортає JSON у ` ```json ... ``` `, `JSON.parse` кидає `SyntaxError`, спрацьовує `catch`-гілка (рядки 278-297), яка навмисно не вгадує намір і повертає `reply: raw` — тобто весь сирий текст, позначки коду включно.

Слизнуло повз наявні тести, бо всі попередні тести (`decisionJson()` у `handle-message.test.ts`) конструюють ідеально чистий JSON без обгортки — жоден не перевіряв стійкість парсера до декоративного форматування моделі, хоча `RESPONSE_FORMAT_INSTRUCTION` у системному промпті лише просить модель не додавати текст поза JSON, не забороняє явно markdown-позначки.

## The pinning test

`src/agent/app/handle-message.test.ts` → `handleMessage -- Flow 1 (AC-01): text -> proposal` → `'parses the decision even when Claude wraps it in a markdown code fence (```json ... ```)'` (unit-рівень, мокований `AskClaude`).

Провал ДО фіксу:
```
AssertionError: expected '```json\n{"outcome":"proposal","reply…' to be 'Записав 5 км бігу.'
```

## Spec patch

(c) gap — новий AC-22 доданий до `docs/features/agent/spec.md` §5:

```
### AC-22 (US-01) — технічна гарантія
**Given** агент відповідає внутрішнім форматом обміну даними (JSON з полем reply)
**When** модель обгортає цю відповідь у декоративні позначки коду (```json ... ```)
**Then** система все одно розпізнає формат і показує користувачу лише зрозумілий текст поля reply — ніколи сирий службовий формат
<!-- added-by-fix: 2026-09-22 -->
```

Погоджено з користувачем (AskUserQuestion, "Так, додати як є").

## Follow-ups

- Жодних — фікс мінімальний, лише `stripMarkdownCodeFence` перед `JSON.parse`, без рефакторингу сусіднього коду.
