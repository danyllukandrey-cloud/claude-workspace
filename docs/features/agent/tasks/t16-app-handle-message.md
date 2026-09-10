---
id: T16
title: "App: handle-message use-case"
layer: "app"
deps: ["T8", "T10", "T13", "T18"]
acs: ["AC-01", "AC-04", "AC-05", "AC-06", "AC-09", "AC-10", "AC-10b", "AC-15"]
files_hint: ["plan/app/src/agent/app/handle-message.ts"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T16 — App: handle-message use-case

## Why

Оркестрація домену (T8/T10), інфраструктури (T13) й `ask-agent` (T18) для повідомлення/вкладення → пропозиція чи уточнення — [`sad.md §5`](../sad.md#5-building-block-view) `app/handle-message.ts`, [`sad.md §6` Flows 1/3/5/10/11/12/13](../sad.md#6-runtime-view).

## What

Приймає повідомлення чи вкладення, читає короткий/довгий контекст пам'яті (T10), звертається до `ask-agent` (T18) для розбору й guard-перевірки, вирішує: сформувати пропозицію (AC-01/AC-10), оновити активну (AC-02b, делегується в T17 логіку статусу), відкинути стару мовчки (AC-03), чи повернути уточнююче питання без пропозиції (AC-04/AC-05).

## Definition of Done

- [ ] Integration test: щасливий шлях тексту й вкладення формує пропозицію
- [ ] Integration test: нерозпізнане вкладення повертає AC-10b без запису
- [ ] Integration test: суперечливі дані (AC-04) і неоднозначна картка (AC-05) повертають уточнення без пропозиції
- [ ] Integration test: усі запити скеровані лише на дані виклику `user_id` (AC-06)
- [ ] lint + vet clean

## Notes

Прибирання третьої особи (AC-06 приватність) виконує T10 до того, як факт потрапляє в довгострокову пам'ять — цей use-case лише передає текст, не дублює логіку.
