# Bot Queue Live 🎮

Un servidor API para gestionar colas de usuarios en tiempo real, ideal para streamers y bots de redes sociales como TikTok.

## 📋 Descripción

Este proyecto proporciona una API REST para gestionar una cola de usuarios. Los usuarios pueden unirse, ver su posición, salir de la cola, y los administradores pueden gestionar el flujo sacando al siguiente usuario.

### Características principales:
- ✅ Añadir usuarios a la cola
- 📊 Ver estado actual de la cola
- 🚀 Sacar al siguiente usuario
- 🚪 Salir de la cola
- 💾 Persistencia en archivos JSON y CSV
- 🔄 API REST con Express.js

## 🛠️ Requisitos

- **Node.js**: v16.9.0 o superior (recomendado v18+)
- **npm**: Incluido con Node.js

## 📦 Instalación

1. Clona o descarga este repositorio
2. Navega al directorio del proyecto:
   ```bash
   cd bot_queue_live
   ```
3. Instala las dependencias:
   ```bash
   npm install
   ```

## 🚀 Uso

### Iniciar el servidor
```bash
npm start
```

El servidor se ejecutará en: `http://127.0.0.1:5005`

### Endpoints de la API

#### 🎯 POST `/jugar`
Añade un usuario a la cola.

**Body:**
```json
{
  "uniqueId": "usuario123",
  "nickname": "NombreUsuario" // opcional
}
```

**Respuesta exitosa:**
```json
{
  "ok": true,
  "status": "added",        // o "already_in_queue"
  "pos": 1,                 // posición en la cola
  "size": 1                 // tamaño total de la cola
}
```

#### 📋 GET `/lista`
Obtiene el estado actual de la cola.

**Respuesta:**
```json
{
  "ok": true,
  "size": 2,
  "queue": [
    {
      "uniqueId": "usuario123",
      "nickname": "NombreUsuario",
      "ts": "2025-12-19T15:30:00.000Z"
    },
    {
      "uniqueId": "usuario456",
      "nickname": "OtroUsuario",
      "ts": "2025-12-19T15:31:00.000Z"
    }
  ]
}
```

#### ⏭️ POST `/siguiente`
Saca al siguiente usuario de la cola (FIFO - First In, First Out).

**Respuesta:**
```json
{
  "ok": true,
  "next": {
    "uniqueId": "usuario123",
    "nickname": "NombreUsuario",
    "ts": "2025-12-19T15:30:00.000Z"
  },
  "size": 1  // tamaño después de sacar al usuario
}
```

#### 🚪 POST `/salir`
Permite a un usuario salir de la cola voluntariamente.

**Body:**
```json
{
  "uniqueId": "usuario123"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "status": "removed",      // o "not_in_queue"
  "removed": {
    "uniqueId": "usuario123",
    "nickname": "NombreUsuario",
    "ts": "2025-12-19T15:30:00.000Z"
  },
  "size": 0
}
```

## 📁 Estructura de archivos

```
bot_queue_live/
├── package.json          # Configuración del proyecto
├── server.js            # Servidor principal
├── data/                # Directorio de datos (se crea automáticamente)
│   ├── queue.json       # Cola en formato JSON
│   └── queue.csv        # Cola en formato CSV
└── README.md           # Este archivo
```

## 💾 Almacenamiento

Los datos se guardan automáticamente en dos formatos:

- **`data/queue.json`**: Formato JSON para la API
- **`data/queue.csv`**: Formato CSV para análisis externos

El directorio `data/` se crea automáticamente al iniciar el servidor.

## 🔧 Configuración

### Puerto del servidor
Por defecto usa el puerto `5005`. Para cambiarlo, modifica la variable `PORT` en [server.js](server.js#L97):

```javascript
const PORT = 5005; // Cambia este valor
```

### Estructura de datos
Cada usuario en la cola tiene:
- `uniqueId`: Identificador único del usuario
- `nickname`: Nombre para mostrar (opcional, usa uniqueId si no se proporciona)
- `ts`: Timestamp de cuándo se unió a la cola

## 🧪 Pruebas

Puedes probar los endpoints usando curl, Postman, o cualquier cliente HTTP:

```bash
# Añadir usuario a la cola
curl -X POST http://127.0.0.1:5005/jugar \
  -H "Content-Type: application/json" \
  -d '{"uniqueId": "test_user", "nickname": "Usuario de Prueba"}'

# Ver la cola
curl http://127.0.0.1:5005/lista

# Sacar al siguiente
curl -X POST http://127.0.0.1:5005/siguiente
```

## 🤝 Integración con bots

Este servidor está diseñado para integrarse fácilmente con bots de:
- TikTok Live
- Twitch
- YouTube Live
- Discord
- Y cualquier plataforma que soporte webhooks HTTP

## 🐛 Solución de problemas

### Error: "Object.hasOwn is not a function"
- **Causa**: Versión de Node.js demasiado antigua
- **Solución**: Actualizar a Node.js v16.9.0 o superior

### El servidor no inicia
- Verificar que el puerto 5005 no esté en uso
- Comprobar que las dependencias estén instaladas (`npm install`)

## 📄 Licencia

ISC License - Ver [package.json](package.json) para más detalles.

---

**¿Necesitas ayuda?** Abre un issue o consulta la documentación de los endpoints arriba. 🚀