# Stream de Cámara en Vivo — Guía Completa de Implementación

**Fecha:** 2026-06-06  
**Estado:** Funcionando en producción local  
**Cámara de referencia:** Dahua 4MP · IP `192.168.1.100` · Canal SDK 1  
**Criticidad:** MÁXIMA — sin streaming las cámaras no se ven, el sistema no funciona

---

## Resumen ejecutivo

El streaming de cámaras en vivo en el cliente Electron requiere que **seis sistemas trabajen en cadena sin fallo**. Cualquier rotura en la cadena produce pantalla negra o "Error stream" sin mensaje claro. Este documento registra cada bloqueo encontrado, su causa raíz, y la solución exacta aplicada.

Flujo completo de datos:
```
Cámara IP (RTSP)
  → SDK relay_manager (ffmpeg → MPEGTS pipe)
    → GET /stream/play/{channel}  (Bearer JWT + x-api-key)
      → mpegts.js (remux MPEGTS → fMP4)
        → MSE SourceBuffer
          → <video> en ViewGroup
```

---

## Arquitectura del sistema de streaming

### Proceso main (Node.js / Electron)
- Lee el API key del SDK desde `karenvision/api/keys/api_keys.json`
- Llama `POST /play/live/ui` con el API key para obtener el JWT de stream
- Retorna `{ ok, token, api_key, play_url }` al renderer vía IPC `kv:stream:token`

### Renderer (Chromium)
- `app-controller.js` → `_mountViewGroup()` monta el ViewGroup con la cámara demo
- `view-group.js` → `_attachCameraStreams()` pide token por IPC y llama `startStream()`
- `stream-service.js` → usa `mpegts.js` para conectar al stream HTTP y alimentar MSE

### SDK (Python / FastAPI)
- `POST /play/live/ui` — genera JWT de stream para los canales del grupo (requiere `x-api-key`)
- `GET /stream/play/{channel}` — stream MPEGTS en vivo (requiere `x-api-key` + `Authorization: Bearer {jwt}`)
- `relay_manager` — lee `cameras.json` y lanza ffmpeg contra la cámara RTSP

---

## Paso 1 — Registrar la cámara en el SDK

### Por qué es necesario
El `relay_manager` del SDK lee las cámaras desde `data/configs/cameras.json`, **no** desde la base de datos SQLite. Si este archivo no existe o no contiene el canal, el endpoint `/stream/play/{channel}` retorna `channel_not_found`.

El endpoint `POST /camera/add` intenta validar la cámara y cifrar la contraseña con `KARENVISION_DB_SECRET_KEY`. En modo `developer` sin esa variable, el cifrado falla con `DbSecretMissingError`. Por eso el registro se hace **directamente en los archivos**.

### Archivo: `data/configs/cameras.json`
Crear o editar con el canal de la cámara:

```json
[
  {
    "channel": 1,
    "camera_id": "channel_1",
    "brand": "dahua",
    "ip": "192.168.1.100",
    "user": "admin",
    "password": "tu_password",
    "rtsp_port": 554,
    "enabled": true
  }
]
```

**CRÍTICO:** El campo es `user`, no `username`. La contraseña va en texto plano en este archivo; el relay_manager la usa para construir la URL RTSP directamente.

**RTSP URL que construye el SDK internamente:**
```
rtsp://admin:tu_password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0
```
El path `/cam/realmonitor?channel=1&subtype=0` es el default para brand `dahua` en `karenvision/engine/rtsp.py → default_rtsp_path_for()`.

### Base de datos SQLite: `data/core.db`
La tabla `cameras` también debe tener el canal registrado (algunos servicios la consultan). En modo developer, si `password_enc` es NULL y `password` tiene texto plano, el sistema lo acepta sin cifrado:

```python
import sqlite3
from datetime import datetime, timezone

conn = sqlite3.connect('/opt/karenvision_sdk/data/core.db')
now = datetime.now(timezone.utc).isoformat()

conn.execute("""
  INSERT OR REPLACE INTO cameras
  (channel, camera_id, brand, ip, username, password, rtsp_port, enabled, status, version, updated_at)
  VALUES (1, 'channel_1', 'dahua', '192.168.1.100', 'admin', 'tu_password', 554, 1, 'ACTIVE', 1, ?)
""", (now,))
conn.commit()
conn.close()
```

---

## Paso 2 — Crear el grupo en el SDK

### Por qué es necesario
`POST /play/live/ui` requiere un nombre de grupo (`group`). El grupo define qué canales se incluyen en el contrato y genera los JWT de stream para cada uno. Sin un grupo con el canal 1, la respuesta es `GROUP.GRID.NOT_FOUND`.

El cliente Electron en modo demo usa `group = state.selectedGroup || "default"`.

### Insertar grupo "default" en SQLite

