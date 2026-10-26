# Security Policy

## Estado

`fichaje-openproject` es una extensión de navegador para uso interno. No es una aplicación auditada ni un producto con SLA de seguridad.

Versión soportada: **0.1.x**, preferiblemente la última release o el último commit de `main`.

## Reportar una vulnerabilidad

No abras un issue público con detalles explotables.

Usa **GitHub Security Advisories** del repositorio:

https://github.com/rubensr91/fichaje-openproject/security/advisories/new

Incluye:

- versión de la extensión;
- navegador y versión;
- pasos para reproducir;
- impacto esperado;
- prueba de concepto, si aplica.

No incluyas tokens reales, API keys, datos de clientes ni contenido de repositorios privados. Usa valores ficticios.

Si no puedes usar Security Advisories, contacta con el mantenedor por su perfil de GitHub.

## Alcance

Dentro del alcance:

- manejo de tokens y API keys;
- llamadas a GitLab, OpenProject y al LLM configurado;
- permisos de la extensión;
- inyección de contenido o ejecución de código;
- manipulación del payload de fichaje;
- bypass del control de duplicados.

Fuera del alcance:

- vulnerabilidades de GitLab, OpenProject, el proveedor LLM, Brave/Chrome o el sistema operativo;
- cuentas comprometidas;
- malware o extensiones maliciosas en el mismo perfil del navegador;
- ingeniería social;
- datos que el usuario decida enviar voluntariamente al LLM.

## Modelo de seguridad

### Activos

- Token personal de GitLab.
- Token personal de OpenProject.
- API key del LLM.
- Títulos y mensajes de commits, MRs e issues.
- Resúmenes y fichajes creados en OpenProject.

### Fronteras de confianza

- El perfil del navegador y `chrome.storage.local`.
- Las APIs de GitLab y OpenProject.
- El endpoint LLM configurado por el usuario.
- El repositorio GitHub y el código que cada compañero carga como extensión desempaquetada.

### Permisos

La extensión declara:

- `storage`: guardar configuración y tokens en `chrome.storage.local`.
- `sidePanel`: mostrar la interfaz.
- `optional_host_permissions: ["https://*/*"]`: pedir acceso a las URLs que configure el usuario.

No usa content scripts, `scripting`, `tabs`, `webRequest`, `eval` ni código remoto.

Los permisos de host se solicitan al guardar la configuración. La extensión no recibe acceso a un host hasta que el usuario concede ese origen.

## Flujos de datos

1. **GitLab → extensión**
   - Se leen commits, MRs e issues del proyecto y día seleccionados.
   - El token de GitLab se envía solo a la URL de GitLab configurada.

2. **Extensión → LLM**
   - Si hay LLM configurado, se envían títulos y mensajes de la actividad del día.
   - Los tokens de GitLab y OpenProject no se envían al LLM.
   - La API key del LLM se envía solo al endpoint LLM configurado.

3. **Extensión → OpenProject**
   - Se envía el resumen, el tramo, el proyecto, el work package y la actividad.
   - El token de OpenProject se envía solo a la URL de OpenProject configurada.

4. **Sin telemetría**
   - La extensión no incluye analítica, telemetría ni servidor propio.
   - No se registran tokens en la consola.

## Almacenamiento de secretos

Hay dos modos:

### Solo sesión

- Tokens y API key en `chrome.storage.session`.
- No se escriben en disco.
- Desaparecen al cerrar el navegador.
- Es el modo por defecto.

### Caja cifrada

- Tokens cifrados en `chrome.storage.local`.
- AES-GCM 256.
- Clave derivada de la contraseña con PBKDF2-SHA256 y 600.000 iteraciones.
- Salt e IV aleatorios.
- La clave derivada se guarda solo en `chrome.storage.session`.
- Auto-lock a los 15 minutos.
- Si se pierde la contraseña, los tokens no se pueden recuperar.

En ambos modos:

- No se sincronizan entre dispositivos.
- Cualquier malware con acceso al perfil puede leer los tokens mientras estén disponibles.
- No usar en equipos compartidos ni en perfiles sin protección.
- El cifrado protege el archivo en reposo, no un navegador comprometido o desbloqueado.

## Riesgos conocidos

### Tokens en el navegador

Un token comprometido permite actuar como el usuario dentro de sus permisos:

- GitLab `read_api`: leer repositorios, MRs e issues accesibles.
- OpenProject **Log time**: crear fichajes y leer datos permitidos.

Recomendaciones:

- usar tokens con caducidad;
- usar el mínimo scope posible;
- revocar tokens que se hayan pegado en chats, issues o logs;
- no compartir tokens entre compañeros.

### Permiso opcional amplio

`optional_host_permissions` permite solicitar cualquier origen HTTPS. En uso normal solo se solicitan las URLs configuradas, pero un revisor de seguridad puede considerarlo amplio. Para una distribución corporativa, valora limitar los orígenes permitidos.

### LLM externo

Los datos enviados al LLM pueden contener información interna o secretos accidentales en mensajes de commit. Antes de usarlo:

- revisa la política de empresa;
- usa un proveedor aprobado;
- evita repositorios con secretos en commits;
- considera un modelo local o el resumen local sin LLM.

### Filtro pre-LLM

Antes de llamar al LLM, `src/redact.js` busca patrones conocidos:

- tokens de GitLab, OpenProject, GitHub y AWS;
- claves de Google/OpenAI y similares;
- JWT y claves privadas;
- cabeceras `Authorization`/`Bearer`;
- URLs con credenciales;
- asignaciones `password=`, `token=`, `secret=`, etc.

Modos:

- **Redactar**: sustituye por `[REDACTED:...]` y avisa.
- **Bloquear**: no envía nada al LLM y usa el resumen local.

Límites:

- es un filtro por expresiones regulares, no un analizador semántico;
- no garantiza detectar secretos con formatos desconocidos;
- no sustituye la revisión humana ni la política de datos de la empresa;
- el resumen local puede seguir mostrando el texto original en la UI.

### OpenProject

El token puede escribir fichajes. La extensión comprueba duplicados por día y proyecto, pero no sustituye una revisión humana. Revisa los fichajes antes de usarlos en producción.

### Cadena de suministro

El repositorio es público y la extensión se carga desempaquetada. Un cambio malicioso en el código se ejecutaría con los permisos concedidos.

Recomendaciones:

- proteger `main` con revisión obligatoria;
- usar releases o tags;
- revisar cambios antes de actualizar;
- no instalar desde forks no confiables.

## Recomendaciones de despliegue

- Usar un perfil de navegador dedicado.
- Bloquear el equipo y usar cifrado de disco.
- Instalar solo desde el repositorio oficial.
- Revisar los permisos solicitados.
- Probar primero en un proyecto de pruebas.
- Auditar los fichajes creados.
- Revocar tokens al dejar de usar la extensión.

## Respuesta a incidentes

Si sospechas que un token se ha filtrado:

1. Revócalo en GitLab u OpenProject.
2. Genera uno nuevo con permisos mínimos.
3. Revoca la API key del LLM si procede.
4. Revisa actividad reciente en GitLab, OpenProject y el proveedor LLM.
5. Elimina la extensión del navegador si el equipo puede estar comprometido.
6. Cambia la contraseña si el perfil del navegador se ha visto afectado.

## Desarrollo seguro

- No se aceptan tokens, claves ni datos reales en el repositorio.
- Los tests no llaman a APIs reales.
- No hay dependencias de runtime.
- CI ejecuta `npm test`.
- Los cambios deben revisarse antes de merge.

## Licencia

MIT. Consulta [LICENSE](LICENSE).

Última actualización: 2026-10-26.