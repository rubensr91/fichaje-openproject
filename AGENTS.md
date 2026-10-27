# AGENTS.md

Guía para agentes que trabajen en este repositorio.

## Objetivo

Extensión de navegador para:

1. leer la actividad de un día en GitLab;
2. resumirla con un LLM opcional;
3. crear un fichaje en OpenProject.

Chrome/Brave, Manifest V3, JavaScript vanilla, sin build y sin dependencias de runtime.

## Lectura obligatoria

Antes de cambiar código:

- `README.md`: uso y configuración.
- `SECURITY.md`: modelo de amenazas y manejo de secretos.
- `manifest.json`: permisos reales.
- `src/config.js`: valores por defecto y claves de almacenamiento.

## Comandos

```bash
npm test
```

Comprobación rápida de sintaxis:

```bash
for f in background.js sidepanel.js src/*.js test/*.js; do node --check "$f"; done
```

Cargar en Brave/Chrome:

1. `brave://extensions` o `chrome://extensions`.
2. Modo desarrollador.
3. Cargar descomprimida.
4. Seleccionar la carpeta que contiene `manifest.json`.

No hay `npm install`, bundler ni paso de compilación.

## Arquitectura

```text
sidepanel.html/css/js
        |
        | chrome.runtime.sendMessage
        v
background.js
        |
        +-- src/gitlab.js
        +-- src/openproject.js
        +-- src/llm.js
        +-- src/redact.js
        +-- src/summary.js
        +-- src/time.js
        +-- src/http.js
        +-- src/config.js
        +-- src/secrets.js
        +-- src/vault.js
```

- `sidepanel.js` solo pinta UI y envía mensajes.
- `background.js` enruta mensajes y llama a las APIs.
- Las llamadas HTTP se hacen desde el service worker, no desde el panel.
- `src/http.js` centraliza fetch, timeout y errores.
- La configuración se guarda en `chrome.storage.local` bajo `fichajeConfig`.

## Flujos principales

### GitLab

- `GET /api/v4/user`
- `GET /api/v4/projects/:id`
- commits, MRs e issues del proyecto para el día (`fetchDay`) o para un rango (`fetchRange`, usuario y proyecto una sola vez).
- Modo por defecto «Todas las contribuciones» (`gitlabMode: "all"`): `GET /api/v4/events` descubre los proyectos activos por día; después `fetchDayActivity` pide el detalle completo de cada proyecto (commits/MRs/issues) y los eventos sirven de respaldo y para comentarios y MRs/issues de terceros cerradas o merged por el usuario. Alternativa: `gitlabMode: "project"` con proyecto concreto.
- Token con `read_api` o `api`. `read_user` solo no sirve.
- `isConfigured` solo exige `gitlabProject` en modo `project`.

### Modo semanal

- Mensajes nuevos en `background.js`: `FETCH_RANGE`, `CHECK_EXISTING_RANGE`, `CREATE_ENTRIES`.
- `CHECK_EXISTING_RANGE` agrupa fichajes por día con `spent_on =d` multi-fecha (`getExistingEntriesForDates`).
- `CREATE_ENTRIES` comprueba duplicados, detecta la actividad una vez y crea día a día, saltando los que ya tienen fichaje. Devuelve `created`/`skipped`/`failed`.
- El panel muestra una tarjeta por día con resumen editable y casilla de inclusión; los días sin actividad quedan desmarcados.
- El tramo horario es el mismo para todos los días del rango.

### Resumen

- `src/llm.js` llama a cualquier endpoint compatible con OpenAI:
  `POST {llmBaseUrl}/chat/completions`.
- Configuración: `llmBaseUrl`, `llmModel`, `llmApiKey`.
- Si falta configuración o falla, se usa `fallbackSummary()` de `src/summary.js`.
- El cliente debe seguir siendo genérico. Los valores por defecto pueden apuntar a un proveedor concreto, pero el usuario debe poder cambiarlos.
- No enviar tokens de GitLab/OpenProject al LLM.

### OpenProject

- `GET /api/v3/users/me`
- `GET /api/v3/my_preferences` para zona horaria.
- `GET /api/v3/time_entries/available_projects`
- `GET /api/v3/projects/:id/work_packages`
- `POST /api/v3/time_entries/form` para detectar actividades.
- `GET /api/v3/time_entries` para duplicados.
- `POST /api/v3/time_entries` para crear.

Reglas críticas:

