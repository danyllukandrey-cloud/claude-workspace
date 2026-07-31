# Підготовка до воркшопу — виконано

> ❄️ **ЗАМОРОЖЕНО — це знімок стану на 2026-07-02, історичний запис, а не робочий документ.**
>
> Файл **не оновлюється і не синхронізується**. Актуальний стан проєкту живе в
> [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md), розділ 5 «Технічна база».
> Причина заморозки: усе, що тут написано, дублюється в журналі, а один факт має мати
> один дім — інакше копії розходяться.
>
> **Станом на 2026-07-26 два твердження нижче вже неправдиві.** Я їх свідомо НЕ виправляю
> (знімок має лишитись знімком), а лише позначаю:
>
> 1. `tasks.json` лежить **не в корені**, а в `docs/features/_scaffold/tasks.json`.
> 2. Комітів уже не 2, а **4**; репозиторій підключений до GitHub
>    (`danyllukandrey-cloud/claude-workspace`).

## Інструменти
- **Git** v2.55.0 — встановлений ✅
- **Claude Code** v2.1.198 — встановлений, залогінений ✅
- **VS Code** — встановлений ✅
- **Mermaid Preview** (bierner) — встановлений у VS Code ✅

## Плагін SDD
- Встановлений через `/plugin marketplace add genkovich/sdd` ✅
- Активований через `/reload-plugins` ✅
- Survey завершений ✅

## Проєкт "ПЛАН"
- Робоча папка: `C:\Users\Andrii\Desktop\claude-workspace`
- Фундамент закладено: `docs/architecture-map.md`, 3 ADR-файли, `tasks.json`
- Git ініціалізований, зроблено 2 коміти ✅
- Стек: React + TypeScript + Vite + PWA

## Налаштування Claude Code
- Dynamic workflows: true ✅
- Verbose output: true ✅

## Наступний крок
`/clear` → `/sdd:specify portfolio-rebalance`