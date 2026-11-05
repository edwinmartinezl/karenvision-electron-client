# KarenVision Desktop Client

> **Cliente de escritorio oficial y de referencia para KarenVision NVR**  
> Construido con Electron, JavaScript y MediaSource Extensions (MSE).

---

## 🎯 Acerca del proyecto

Este repositorio contiene el código fuente del **Cliente de Escritorio Oficial** de **KarenVision**. Funciona como un consumidor desacoplado de la API de **KarenVision NVR SDK** (el backend central de grabación y gestión de video).

Al ser de **código abierto**, está diseñado no solo para ser utilizado como aplicación de escritorio, sino como **implementación de referencia** para desarrolladores que deseen construir sus propias interfaces de usuario (paneles web en React/Vue, aplicaciones móviles en Flutter/React Native, interfaces táctiles para kioscos o integraciones con sistemas como Home Assistant).

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                 KARENVISION DESKTOP CLIENT                  │
│  (Electron + Chromium + mpegts.js)                          │
│                                                             │
│  • Proceso Main: Gestión de ventanas, tray, IPC seguro      │
│  • Proceso Renderer: UI modular (Vanilla JS + CSS tokens)   │
│  • Pipeline de Video: mpegts.js → remux fMP4 → HTML5 MSE   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / WebSocket (puerto 2030)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 KARENVISION NVR SDK (CORE)                  │
│  Servicio de backend (Python / FastAPI / systemd / FFmpeg)   │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Características principales

- **Vista en Vivo (Live Grid):** Mosaicos de cámaras multi-canal con layouts dinámicos (1x1, 2x2, 3x3, etc.) y baja latencia.
- **Reproducción Forense (Playback & Timeline):** Navegación visual por línea de tiempo con detección de huecos (*gaps*) y reproducción sincronizada.
- **Gestión de Cámaras:** Detección, alta individual o masiva de cámaras IP (Hikvision, Dahua, ONVIF vía RTSP).
- **Control de Almacenamiento y Cuotas:** Monitoreo visual de uso de disco y políticas de sobrescritura FIFO.
- **Acceso Seguro por PIN:** Autenticación local mediante código de acceso de 6 dígitos con bloqueo temporal tras intentos fallidos.
- **Internacionalización:** Soporte multi-idioma (Español e Inglés) con diccionarios reactivos.

---

## 🚀 Requisitos y Configuración de Desarrollo

### Requisitos previos
- **Node.js** v18 o superior
- **npm** v9 o superior
- Una instancia activa de **KarenVision NVR SDK** (por defecto en `http://127.0.0.1:2030`)

### Instalación de dependencias

```bash
npm install
```

### Ejecutar en modo desarrollo

En Linux:
```bash
npm run start:linux
```

En Windows / macOS:
```bash
npm start
```

---

## 📦 Construir instaladores de producción

El proyecto utiliza `electron-builder` para empaquetar ejecutables nativos:

### Para Linux (paquete `.deb` y `AppImage`):
```bash
npm run dist:deb
```
El archivo resultante se generará en la carpeta `dist/`.

### Para Windows (instalador `.exe` NSIS):
```bash
npm run dist:win
```

---

## 🧩 Estructura de carpetas

```text
├── main/                   # Proceso Principal de Electron
│   ├── api/                # Cliente HTTP para la API de KarenVision
│   ├── config/             # Configuración persistente del cliente
│   ├── diagnostics/        # Verificación de cableado IPC y módulos
│   ├── ipc/                # Handlers IPC (comunicación main ↔ renderer)
│   ├── playback/           # Proxy local para streaming de grabaciones
│   └── windows/            # Creación y ciclo de vida de ventanas
├── renderer/               # Proceso Renderer (Interfaz de usuario)
│   ├── app/                # Controlador principal y enrutador de pantallas
│   ├── assets/             # Iconos, logotipos y gráficos SVG/PNG
│   ├── components/         # Módulos visuales (view-group, playback, storage, etc.)
│   ├── core/               # Estado reactivo, constantes, i18n y DOM helpers
│   ├── services/           # Servicio de streaming (mpegts.js) y controles
│   ├── styles/             # Variables de diseño (tokens), layout y reset
│   └── vendor/             # Librerías cliente (mpegts.js, anime.js)
├── docs/                   # Guías técnicas de streaming y setup
├── main.js                 # Entrypoint del proceso main
├── preload.js              # Script preload con contextBridge seguro
└── package.json            # Metadatos, scripts y dependencias
```

---

## 💡 Para desarrolladores de interfaces alternativas

Si deseas construir una interfaz web independiente (por ejemplo, en React o Next.js) o una aplicación móvil:
1. Conéctate a la API REST de KarenVision en `http://<IP_DEL_NVR>:2030`.
2. Revisa la documentación Swagger interactiva disponible en `http://<IP_DEL_NVR>:2030/docs`.
3. Consulta el archivo `docs/STREAMING_SETUP.md` en este repositorio para comprender cómo funciona el handshake de tokens temporales de streaming con `mpegts.js`.

---

## 📄 Licencia

Este proyecto está distribuido bajo la licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.