- Un time entry necesita `project`, `entity` (WorkPackage o Meeting) y `activity`.
- **No enviar `_links.user`**: es de solo lectura y provoca 422.
- La actividad se detecta con `/time_entries/form`, no solo con `/time_entries/schema`.
- `Development` no está hardcodeado por ID; se busca por nombre.
- Los proyectos se limitan a `available_projects`.
- Los work packages se filtran por `_links.logTime` cuando existe.
- Duplicados: mismo día y mismo proyecto para el usuario actual.

### Horas de inicio

`startTime` tiene tres modos en `src/config.js`:

- `literal` (por defecto): `08:00` → `08:00Z`.
- `openproject`: convierte a la zona del perfil de OpenProject.
- `browser`: convierte a UTC usando la zona del navegador.

No cambiar el modo por defecto sin probar contra una instancia real. El modo `literal` coincide con las entradas creadas desde la UI en la instancia usada durante el desarrollo.

## Convenciones

- JavaScript ES modules, sin frameworks.
- 2 espacios, comillas dobles, punto y coma.
- UI y mensajes de error en español.
- Funciones exportadas con nombre.
- No usar `innerHTML` para datos de APIs; usar `textContent` o nodos DOM.
- No añadir dependencias si se puede resolver con APIs del navegador.
- No registrar tokens, API keys ni payloads con datos de trabajo en consola.
- Mantener el código y los defaults genéricos: el repo es público.

## Seguridad

- Los tokens nunca viven en `src/config.js` ni en el repo.
- Modo por defecto: `chrome.storage.session`, sin persistencia en disco.
- Modo opcional: caja cifrada en `chrome.storage.local` con AES-GCM/PBKDF2; clave derivada solo en `chrome.storage.session`.
- No crear cifrado falso guardando la clave junto al texto cifrado.
- No commitear `.env`, tokens, API keys ni datos reales.
- `manifest.json` no declara hosts de GitLab/OpenProject; se solicitan en runtime.
- `optional_host_permissions` es amplio (`https://*/*`); cualquier endurecimiento debe probar el flujo de `ensureOriginPermission`.
- `ensureOriginPermission()` debe llamarse dentro del gesto de usuario al guardar ajustes.
- Revisar `SECURITY.md` antes de cambiar permisos, almacenamiento o flujos al LLM.
- No enviar datos de GitLab al LLM sin que el usuario haya configurado explícitamente un endpoint.
- Todo texto que vaya al LLM debe pasar por `redactText()` de `src/redact.js`.
- El filtro tiene dos modos: `redact` y `block`. No eliminarlo ni saltarlo sin revisar `SECURITY.md`.
- El filtro no garantiza detección total; no presentarlo como seguridad absoluta.
- La caja se bloquea a los 15 minutos; no eliminar esa comprobación sin revisar la UX.

## Tests

- Framework: `node:test`, sin dependencias.
- Los tests usan `fetch` mockeado; no llaman a APIs reales.
- Cubrir funciones puras y mapeo de respuestas.
- Añadir test si se cambia:
  - payload de OpenProject;
  - cálculo de horas;
  - filtros de proyectos/work packages;
  - construcción del prompt;
  - cliente LLM.
- No usar tokens reales en tests.

Estado verificado: **36/36 tests pasan**.

## Estado actual y deuda técnica

- Un solo proyecto GitLab por configuración; el modo «Todas las contribuciones» agrega eventos de todos los proyectos sin detalle completo.
- Varios proyectos OpenProject, uno por fichaje.
- En modo semanal, un único tramo horario compartido por todos los días.
- Actividad fija `Development`.
- Sin tests de integración ni E2E con navegador.
- Sin i18n.
- Sin backend ni telemetría.
- Sin actualización automática; los compañeros hacen `git pull` y recargan.
- El repo público puede estar por detrás del working copy local; comprobar `git log` antes de asumir paridad.

## Checklist antes de terminar

1. `npm test` pasa.
2. `node --check` pasa en archivos tocados.
3. No hay tokens ni URLs internas.
4. No se rompió el payload de OpenProject (`user` ausente).
5. El cliente LLM sigue aceptando URL/modelo configurables.
6. README/SECURITY actualizados si cambia el comportamiento.
7. Permisos de `manifest.json` siguen siendo mínimos.
8. No commitear ni pushear salvo petición explícita.

## Git

Repositorio:

```text
https://github.com/rubensr91/fichaje-openproject
```

Licencia MIT. No cambiar la licencia sin decisión del mantenedor.

## Contacto

Para vulnerabilidades, seguir `SECURITY.md`. No abrir issues públicos con detalles explotables.