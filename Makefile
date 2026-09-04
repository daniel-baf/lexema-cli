# Lexema CLI — comandos de desarrollo
# Estructura SCREAM: scripts/ en la raíz, código en cli/ y worker/
# Ver todos: make help

SCRIPTS := scripts

.PHONY: help install env server up use-local use-lan build compile cli ask chat models config typecheck lint test demo clean sync sync-up sync-down sync-status

SYNC_BUCKET := gs://precise-blend-428821-e0-lexema-sync
SYNC_ENV_REMOTE := $(SYNC_BUCKET)/env/.env

help: ## Lista los comandos disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Instala dependencias de cli/ y worker/
	@cd cli && npm install
	@cd worker && npm install

env: ## Crea worker/.env desde .env.example (si no existe)
	@if [ -f worker/.env ]; then \
		echo "worker/.env ya existe"; \
	else \
		cp worker/.env.example worker/.env; \
		echo "Creado worker/.env — editalo: proveedor (AI_PROVIDER) y API key"; \
	fi

server: ## Levanta el servidor local de pruebas (http://localhost:8787)
	@test -f worker/.env || { echo "Falta worker/.env. Corre primero: make env"; exit 1; }
	@cd worker && npm run dev

up: ## Levanta el servidor local y abre el chat (al salir se detiene todo)
	@bash $(SCRIPTS)/up.sh

use-local: ## Apunta la CLI al servidor local (URL + token del .env)
	@node cli/dist/index.mjs config set-url http://localhost:8787
	@TOKEN=$$(grep -E '^CLIENT_TOKEN=' worker/.env 2>/dev/null | cut -d= -f2); \
	if [ -n "$$TOKEN" ]; then node cli/dist/index.mjs config set-token "$$TOKEN"; \
	else echo "Sin CLIENT_TOKEN en .env (endpoint abierto)"; fi

use-lan: ## Detecta las IPs de esta máquina y elegí cuál usa la CLI (para probar desde otro dispositivo)
	@test -d cli/dist || $(MAKE) build
	@node $(SCRIPTS)/select-lan-ip.mjs

build: ## Compila la CLI (cli/dist)
	@cd cli && npm run build

compile: ## Genera binarios standalone (cli/dist-bin): linux-x64, linux-arm64, windows-x64, apuntando a SERVER_HOST de worker/.env
	@node $(SCRIPTS)/compile.mjs

cli: ## Corre la CLI local: make cli CMD="models"
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.mjs $(CMD)

ask: ## Pregunta puntual: make ask P="hola"
	@test -d cli/dist || $(MAKE) build
	@if [ -z "$(P)" ]; then echo 'uso: make ask P="tu pregunta"'; exit 1; fi
	@node cli/dist/index.mjs ask "$(P)"

chat: ## Sesión interactiva contra el servidor configurado
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.mjs chat

models: ## Lista los modelos del servidor configurado
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.mjs models

config: ## Muestra la configuración actual de la CLI
	@node cli/dist/index.mjs config show

typecheck: ## Verifica tipos de cli/ y worker/
	@cd cli && npm run typecheck
	@cd worker && npm run typecheck

lint: ## Corre ESLint en cli/ y worker/
	@cd cli && npm run lint
	@cd worker && npm run lint

test: typecheck lint build ## Suite completa: tipos + lint + unit tests + smoke test + demo del flujo .env
	@cd cli && npm run test
	@cd worker && npm run test
	@bash $(SCRIPTS)/smoke-test.sh
	@bash $(SCRIPTS)/demo-env-flow.sh

demo: ## Solo el demo del flujo canónico con .env
	@bash $(SCRIPTS)/demo-env-flow.sh

clean: ## Borra artefactos de compilación
	rm -rf cli/dist cli/dist-bin

sync: sync-status ## Alias de sync-status: muestra si local/bucket están desincronizados

sync-up: ## Sube worker/.env al bucket temporal (para que otra VM lo baje)
	@test -f worker/.env || { echo "Falta worker/.env. Corre primero: make env"; exit 1; }
	@gcloud storage cp worker/.env $(SYNC_ENV_REMOTE)
	@echo "→ Subido a $(SYNC_ENV_REMOTE)"

sync-down: ## Baja worker/.env del bucket temporal (hace backup del local si existe)
	@if [ -f worker/.env ]; then \
		cp worker/.env worker/.env.bak.$$(date +%Y%m%d%H%M%S); \
		echo "→ Backup local guardado: worker/.env.bak.*"; \
	fi
	@gcloud storage cp $(SYNC_ENV_REMOTE) worker/.env
	@echo "→ worker/.env actualizado desde $(SYNC_ENV_REMOTE)"

sync-status: ## Compara la fecha del worker/.env local contra el del bucket
	@echo "Local:"
	@[ -f worker/.env ] && stat -c '  worker/.env  %y' worker/.env || echo "  worker/.env no existe"
	@echo "Bucket:"
	@gcloud storage ls -L $(SYNC_ENV_REMOTE) 2>/dev/null | grep -E "Creation Time|Update Time" | sed 's/^/  /' || echo "  Sin archivo en el bucket todavía (corre: make sync-up)"
