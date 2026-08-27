---
id: T27
title: "UI: SCR-02 Налаштування правил screen"
layer: "ui"
deps: ["T22"]
acs: ["AC-07", "AC-08", "AC-12", "AC-14"]
files_hint: ["plan/app/src/agent/ui/RuleSettingsScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T27 — UI: SCR-02 Налаштування правил screen

## Why

Нижня навігація, той самий підхід, що вже задокументований для `structure`/`life-area-card` — [`screens.md` SCR-02](../screens.md#scr-02--налаштування-правил).

## What

`RuleCategoryMenu` (нове, мультивибір із 6 категорій D-27), `CardPicker` (reused з `structure/screens.md`), `TextField`/`Button` (з `design-system.md`). Виклики `GET/POST /rules` (T22). Рендерить 7 станів: `default`, `card-scope`, `empty`, `loading`, `saved`, `conflict`, `validation`.

## Definition of Done

- [ ] Component test: усі 7 станів зі `screens.md` SCR-02 рендеряться за відповідним триггером
- [ ] Component test: перемикання на `card-scope` показує `CardPicker`, приховує його у глобальному режимі
- [ ] lint + vet clean

## Notes

`RuleCategoryMenu` — нове, специфічне для 6 фіксованих категорій D-27, не переюзане ні з чого наявного.
