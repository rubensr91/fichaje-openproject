# Fichaje GitLab → OpenProject

[![tests](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml/badge.svg)](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml)

Extensión de navegador para:

1. leer la actividad del día en un proyecto GitLab;
2. generar un resumen con un LLM;
3. revisarlo;
4. crear un fichaje en OpenProject.

Pensada para Chrome/Brave, sin backend y sin build.

## Estado

MVP, versión `0.1.7`. No incluye tokens ni claves. La configuración se guarda en `chrome.storage.local`.

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

### Resumen: Gemini / Qwen

Proveedor por defecto: **Gemini**.

#### Gemini

- URL base: `https://generativelanguage.googleapis.com/v1beta`
- Modelo: `gemini-3.1-flash`
- API key de Google AI Studio / Gemini API.

La API de Gemini es stateless: no puede leer la conversación de la app de Gemini. Para imitar estilo, hay que enviar ejemplos en el prompt. La extensión todavía no tiene campo de ejemplos.

#### Qwen

Alternativa configurable:

- URL base Token Plan (Singapur):
  `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
- Modelo: `qwen3.6-flash`
- API key de Alibaba Model Studio Token Plan (`sk-sp-...`).

Token Plan está pensado para herramientas interactivas. Si la empresa lo considera backend, habría que usar una API key pay-as-you-go y el endpoint DashScope correspondiente.

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

- **Literal** (recomendado en esta instancia): `08:00` se envía como `08:00Z`, igual que las entradas creadas desde la UI.
- **Zona OpenProject**: convierte `08:00` a la zona del perfil de OpenProject.
- **Zona navegador**: convierte `08:00` a UTC usando la zona del navegador.

Si la hora sale desplazada, cambia de modo y prueba. La fecha del fichaje es `spentOn`.

## Compartir con compañeros

1. Repositorio: `https://github.com/rubensr91/fichaje-openproject`.
2. Cada compañero clona el repo y carga la carpeta como extensión descomprimida.
3. Cada uno mete sus propios tokens y su API key en ajustes.
4. No compartas una copia con `chrome.storage.local` ni con tokens dentro.
5. Las URLs y proyectos internos no están en el código; se configuran en la extensión.

## Privacidad

- GitLab: se envían títulos y mensajes de commits, MRs e issues.
- Gemini: el resumen se genera enviando esos datos a Google.
- Qwen: alternativa que envía esos datos a Alibaba.
- OpenProject: solo se envía el resumen y las horas.

Revisa la política de empresa antes de usar un LLM externo con datos de repositorios privados.

## Seguridad

- Los tokens se guardan solo en `storage.local` de la extensión.
- No se envían a GitLab, OpenProject ni al LLM.
- No subas tokens al repositorio.
- Si un token se pega en un chat, considéralo comprometido y revócalo.
- La API key de Gemini se envía únicamente a Google; la de Qwen, únicamente a Alibaba.

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
- `icons/`: iconos de la extensión.
- `background.js`: router de mensajes y llamadas a APIs.
- `sidepanel.html/css/js`: interfaz.
- `src/gitlab.js`: commits, MRs e issues.
- `src/openproject.js`: usuario, proyecto, WP, actividades, duplicados y creación.
- `src/llm.js`: selector Gemini/Qwen.
- `src/gemini.js`: resumen con Gemini.
- `src/qwen.js`: resumen con Qwen.
- `src/summary.js`: resumen local y prompt.
- `src/time.js`: tramos, duraciones y fechas.
- `src/http.js`: fetch con timeout y errores.
- `src/config.js`: configuración y valores por defecto.

## Licencia

MIT. Consulta [LICENSE](LICENSE).