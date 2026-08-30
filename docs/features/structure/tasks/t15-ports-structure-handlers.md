---
id: T15
title: "Ports: GET/PATCH /structure handlers"
layer: "ports"
deps: ["T11"]
acs: ["AC-03", "AC-10", "AC-11", "AC-16"]
files_hint: ["plan/app/src/structure/ports/structure-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T15 — Ports: GET/PATCH /structure handlers

## Why

[contracts/openapi.yaml](../contracts/openapi.yaml) `getMyStructure` / `updateMyStructure`.

## What

HTTP-обробники, що витягують `owner_user_id` з Bearer-токена (ніколи з path/body), викликають T11, мапують результат на контракт (200/401/422 точно за `openapi.yaml`).

## Definition of Done

- [ ] Handler-тест: перший GET автоматично провіснює Структуру (lazy), повертає 200
- [ ] Handler-тест: PATCH з невалідним `layoutMode` повертає 422 `structure.invalid_layout_mode`
- [ ] Handler-тест: PATCH з невалідним `logicVariant` повертає 422 (та сама сім'я помилок, AC-16) — включно з випадком `logicVariant` заданим при `layoutMode` не `logic`
- [ ] Handler-тест: відсутній/невалідний токен → 401
- [ ] lint + vet clean

## Notes

Жодного параметра ID Структури в маршруті немає навмисно (AC-03 — структурна гарантія, `contracts/api-sync-report.md`).

**Контракт `openapi.yaml` наразі не оновлений** під `logicVariant` — сам файл вимагає regen через `/sdd:api structure --reconcile`, не ручну правку (шапка файлу). Виконати перед стартом цієї задачі, інакше нема за чим звіряти форму 422.
