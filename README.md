# Fichaje GitLab → OpenProject

[![tests](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml/badge.svg)](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml)

Extensión de navegador para:

1. leer la actividad del día en un proyecto GitLab;
2. generar un resumen con un LLM;
3. revisarlo;
4. crear un fichaje en OpenProject.

Pensada para Chrome/Brave, sin backend y sin build.

## Estado

MVP, versión `0.1.13`. No incluye tokens ni claves. La configuración no secreta se guarda en `chrome.storage.local`; los tokens viven en memoria de sesión o en una caja cifrada opcional.

Repositorio público con configuración genérica: cada usuario introduce su URL de GitLab/OpenProject y sus tokens en ajustes. No hay URLs internas ni credenciales en el código.

## Instalación

1. Clona o descarga el repositorio:

```bash
git clone https://github.com/rubensr91/fichaje-openproject.git
```

2. Abre `chrome://extensions` o `brave://extensions`.
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida**.
5. Selecciona la carpeta del repositorio, la que contiene `manifest.json`.
6. Pulsa el icono de la extensión. Se abre el panel lateral o una pestaña.

Si Brave no soporta `sidePanel`, la extensión abre `sidepanel.html` como pestaña.

## Configuración

### GitLab

- URL base: `https://gitlab.example.com` (la de tu instancia)
- Proyecto: `grupo/proyecto`
- Token personal con scope **`read_api`** (o `api`). `read_user` solo no permite leer commits, MRs ni issues.
- Autor GitLab: opcional. Si lo dejas vacío se intenta usar el nombre/email de la cuenta. Si no coincide con el autor de los commits, se incluyen todos los commits del proyecto y se avisa.

### OpenProject

- URL base: `https://openproject.example.com` (la de tu instancia)
- Proyecto: se elige desde la extensión.
- Work package: se elige desde la extensión.
- Actividad: `Development`.
- Token personal con permiso **Log time**.

OpenProject exige un work package. No se puede fichar solo contra el proyecto.

Al abrir la extensión se cargan los proyectos disponibles para tu usuario. Después eliges el work package con el buscador.

### Resumen con LLM

El resumen se genera con cualquier endpoint compatible con **OpenAI Chat Completions**. Cada usuario puede cambiar proveedor, modelo y API key en los ajustes de la extensión.

Valores por defecto:

- **URL base**: `https://generativelanguage.googleapis.com/v1beta/openai`
- **Modelo**: `gemini-3.1-flash-lite`
- **API key**: vacía; hay que introducir la de la cuenta.

Si se deja sin API key, la extensión usa el resumen local determinista y no envía datos a ningún LLM.

La API del LLM es stateless: no puede leer conversaciones existentes de la interfaz web del proveedor. Para imitar un estilo, hay que añadir ejemplos en el prompt. La extensión todavía no tiene campo de ejemplos.

### Filtro antes del LLM

Antes de enviar actividad al LLM, la extensión pasa el texto por un filtro de secretos:

- tokens de GitLab/OpenProject;
- claves de Google, OpenAI y otros proveedores;
- tokens de GitHub;
- claves AWS;
- JWT;
- claves privadas;
- cabeceras `Authorization`/`Bearer`;
- URLs con usuario y contraseña;
- asignaciones tipo `password=`, `token=`, `secret=`, etc.

Modos:

- **Redactar y avisar**: sustituye lo detectado por `[REDACTED:...]` y muestra un aviso.
- **Bloquear envío**: si detecta algo, no llama al LLM y usa el resumen local.

El filtro reduce el riesgo, pero **no garantiza** detectar cualquier secreto. Un secreto con formato desconocido puede pasar. Para repositorios sensibles, usa el resumen local o un LLM aprobado.

### Jornada

- Inicio por defecto: `08:00`
- Fin por defecto: `15:15`
- Total: `7h15m`

El tramo se puede cambiar antes de generar el resumen.

## Uso

1. Elige el día.
2. Ajusta inicio y fin.
3. Elige el proyecto de OpenProject y el work package.
4. Pulsa **Generar resumen**.
5. Revisa y edita el texto.
6. Pulsa **Fichar**.
7. Confirma.

