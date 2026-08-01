# PixelBot

PixelBot comparte los servicios y la base de datos de esta aplicación. Si
`DISCORD_BOT_TOKEN` está vacío, la web sigue funcionando y el bot no se inicia.

## Preparación

1. Ejecuta `migrations/add_pixelbot.sql` en Neon.
2. Crea la aplicación PixelBot en Discord Developer Portal.
3. En OAuth2 URL Generator selecciona `bot` y `applications.commands`.
4. Concede `View Channels`, `Send Messages` y `Embed Links`.
5. Crea una API key en https://dash.fortnite-api.com/.
6. Configura en Railway:

```env
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
FORTNITE_API_KEY=
INTEGRATION_API_KEY=
```

No publiques estas claves ni las agregues al repositorio.

## Comandos iniciales

- `/fortnite vincular jugador:`
- `/fortnite stats [jugador] [periodo]`
- `/cumpleanos registrar dia: mes: [ano:]`
- `/cumpleanos consultar`
- `/cumpleanos lista`
- `/cupones vincular usuario:` vincula Discord con los cupones del usuario de Twitch.
- `/cupones consultar [usuario:]` muestra los cupones cuando el sorteo está activo.
- `/sorteo estado`, `/sorteo activar` y `/sorteo desactivar` controlan el sorteo.
- `/pixelbot canal canal:` (requiere Gestionar servidor)
- `/pixelbot canal-cumpleanos canal:` configura dónde se publican las felicitaciones.
- `/pixelbot estado`

PixelBot revisa los cumpleaños cada 15 minutos según la zona horaria configurada
y felicita una sola vez por usuario y fecha. Si no se define un canal de cumpleaños,
utiliza el canal general de PixelBot.

PixelBot también responde cuando un usuario lo menciona en un mensaje. Esta función
solo escucha eventos de mensajes y no requiere activar intents privilegiados.

Los comandos se registran globalmente ejecutando `npm run discord:register` solo
cuando cambia su definición. Discord puede tardar algunos minutos en mostrarlos.

## Streamer.bot

Consulta las estadísticas compartidas mediante:

```text
GET https://TU-DOMINIO/api/pixelbot/fortnite/stats?name=JUGADOR&timeWindow=lifetime
x-api-key: TU_INTEGRATION_API_KEY
```

La respuesta contiene `message`, listo para publicar, y `stats` con los datos
estructurados. También se acepta `timeWindow=season`.

Para consultar un cumpleaños vinculado a Discord:

```text
GET https://TU-DOMINIO/api/pixelbot/birthdays/GUILD_ID/DISCORD_USER_ID
x-api-key: TU_INTEGRATION_API_KEY
```