```python
import sqlite3
from datetime import datetime, timezone

conn = sqlite3.connect('/opt/karenvision_sdk/data/core.db')
now = datetime.now(timezone.utc).isoformat()

conn.execute("""
  INSERT OR IGNORE INTO groups (name, title, description, created_at, updated_at, grid_layout)
  VALUES ('default', 'Default', 'Grupo por defecto', ?, ?, '1x1')
""", (now, now))

group_id = conn.execute("SELECT id FROM groups WHERE name='default'").fetchone()[0]

conn.execute("""
  INSERT OR IGNORE INTO group_channels (group_id, channel, position)
  VALUES (?, 1, 1)
""", (group_id,))

conn.commit()
conn.close()
```

### Verificar que funciona

```bash
API_KEY="kv_tu_api_key_aqui"

curl -s -X POST http://127.0.0.1:2030/play/live/ui \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-sender-type: ui" \
  -H "x-sender-id: electron-client" \
  -d '{"group": "default"}'
```

Respuesta esperada: `{ "streams": [{ "channel": 1, "token": "eyJ...", "expires_in": 60 }] }`

---

## Paso 3 — Agregar CORS al SDK

### Por qué es necesario
El renderer de Electron se carga desde `file://`. Cuando `mpegts.js` intenta hacer `fetch()` a `http://127.0.0.1:2030/stream/play/1` con headers custom (`Authorization`, `x-api-key`, etc.), el navegador Chromium envía una preflight `OPTIONS`. Sin CORS, el SDK retorna **405 Method Not Allowed** y el fetch es bloqueado antes de llegar al servidor.

### Archivo modificado: `karenvision/api/main.py`

```python
from fastapi.middleware.cors import CORSMiddleware

# Agregar después de: install_exception_handlers(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["authorization", "x-api-key", "x-sender-type", "x-sender-id",
                   "x-view-session", "content-type"],
    expose_headers=["x-stream-channel", "x-stream-expires-in"],
    max_age=86400,
)
```

**CRÍTICO:** El SDK corre como servicio systemd (`karenvision-api.service`). Después de editar `main.py` hay que reiniciar:

```bash
systemctl restart karenvision-api.service
```

Verificar que OPTIONS responde 200:
```bash
curl -X OPTIONS http://127.0.0.1:2030/stream/play/1 \
  -H "Origin: null" \
  -H "Access-Control-Request-Headers: authorization,x-api-key" \
  -o /dev/null -w "%{http_code}"
# Esperado: 200
```

---

## Paso 4 — Flujo de autenticación sin sesión de view

### El problema
El cliente Electron no tiene un flujo de login visible. El método `boot()` arranca directo al dashboard (`forceUiOnlyLocal: true`), por lo que `runtimeState.session` queda null. Sin sesión, `callViewApi("/view/state")` retorna `not_logged_in` y no se pueden obtener tokens de stream.

### La solución: Path B en `kv:stream:token`
El proceso main lee el API key del SDK (que tiene scope `stream.read`) y llama directamente a `POST /play/live/ui`. El token obtenido se retorna al renderer junto con el API key para que pueda autenticar el fetch del stream.

**Archivo:** `main/ipc/kv-ipc.js`

```javascript
// Lee el API key del archivo de claves del SDK
function _resolveApiKey() {
  const envKey = String(process.env.KV_API_KEY || "").trim();
  if (envKey) return envKey;

  const sdkRoot = String(process.env.KV_SDK_ROOT || "").trim() || "/opt/karenvision_sdk";
  const keysPath = path.join(sdkRoot, "karenvision", "api", "keys", "api_keys.json");
  try {
    const data = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    const keys = Array.isArray(data && data.keys) ? data.keys : [];
    const active = keys.find((k) => k.active && k.key);
    return active ? String(active.key) : null;
  } catch (_) {
    return null;
  }
}
```

En el handler `kv:stream:token`:
- **Path A** (sesión activa): llama `/view/state` con `x-view-session`
- **Path B** (sin sesión): llama `POST /play/live/ui` con API key → retorna `{ ok, token, api_key, play_url }`

El `api_key` viaja en la respuesta IPC porque el endpoint `/stream/play/{channel}` requiere **ambas** credenciales: Bearer JWT + x-api-key.

**Variables de entorno alternativas:**
- `KV_API_KEY` — key directa, evita leer el archivo
- `KV_SDK_ROOT` — path al SDK si no está en `/opt/karenvision_sdk`

---

## Paso 5 — Usar mpegts.js en lugar de MSE nativo

### Por qué no funciona MSE nativo con `video/mp2t`
Electron 31 (Chromium 126) no incluye soporte de `video/mp2t` en `MediaSource` en la mayoría de builds de Linux. `MediaSource.isTypeSupported('video/mp2t')` retorna `false`.

