# Lexema CLI — comandos de desarrollo
# Estructura SCREAM: scripts/ en la raíz, código en cli/ y worker/
# Ver todos: make help

SCRIPTS := scripts

.PHONY: help install env server up use-local build cli ask chat models config typecheck test demo clean deploy

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
	@cd worker && npm run dev:node

up: ## Levanta el servidor local y abre el chat (al salir se detiene todo)
	@bash $(SCRIPTS)/up.sh

use-local: ## Apunta la CLI al servidor local (URL + token del .env)
	@node cli/dist/index.js config set-url http://localhost:8787
	@TOKEN=$$(grep -E '^CLIENT_TOKEN=' worker/.env 2>/dev/null | cut -d= -f2); \
	if [ -n "$$TOKEN" ]; then node cli/dist/index.js config set-token "$$TOKEN"; \
	else echo "Sin CLIENT_TOKEN en .env (endpoint abierto)"; fi

build: ## Compila la CLI (cli/dist)
	@cd cli && npm run build

cli: ## Corre la CLI local: make cli CMD="models"
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.js $(CMD)

ask: ## Pregunta puntual: make ask P="hola"
	@test -d cli/dist || $(MAKE) build
	@if [ -z "$(P)" ]; then echo 'uso: make ask P="tu pregunta"'; exit 1; fi
	@node cli/dist/index.js ask "$(P)"

chat: ## Sesión interactiva contra el servidor configurado
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.js chat

models: ## Lista los modelos del servidor configurado
	@test -d cli/dist || $(MAKE) build
	@node cli/dist/index.js models

config: ## Muestra la configuración actual de la CLI
	@node cli/dist/index.js config show

typecheck: ## Verifica tipos del worker (Cloudflare + servidor local)
	@cd worker && npm run typecheck

test: typecheck build ## Suite completa: tipos + smoke test + demo del flujo .env
	@bash $(SCRIPTS)/smoke-test.sh
	@bash $(SCRIPTS)/demo-env-flow.sh

demo: ## Solo el demo del flujo canónico con .env
	@bash $(SCRIPTS)/demo-env-flow.sh

clean: ## Borra artefactos de compilación
	rm -rf cli/dist cli/dist-bin

deploy: ## Publica el worker en Cloudflare
	@cd worker && npm run deploy
