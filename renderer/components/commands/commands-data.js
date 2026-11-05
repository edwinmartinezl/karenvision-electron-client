// Command definitions organized by module.
// Each command maps directly to its API endpoint.

export const MODULES = [
  {
    id: "camera",
    title: "Cámaras",
    icon: "📷",
    commands: [
      {
        id: "camera.add",
        title: "Agregar cámara",
        desc: "Registra una cámara nueva y verifica que la conexión funcione.",
        policy: "both",
        method: "POST",
        path: "/camera/add",
        actionLabel: "Agregar cámara",
        wizardNext: { moduleId: "storage", commandId: "storage.path.set" },
        fields: [
          { key: "channel",       label: "Número de canal",     type: "number",   hint: "Dejar vacío para asignar automáticamente" },
          { key: "brand",         label: "Marca",               type: "select",   options: ["dahua","hikvision"], required: true },
          { key: "ip",            label: "Dirección IP",        type: "text",     required: true, placeholder: "192.168.1.100" },
          { key: "user",          label: "Usuario de acceso",   type: "text",     default: "admin" },
          { key: "password",      label: "Contraseña",          type: "password", required: true },
          { key: "rtsp_port",     label: "Puerto de video",     type: "number",   default: 554 },
          { key: "probe_seconds", label: "Segundos de prueba",  type: "number",   default: 3 },
        ],
      },
      {
        id: "camera.list",
        title: "Ver todas las cámaras",
        desc: "Muestra la lista completa de cámaras registradas en el sistema.",
        policy: "developer",
        method: "GET",
        path: "/camera/list",
        actionLabel: "Ver cámaras",
        fields: [],
      },
      {
        id: "camera.update",
        title: "Editar datos de cámara",
        desc: "Cambia la IP, usuario, contraseña u otros datos de una cámara existente.",
        policy: "developer",
        method: "POST",
        path: "/camera/update",
        actionLabel: "Guardar cambios",
        fields: [
          { key: "channel",   label: "Cámara",            type: "channel-select", required: true },
          { key: "brand",     label: "Marca",             type: "select",   options: ["","dahua","hikvision"], hint: "Dejar vacío para no cambiar" },
          { key: "ip",        label: "Nueva IP",          type: "text",     placeholder: "192.168.1.100" },
          { key: "user",      label: "Usuario",           type: "text" },
          { key: "password",  label: "Contraseña",        type: "password" },
          { key: "rtsp_port", label: "Puerto de video",   type: "number" },
        ],
      },
      {
        id: "camera.remove",
        title: "Eliminar cámara",
        desc: "Borra permanentemente una cámara del sistema.",
        policy: "developer",
        method: "POST",
        path: "/camera/remove",
        actionLabel: "Eliminar cámara",
        fields: [
          { key: "channel", label: "Cámara", type: "channel-select", required: true },
        ],
      },
    ],
  },

  {
    id: "storage",
    title: "Almacenamiento",
    icon: "💾",
    commands: [
      {
        id: "storage.path.get",
        title: "¿Dónde se guarda el video?",
        desc: "Muestra la carpeta donde se graba el video de un canal.",
        policy: "both",
        method: "GET",
        path: "/storage/path/get",
        actionLabel: "Ver carpeta actual",
        showChannelState: true,
        fields: [
          { key: "channel", label: "Cámara", type: "channel-select", required: true, pathParam: true },
        ],
        pathTemplate: "/storage/path/get/{channel}",
      },
      {
        id: "storage.path.set",
        title: "Asignar carpeta de grabación",
        desc: "Define la carpeta donde se guardarán las grabaciones de un canal (primera vez).",
        policy: "developer",
        method: "POST",
        path: "/storage/path/set",
        actionLabel: "Asignar carpeta",
        wizardNext: { moduleId: "quota", commandId: "quota.set" },
        showChannelState: true,
        fields: [
          { key: "channel", label: "Cámara",           type: "channel-select", required: true },
          { key: "path",    label: "Carpeta de destino", type: "folder",       required: true, placeholder: "/mnt/nvr/channel_1" },
        ],
      },
      {
        id: "storage.path.change",
        title: "Cambiar carpeta de grabación",
        desc: "Mueve las grabaciones nuevas a otra carpeta. La grabación se pausa brevemente y continúa sola.",
        policy: "developer",
        method: "POST",
        path: "/storage/path/change",
        actionLabel: "Cambiar carpeta",
        showChannelState: true,
        fields: [
          { key: "channel", label: "Cámara",       type: "channel-select", required: true },
          { key: "path",    label: "Nueva carpeta", type: "folder",        required: true, placeholder: "/mnt/nvr2/channel_1" },
        ],
      },
      {
        id: "storage.usage",
        title: "Espacio usado por canal",
        desc: "Consulta cuánto disco está usando cada cámara y cuánto le queda disponible.",
        policy: "developer",
        method: "GET",
        path: "/storage/usage",
        fields: [
          { key: "channel", label: "Cámara (opcional)", type: "channel-select-optional", queryParam: true },
        ],
      },
    ],
  },

  {
    id: "service",
    title: "Estado de grabación",
    icon: "⚙️",
    commands: [
      {
        id: "service.status",
        title: "Ver estado de los servicios",
        desc: "Muestra si los servicios de grabación están activos, con cuántos reinicios y cuál fue el último error.",
        policy: "both",
        method: "GET",
        path: "/service/status",
        fields: [
          { key: "all",     label: "Todas las cámaras",        type: "checkbox",              default: true,  queryParam: true },
          { key: "channel", label: "Cámara específica (opcional)", type: "channel-select-optional", queryParam: true },
        ],
      },
      {
        id: "service.control",
        title: "Reiniciar / detener grabación",
        desc: "Inicia, detiene o reinicia los servicios de grabación de uno o todos los canales.",
        policy: "developer",
        method: "POST",
        path: "/service/control",
        fields: [
          { key: "action", label: "Acción",           type: "select",   options: ["start","stop","restart"], required: true },
          { key: "all",    label: "Todas las cámaras", type: "checkbox", default: false },
        ],
      },
    ],
  },

  {
    id: "channel",
    title: "Estado del canal",
    icon: "📡",
    commands: [
      {
        id: "channel.status",
        title: "Estado completo del canal",
        desc: "Muestra en una sola vista si el canal tiene cámara, almacenamiento, cuota y grabación activa.",
        policy: "developer",
        method: "GET",
        path: "/channel/status",
        fields: [
          { key: "channel", label: "Cámara (opcional, vacío = todas)", type: "channel-select-optional", queryParam: true },
        ],
      },
    ],
  },

  {
    id: "timeline",
    title: "Historial de grabación",
    icon: "⏳",
    commands: [
      {
        id: "timeline.show",
        title: "Ver grabaciones disponibles",
        desc: "Muestra los segmentos de video grabados y cuándo están disponibles para reproducir.",
        policy: "both",
        method: "GET",
        path: "/timeline/show",
        fields: [
          { key: "channel", label: "Cámara (opcional)", type: "channel-select-optional", queryParam: true },
        ],
      },
      {
        id: "timeline.build",
        title: "Reconstruir historial",
        desc: "Vuelve a indexar los archivos de video del canal para actualizar el historial.",
        policy: "developer",
        method: "POST",
        path: "/timeline/build",
        fields: [
          { key: "channel", label: "Cámara", type: "channel-select", required: true },
        ],
      },
      {
        id: "timeline.clear",
        title: "Borrar historial",
        desc: "Elimina el índice de grabaciones de un canal. Los archivos de video no se borran.",
        policy: "developer",
        method: "POST",
        path: "/timeline/clear",
        fields: [
          { key: "channel", label: "Cámara", type: "channel-select", required: true },
        ],
      },
    ],
  },

  {
    id: "audit",
    title: "Auditoría",
    icon: "📋",
    commands: [
      {
        id: "audit.event",
        title: "Buscar eventos del sistema",
        desc: "Consulta el registro de actividad: qué pasó, cuándo y en qué canal.",
        policy: "both",
        method: "POST",
        path: "/audit/event",
        fields: [
          { key: "from",    label: "Desde (fecha)",       type: "text",   required: true, placeholder: "2026-06-01" },
          { key: "to",      label: "Hasta (fecha)",       type: "text",   required: true, placeholder: "2026-06-07" },
          { key: "channel", label: "Canal (opcional)",    type: "number" },
          { key: "name",    label: "Tipo de evento",      type: "text",   placeholder: "CameraAdded" },
          { key: "module",  label: "Módulo",              type: "text",   placeholder: "camera" },
          { key: "limit",   label: "Máximo de resultados", type: "number", default: 20 },
        ],
      },
    ],
  },

  {
    id: "quota",
    title: "Cuota",
    icon: "📊",
    commands: [
      {
        id: "quota.status",
        title: "Gestionar cuota por canal",
        desc: "Ver y ajustar el espacio asignado a cada canal, con tiempos grabados y política FIFO.",
        policy: "both",
        method: "GET",
        path: "/channel/status",
        fields: [],
      },
      {
        id: "quota.overwrite.set",
        title: "Configurar reciclado automático (FIFO)",
        desc: "Cuando el canal se llena, borra los videos más antiguos para liberar espacio.",
        policy: "both",
        method: "POST",
        path: "/quota/overwrite/set",
        actionLabel: "Guardar configuración FIFO",
        showChannelState: true,
        fields: [
          { key: "channel",   label: "Cámara",              type: "channel-select", required: true },
          { key: "threshold", label: "Activar al llegar a", type: "percent", required: true, default: 90, hint: "% de uso que activa el borrado automático" },
          { key: "target",    label: "Liberar hasta",       type: "percent", required: true, default: 70, hint: "% al que bajar el uso después de borrar" },
          { key: "mode",      label: "Política",            type: "select", options: ["fifo"], required: true },
        ],
      },
      {
        id: "quota.overwrite.change",
        title: "Cambiar reciclado automático (FIFO)",
        desc: "Modifica el umbral y objetivo de una política FIFO que ya está configurada para el canal.",
        policy: "both",
        method: "POST",
        path: "/quota/overwrite/change",
        actionLabel: "Actualizar configuración FIFO",
        showChannelState: true,
        fields: [
          { key: "channel",   label: "Cámara",              type: "channel-select", required: true },
          { key: "threshold", label: "Activar al llegar a", type: "percent", required: true, default: 90, hint: "% de uso que activa el borrado automático" },
          { key: "target",    label: "Liberar hasta",       type: "percent", required: true, default: 70, hint: "% al que bajar el uso después de borrar" },
          { key: "mode",      label: "Política",            type: "select", options: ["fifo"], required: true },
        ],
      },
      {
        id: "quota.set",
        title: "Asignar cuota de disco",
        desc: "Asigna límite de disco a un canal por primera vez.",
        policy: "developer",
        method: "POST",
        path: "/quota/set",
        actionLabel: "Asignar cuota",
        showChannelState: true,
        fields: [
          { key: "channel", label: "Cámara",  type: "channel-select", required: true },
          { key: "size",    label: "Tamaño",  type: "size", required: true, default: 50, defaultUnit: "GB" },
        ],
      },
      {
        id: "quota.change",
        title: "Cambiar cuota de disco",
        desc: "Cambia el límite de disco de un canal que ya tiene cuota asignada.",
        policy: "developer",
        method: "POST",
        path: "/quota/change",
        actionLabel: "Cambiar cuota",
        showChannelState: true,
        fields: [
          { key: "channel", label: "Cámara",       type: "channel-select", required: true },
          { key: "size",    label: "Nuevo tamaño",  type: "size",   required: true, default: 100, defaultUnit: "GB" },
        ],
      },
    ],
  },

  {
    id: "calc",
    title: "Calculadora de disco",
    icon: "🧮",
    commands: [],   // UI especial — montada por _enterCalcPanel (calc.size.time / calc.time.size vía POST /calc/run)
  },

  {
    id: "usage",
    title: "Uso",
    icon: "📈",
    commands: [],   // UI especial — montada por _enterUsagePanel (GET /semantic/usage, presupuesto de Gemini, [[073]]-[[075]])
  },

  {
    id: "system",
    title: "Sistema",
    icon: "🖥️",
    commands: [
      {
        id: "system.health",
        title: "¿Está funcionando el sistema?",
        desc: "Verifica que el servidor KarenVision esté activo y respondiendo.",
        policy: "both",
        method: "GET",
        path: "/health",
        fields: [],
      },
      {
        id: "system.version",
        title: "Versión del sistema",
        desc: "Muestra la versión instalada del software KarenVision.",
        policy: "both",
        method: "GET",
        path: "/version",
        fields: [],
      },
      {
        id: "system.mode.status",
        title: "Modo de operación activo",
        desc: "Indica si el sistema está en modo normal (producción) o modo técnico (desarrollador).",
        policy: "both",
        method: "GET",
        path: "/system/mode/status",
        fields: [],
      },
      {
        id: "system.mode.set",
        title: "Cambiar modo de operación",
        desc: "Cambia entre modo producción y modo técnico. Requiere código de autorización.",
        policy: "developer",
        method: "POST",
        path: "/system/mode/set",
        actionLabel: "Cambiar modo",
        fields: [
          { key: "mode",  label: "Modo",               type: "select",   options: ["developer","production"], required: true },
          { key: "token", label: "Código de autorización", type: "password", required: true },
        ],
      },
      {
        id: "system.streams.status",
        title: "Cámaras transmitiendo ahora",
        desc: "Muestra cuántas cámaras están enviando video en este momento.",
        policy: "both",
        method: "GET",
        path: "/system/streams/status",
        fields: [],
      },
    ],
  },

  {
    id: "client",
    title: "Mi sesión",
    icon: "🔑",
    commands: [],   // UI especial — montada por _enterSessionPanel (sesión de Google + cerrar sesión)
  },

  {
    id: "api-server",
    title: "Servidor API",
    icon: "🛜",
    commands: [
      {
        id: "api.status",
        title: "Estado del servidor API",
        desc: "Verifica si el servidor API de KarenVision está activo y muestra información de versión y uptime.",
        policy: "both",
        method: "GET",
        path: "/api/status",
        fields: [],
      },
      {
        id: "api.logs",
        title: "Logs del servidor API",
        desc: "Muestra las últimas líneas del log del servidor API.",
        policy: "developer",
        method: "GET",
        path: "/api/logs",
        fields: [
          { key: "lines", label: "Líneas a mostrar", type: "number", default: 50, queryParam: true },
        ],
      },
      {
        id: "api.restart",
        title: "Reiniciar servidor API",
        desc: "Reinicia el servidor FastAPI de KarenVision. La conexión se interrumpirá brevemente.",
        policy: "developer",
        method: "POST",
        path: "/api/restart",
        actionLabel: "Reiniciar servidor",
        fields: [],
      },
    ],
  },
];