### La solución: mpegts.js
`mpegts.js` remuxea MPEGTS a **fMP4 (fragmented MP4)** antes de alimentar el SourceBuffer, usando el codec `video/mp4;codecs=avc1.XXXXXX` que sí está soportado universalmente en Chromium.

#### Instalación
```bash
cd /opt/karenvision_sdk/external_clients/karenvision-electron-client
npm install mpegts.js --save
cp node_modules/mpegts.js/dist/mpegts.js renderer/vendor/mpegts.js
```

#### `renderer/index.html` — agregar antes del bootstrap
```html
<script src="./vendor/mpegts.js"></script>
```

---

## Paso 6 — CSP: permitir `blob:` para MSE

### Por qué es necesario
`mpegts.js` crea un `MediaSource` y lo asigna como `videoEl.src = URL.createObjectURL(mediaSource)`. Esta URL es del tipo `blob:file:///...`. El CSP original tenía `default-src 'self'` sin `media-src` explícito, lo que hace que `blob:` sea bloqueado para media.

**Error en consola:**
```
Refused to load media from 'blob:file:///...' because it violates the Content Security Policy
directive: "default-src 'self'". Note that 'media-src' was not explicitly set.
```

### Archivo: `renderer/index.html`

```html
<meta http-equiv="Content-Security-Policy" content="
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src http://127.0.0.1:2030 http://localhost:2030;
media-src blob: 'self';
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
">
```

La línea añadida es `media-src blob: 'self';`.

---

## Paso 7 — Headers de auth en mpegts.js: segundo parámetro

### El bug silencioso
`mpegts.createPlayer()` acepta headers en dos lugares:
- **Primer parámetro** (MediaDataSource): usado por el loader XHR
- **Segundo parámetro** (config): usado por el `FetchStreamLoader`

Para streams en vivo (`isLive: true`), `mpegts.js` usa `FetchStreamLoader`. Los headers del primer parámetro **no son aplicados** por este loader. El resultado: las requests llegan al SDK sin `Authorization` ni `x-api-key` → **HTTP 403 Forbidden**.

**Error en consola:**
```
[IOController] > Loader error, code = 403, msg = Forbidden
```

### La corrección: headers en el segundo parámetro

```javascript
player = window.mpegts.createPlayer(
  {
    type:            "mpegts",
    isLive:          true,
    url,
    withCredentials: false,
    // NO poner headers aquí para live streams
  },
  {
    headers: {               // ← AQUÍ van los headers para FetchStreamLoader
      "Authorization":    `Bearer ${token}`,
      "x-api-key":        apiKey,
      "x-sender-type":    "ui",
      "x-sender-id":      "electron-client"
    },
    enableWorker:                  false,
    liveBufferLatencyChasing:      true,
    liveBufferLatencyMaxLatency:   1.7,
    liveBufferLatencyMinRemain:    0.1,
    // ...
  }
);
```

---

## Resumen de todos los bloqueos encontrados

| # | Síntoma visible | Causa raíz | Solución |
|---|---|---|---|
| 1 | "Codec no soportado" | `video/mp2t` no soportado en MSE de Chromium 126 | Instalar `mpegts.js` que remuxea a fMP4 |
| 2 | "Error stream" (sin fetch al SDK) | `blob:` URLs bloqueadas por CSP | Añadir `media-src blob: 'self'` al index.html |
| 3 | "Error stream" + OPTIONS 405 en logs | Sin CORS: preflight rechazado por SDK | `CORSMiddleware` en `karenvision/api/main.py` |
| 4 | "Error stream" + OPTIONS 200 pero sin GET | API key no llegaba al FetchStreamLoader | Mover headers al segundo param de `createPlayer` |
| 5 | HTTP 403 en stream | Sin sesión de view → no había token | Path B en `kv:stream:token`: usa API key para `/play/live/ui` |
| 6 | `channel_not_in_contract` | Cámara no registrada en `cameras.json` | Crear `data/configs/cameras.json` con el canal 1 |
| 7 | `GROUP.GRID.NOT_FOUND` | Grupo "default" no existía en SQLite | INSERT en `groups` + `group_channels` |

---

## Archivos modificados — tabla completa

| Archivo | Tipo de cambio | Descripción |
|---|---|---|
| `data/configs/cameras.json` | **CREADO** | Registro de cámara Dahua canal 1 para relay_manager |
| `data/core.db` | **DATO INSERTADO** | Grupo "default" + canal 1 en SQLite |
| `karenvision/api/main.py` | **MODIFICADO** | `CORSMiddleware` para preflight desde renderer |
| `main/ipc/kv-ipc.js` | **MODIFICADO** | `_resolveApiKey()` + Path B con `/play/live/ui` + `api_key` en respuesta |
| `renderer/index.html` | **MODIFICADO** | `media-src blob: 'self'` en CSP + `<script mpegts.js>` |
| `renderer/vendor/mpegts.js` | **CREADO** | Build de mpegts.js 1.8.0 para acceso sin bundler |
| `renderer/services/stream-service.js` | **REESCRITO** | Reemplaza MSE manual por mpegts.js con auth headers |
| `renderer/components/view-group/view-group.js` | **MODIFICADO** | Pasa `api_key` a `startStream`; usa evento `playing` para badge |
| `renderer/app/app-controller.js` | **MODIFICADO** | `getStreamToken` siempre usa IPC (elimina fast-path sin api_key) |
| `main/bootstrap.js` | **MODIFICADO** | Forwarding de console del renderer al main (debug) |
| `main/windows/viewer-window.js` | **MODIFICADO** | `openDevTools` en modo detach (debug, puede removerse) |