Los proyectos salen de `GET /api/v3/time_entries/available_projects`, es decir, solo aquellos en los que puedes fichar. Los work packages se cargan al elegir proyecto y se filtran por permiso de fichaje. En el desplegable aparecen como `#1234 · Tarea de ejemplo [In progress]`. El campo **Buscar tarea** filtra por código, asunto, estado o tipo.

La app comprueba si ya existe un fichaje para ese día y proyecto antes de crear otro.

## OpenProject: horas de inicio

La opción **Enviar hora de inicio a OpenProject** está activada por defecto. Si tu instancia no permite registrar inicio/fin, desactívala: se enviarán solo las horas.

OpenProject recibe `startTime` como instante UTC. La extensión tiene tres modos:

- **Zona navegador** (recomendado): convierte `08:00` a UTC usando la zona del navegador.
- **Zona OpenProject**: convierte `08:00` a la zona del perfil de OpenProject.
- **Literal**: `08:00` se envía como `08:00Z`.

Si la hora sale desplazada, cambia de modo y prueba. La fecha del fichaje es `spentOn`.

## Compartir con compañeros

1. Repositorio: `https://github.com/rubensr91/fichaje-openproject`.
2. Cada compañero clona el repo y carga la carpeta como extensión descomprimida.
3. Cada uno mete sus propios tokens y su API key en ajustes.
4. No compartas una copia con `chrome.storage.local` ni con tokens dentro.
5. Las URLs y proyectos internos no están en el código; se configuran en la extensión.

## Privacidad

- GitLab: se envían títulos y mensajes de commits, MRs e issues.
- LLM: si se configura, el resumen se genera enviando esos datos al proveedor elegido.
- OpenProject: solo se envía el resumen y las horas.

Revisa la política de empresa antes de usar un LLM externo con datos de repositorios privados.

## Seguridad

Consulta [SECURITY.md](SECURITY.md) para el modelo de amenazas y cómo reportar vulnerabilidades.

- Por defecto, los tokens se guardan solo en `chrome.storage.session` y desaparecen al cerrar el navegador.
- Opcionalmente, se pueden guardar en una caja cifrada con AES-GCM y contraseña.
- No se envían a GitLab, OpenProject ni al LLM.
- No subas tokens al repositorio.
- Si un token se pega en un chat, considéralo comprometido y revócalo.
- La API key del LLM se envía únicamente al endpoint configurado por el usuario.

### Modos de tokens

En **Ajustes → Seguridad de tokens**:

- **Solo esta sesión** (por defecto): tokens en memoria; se pierden al cerrar Brave.
- **Caja cifrada**: tokens cifrados en disco; se piden contraseña al abrir el navegador.
- La caja se bloquea automáticamente a los 15 minutos.
- Si olvidas la contraseña, no se pueden recuperar los tokens: usa **Olvidar tokens** y vuelve a configurarlos.

## Limitaciones actuales

- Un solo proyecto GitLab.
- Varios proyectos OpenProject, pero solo uno por fichaje.
- Un solo tramo por fichaje.
- La actividad está fijada a `Development`.
- La detección de autoría de commits puede requerir configurar `Autor GitLab`.
- No hay tests de integración contra GitLab/OpenProject.
- La creación real ya se ha probado, pero conviene validar cada cambio en un proyecto de pruebas.

## Tests

```bash
cd fichaje-extension
npm test
```

## Estructura

- `manifest.json`: permisos, panel lateral, service worker e iconos.
- `AGENTS.md`: guía para agentes y colaboradores técnicos.
- `SECURITY.md`: modelo de amenazas y reporte de vulnerabilidades.
- `icons/`: iconos de la extensión.
- `background.js`: router de mensajes y llamadas a APIs.
- `sidepanel.html/css/js`: interfaz.
- `src/gitlab.js`: commits, MRs e issues.
- `src/openproject.js`: usuario, proyecto, WP, actividades, duplicados y creación.
- `src/llm.js`: cliente LLM compatible con OpenAI Chat Completions.
- `src/summary.js`: resumen local y prompt.
- `src/time.js`: tramos, duraciones y fechas.
- `src/http.js`: fetch con timeout y errores.
- `src/config.js`: configuración y valores por defecto.

## Licencia

MIT. Consulta [LICENSE](LICENSE).