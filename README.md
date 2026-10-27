# Fichaje GitLab → OpenProject

[![tests](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml/badge.svg)](https://github.com/rubensr91/fichaje-openproject/actions/workflows/test.yml)

Extensión de navegador para:

1. leer la actividad del día en un proyecto GitLab;
2. generar un resumen con un LLM;
3. revisarlo;
4. crear un fichaje en OpenProject.

Pensada para Chrome/Brave, sin backend y sin build.

## Flujo

```mermaid
flowchart LR
    EXT["Extensión MV3<br/>(panel + service worker)"]
    OP[("OpenProject<br/>API v3")]
    GL[("GitLab<br/>API v4")]
    RED["Filtro de secretos<br/>redact / block"]
    LLM[["LLM compatible<br/>OpenAI Chat Completions"]]

    OP -- "1 · proyectos, tareas y fichajes ya hechos<br/>GET /time_entries" --> EXT
    EXT -- "2 · actividad solo de los días sin fichar<br/>commits, MRs, issues, comentarios" --> GL
    GL -- "3 · evidencia por día" --> EXT
    EXT -- "4 · texto de evidencia" --> RED
    RED -- "5 · texto limpio" --> LLM
    LLM -- "6 · resumen editable" --> EXT
    EXT -- "7 · POST /time_entries<br/>una línea por tarea" --> OP
```

Pasos:

1. Se leen de OpenProject los proyectos/tareas disponibles y los fichajes ya existentes del rango.
2. Con eso se filtran los días: los ya fichados **no** se piden a GitLab ni se envían al LLM (ahorro de tokens).
3. GitLab aporta la actividad (commits, MRs, issues, comentarios) del usuario, de uno o de todos los proyectos.
4. Antes de llamar al LLM, el texto pasa por un filtro de secretos que redacta o bloquea.
5. El LLM devuelve un resumen por día; se puede editar y dividir en varias tareas.
6. Con la confirmación, la extensión inyecta los resúmenes en OpenProject como time entries, con su proyecto, tarea, tramo horario y hora de inicio.

## Estado

MVP, versión `0.1.31`. No incluye tokens ni claves. La configuración no secreta se guarda en `chrome.storage.local`; los tokens viven en memoria de sesión o en una caja cifrada opcional.

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
- Origen de actividad: dos modos.
  - **Todas las contribuciones** (por defecto): sin indicar proyecto, usa los eventos de tu usuario de GitLab (`GET /api/v4/events`) para descubrir en qué proyectos hubo actividad cada día y, para cada uno, pide el **detalle completo** (commits completos, MRs con descripción, issues). También recoge comentarios y MRs cerradas o fusionadas por ti aunque las creara otra persona. El resumen se **agrupa por proyecto**. Si algún proyecto no está accesible, se avisa y se usan solo sus eventos.
  - **Proyecto concreto**: lee commits, MRs e issues del proyecto indicado, con detalle completo (descripciones, todos los commits de cada push).
- Proyecto: `grupo/proyecto`. Solo obligatorio en el modo de proyecto concreto.
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

### Líneas dentro de un día

Tanto en **Diario** como en **Rango**, cada día es una tarjeta que puede dividirse en **varias líneas de fichaje**. Pulsa **+ Añadir tarea** para crear otra entrada en el mismo día. Cada línea tiene:

- su **tramo horario** (inicio y fin propios);
- su **proyecto de OpenProject** y su **tarea** (work package);
- su **campo de texto** para el resumen.

El resumen generado por el LLM rellena la **primera línea**; las demás empiezan vacías para que copies, pegues o escribas tú mismo. Al generar se consulta **primero OpenProject**: los días ya fichados no se leen de GitLab ni se envían al LLM, así que no se gastan tokens en ellos. El botón **+ Añadir tarea** está siempre disponible. La casilla de la primera línea dice **Fichar este día**; las líneas añadidas dicen **Fichar esta tarea**.

En el modo «Todas las contribuciones», cada commit, MR o issue viaja con su **proyecto de GitLab** (campo `project` en la evidencia y prefijo `[grupo/proyecto]` en el texto que recibe el LLM), así que el resumen siempre indica en qué proyecto se trabajó ese día. La etiqueta genérica «Todas las contribuciones» ya no aparece en los resúmenes.

Política de duplicados (consumir existentes): si OpenProject ya tiene un fichaje para ese día y proyecto, la primera línea de ese par aparece marcada como existente y se omite al fichar. Las líneas **añadidas a propósito** se crean aunque exista un fichaje previo en el mismo proyecto y día — úsalo para repartir horas entre varias tareas del mismo proyecto.

### Modo rango (varios días)

Además del modo diario, la extensión tiene un modo **Rango**:

1. Cambia el interruptor a **Rango**.
2. Elige el rango de días (por defecto, lunes a viernes de la semana actual; máximo 31 días).
3. Pulsa **Generar resúmenes**.
4. La extensión lee GitLab para cada día, pide un resumen al LLM día a día y muestra una tarjeta por día.
5. Revisa y edita cada resumen, ajusta el **tramo horario**, el **proyecto** y la **tarea** de cada día, y marca o desmarca los días a fichar.
6. Pulsa **Fichar** y confirma una vez con el listado de días con sus horas.

Detalles:

- Cada línea tiene su **tramo horario** (inicio y fin), su **proyecto de OpenProject** y su **tarea** (work package), cada uno en su propia fila. Bajo el selector de tarea hay un **buscador**: filtra por código, asunto, estado o tipo, y si el texto coincide exactamente con el código (`1234` o `#1234`) o el nombre de la tarea, la **autoselecciona**. El tramo global, el proyecto global y la tarea global actúan solo como valor inicial; si los cambias después, se propagarán a las líneas que no hayas editado a mano.
- Puedes **dividir el día en varias líneas** con **+ Añadir tarea**: cada una con su tramo, proyecto, tarea y resumen. Ver [Líneas dentro de un día](#líneas-dentro-de-un-día).
- Los días sin actividad en GitLab quedan **desmarcados** por defecto (con su texto local); puedes marcarlos y editar el texto a mano.
- Los días que ya tienen un fichaje en ese proyecto muestran la primera línea como **existente (desmarcado)** y se omiten al fichar; las líneas añadidas a propósito sí se crean. La comprobación consulta los fichajes uno por día (el filtro por rango no es compatible con todas las instancias de OpenProject), así que detecta todos los días fichados del rango. La tarjeta del día muestra esos fichajes ya hechos en un bloque **Ya fichado en OpenProject** con proyecto, tarea, horas totales y **hora de inicio y fin** de cada entrada (más su resumen y su ID). Se muestran **todas** las entradas del día, también las de otros proyectos de OpenProject; el bloqueo automático de la primera línea solo se aplica al proyecto seleccionado. El fin se calcula sumando la duración al `startTime` y ambas horas se muestran en la zona horaria del navegador. En rangos largos hay más peticiones a OpenProject, algo más lentas de generar.
- Un tramo invertido (fin ≤ inicio) o una línea sin tarea seleccionada invalida esa línea y no se ficha; el aviso aparece en la tarjeta.
- Si alguna línea falla al crear, el resto sigue; el error se muestra en su tarjeta y puedes volver a intentarla.

## Uso

1. Elige el modo: diario o rango.
2. Elige el día (o el rango de días).
3. Ajusta inicio y fin (luego puedes ajustarlos por día o por línea).
4. Elige el proyecto de OpenProject y el work package.
5. Pulsa **Generar resumen** (o **Generar resúmenes**).
6. Revisa y edita el texto. Si quieres dividir el día en varias tareas, pulsa **+ Añadir tarea** y rellena tramo, proyecto, tarea y resumen de cada línea.
7. Pulsa **Fichar**.
8. Confirma.

Los proyectos salen de `GET /api/v3/time_entries/available_projects`, es decir, solo aquellos en los que puedes fichar. Los work packages se cargan al elegir proyecto y se filtran por permiso de fichaje. En el desplegable aparecen como `#1234 · Tarea de ejemplo [In progress]`. El campo **Buscar tarea** filtra por código, asunto, estado o tipo.

La app comprueba si ya existe un fichaje para ese día y proyecto antes de crear otro. Con varias líneas en el mismo día, el primer fichaje previo de cada par (día, proyecto) se consume: las líneas extra que añadas a propósito sí se crean.

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

- Una sola instancia GitLab por configuración (el modo «Todas las contribuciones» lee todos sus proyectos).
- Varios proyectos OpenProject; cada línea de fichaje (día + tramo) apunta a uno de ellos.
- En modo rango, el proyecto, la tarea y el tramo horario son configurables por línea (los selectores globales inicializan las líneas que no hayas tocado).
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