---

## Cómo agregar una nueva cámara

### 1. Añadir a `cameras.json`
```json
{
  "channel": 2,
  "camera_id": "channel_2",
  "brand": "dahua",
  "ip": "192.168.1.101",
  "user": "admin",
  "password": "contraseña",
  "rtsp_port": 554,
  "enabled": true
}
```
Brands soportados: `dahua`, `hikvision`. El SDK elige el RTSP path según el brand.

### 2. Agregar canal al grupo en SQLite
```python
conn.execute("INSERT OR IGNORE INTO group_channels (group_id, channel, position) VALUES (?, 2, 2)", (group_id,))
```

### 3. Verificar stream
```bash
API_KEY="kv_tu_api_key_aqui"
TOKEN=$(curl -s -X POST http://127.0.0.1:2030/play/live/ui \
  -H "x-api-key: $API_KEY" -H "x-sender-type: ui" -H "x-sender-id: test" \
  -H "Content-Type: application/json" -d '{"group":"default"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['streams'][0]['token'])")

curl -s --max-time 8 \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-api-key: $API_KEY" \
  -H "x-sender-type: ui" -H "x-sender-id: test" \
  http://127.0.0.1:2030/stream/play/1 \
  -w "\nHTTP: %{http_code} | %{size_download} bytes"
# Esperado: HTTP: 200 | N bytes (debe ser > 0)
```

---

## Diagnóstico rápido de problemas

### Ver logs del renderer en tiempo real
El `main/bootstrap.js` tiene `web-contents-created` + `console-message` forwarding. Los logs del renderer aparecen en la salida del proceso main con prefijo `[R:INF]`, `[R:ERR]`, etc.

Lanzar Electron con logs visibles:
```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron . --no-sandbox 2>&1 | tee /tmp/electron-kv.log
```

### Árbol de diagnóstico

```
¿Ves "Conectando…" y se queda así?
  → El token se obtiene pero el stream no arranca
  → Revisar logs del renderer: buscar [MSEController] y [IOController]

¿Ves "Error stream" inmediatamente?
  → Revisar si token IPC falla: buscar "[KV][stream:token]" en logs main
  → Si no aparece el log, el IPC no se llama

¿Logs muestran "403 Forbidden"?
  → Los headers de auth no llegan al SDK
  → Verificar que headers están en el 2do parámetro de createPlayer
  → Verificar que el grupo y canal existen en el SDK

¿Logs muestran "blob:file:// Refused"?
  → Falta media-src blob: en CSP del index.html

¿OPTIONS retorna 405?
  → Falta CORSMiddleware en el SDK, reiniciar servicio después de agregar
```

### Ver logs del SDK en tiempo real
```bash
journalctl -u karenvision-api.service -f
```

Buscar:
- `POST /play/live/ui 200` — token generado correctamente
- `OPTIONS /stream/play/1 200` — CORS OK
- `GET /stream/play/1 200` — stream activo

---

## Token JWT de stream: comportamiento

- **TTL de inicio:** 60 segundos desde que `/play/live/ui` lo genera
- **Una vez conectado:** el stream permanece activo indefinidamente aunque el token expire
- **Si la conexión cae después de 60s:** `mpegts.js` intentará reconectar pero el token ya expiró → nuevo token requerido
- **Reconexión automática:** NO implementada aún — pendiente en `stream-service.js`

---

## Configuración de producción pendiente

- [ ] `KARENVISION_DB_SECRET_KEY` — configurar para cifrar contraseñas de cámaras en la DB
- [ ] Usar `POST /camera/add` API en lugar de inserción directa en SQLite (requiere la variable anterior)
- [ ] Reconexión automática en `stream-service.js` cuando el stream cae
- [ ] Token refresh cuando la conexión se interrumpe (nueva llamada a IPC tras error)
- [ ] Remover `openDevTools` de `viewer-window.js` en producción
- [ ] Remover console forwarding de `bootstrap.js` en producción (o hacerlo condicional a `NODE_ENV`)
- [ ] `KV_API_KEY` como variable de entorno del servicio en lugar de leer el archivo JSON en runtime
