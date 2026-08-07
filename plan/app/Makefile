# Makefile — тільки переадресація. Справжні команди живуть у package.json → scripts.
#
# Навіщо цей файл, якщо є npm: на macOS і Linux звична команда `make test`.
# На Windows програми `make` немає — там запускаємо `npm run ...` напряму.
#
# ЦЕ НЕ ДУБЛЬ. Список команд існує в одному місці (package.json).
# Тут лише перекидання виклику. Правило єдиного джерела не порушене.
#
# Увага при редагуванні: відступ у Makefile — це символ табуляції, не пробіли.

.PHONY: install dev build preview test lint

install:
	npm install

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

test:
	npm test

lint:
	npm run lint
