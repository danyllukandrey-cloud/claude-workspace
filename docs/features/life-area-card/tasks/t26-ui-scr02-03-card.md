---
id: T26
title: "UI: SCR-02/SCR-03 Картка (face+back)"
layer: "ui"
deps: ["T24", "T21", "T22", "T23"]
acs: ["AC-01", "AC-02", "AC-03", "AC-05", "AC-06", "AC-09", "AC-09b", "AC-10", "AC-11", "AC-12", "AC-13", "AC-14", "AC-15"]
files_hint: ["plan/app/src/cards/life-area-card/ui/CardFace.tsx", "plan/app/src/cards/life-area-card/ui/CardBack.tsx"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T26 — UI: SCR-02/SCR-03 Картка (face+back)

## Why

Головний екран картки — [`screens.md` SCR-02](../screens.md#scr-02--картка-лицьова-сторона) / [SCR-03](../screens.md#scr-03--картка-зворот-відстеження).

## What

`CardFace`/`CardBack` на `CardShell` (T24) + `NEW: MetricBlockCard`, `NEW: EntryHistoryList`. Виклики T21 (картка), T22 (блоки-метрики), T23 (записи/історія). Рендерить усі стани обох екранів: лицьова — `default`/`empty-description`/`warning`/`loading`/`error`; зворот — `default`/`capped`/`ongoing`/`declarative`/`pending-entry`/`history-expanded`/`transfer-collision`/`loading`/`error`.

## Definition of Done

- [ ] Component test: усі стани SCR-02 зі `screens.md` рендеряться за відповідним триггером
- [ ] Component test: усі стани SCR-03 зі `screens.md` рендеряться за відповідним триггером
- [ ] lint + vet clean

## Notes

Найбільша UI-задача (L) — найбільше AC зосереджено на одному екрані, бо це основне місце, де користувач бачить наслідки майже кожного acceptance criterion картки.
