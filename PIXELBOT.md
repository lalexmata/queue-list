# PixelBot

PixelBot comparte los servicios y la base de datos de esta aplicación. Si
`DISCORD_BOT_TOKEN` está vacío, la web sigue funcionando y el bot no se inicia.

Para levantar el proyecto local conservando el token pero sin conectar otra instancia
a Discord, agrega esto al `.env` local:

```env
PIXELBOT_ENABLED=false
```

La web y las APIs seguirán funcionando; solo se omiten el login y los listeners de
Discord. En producción usa `PIXELBOT_ENABLED=true` o no declares la variable, porque
el valor predeterminado es activo.

## Preparación

1. Ejecuta `migrations/add_pixelbot.sql` en Neon.
2. Crea la aplicación PixelBot en Discord Developer Portal.
3. En OAuth2 URL Generator selecciona `bot` y `applications.commands`.
4. Concede `View Channels`, `Send Messages` y `Embed Links`.
5. En **Bot > Privileged Gateway Intents**, activa **Server Members Intent**.
6. Crea una API key en https://dash.fortnite-api.com/.
7. Configura en Railway:

```env
PIXELBOT_ENABLED=true
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
- `/pixelbot canal-bienvenida canal:` configura las entradas y salidas del servidor.
- `/pixelbot estado`

PixelBot revisa los cumpleaños cada 15 minutos según la zona horaria configurada
y felicita una sola vez por usuario y fecha. Si no se define un canal de cumpleaños,
utiliza el canal general de PixelBot.

Para perfiles sin cuenta de Discord, asigna al menos una de sus identidades de
plataforma al servidor desde el panel de comunidad. PixelBot publicará su nombre
visible en lugar de una mención. Si tiene Discord vinculado, lo mencionará.

PixelBot publica una bienvenida cuando entra una persona y una despedida cuando
abandona el servidor. Ignora cuentas bot. Para habilitarlo, aplica la migración
`npm run migrate:pixelbot-welcome`, vuelve a registrar los comandos con
`npm run discord:register` y configura el canal con `/pixelbot canal-bienvenida`.

El evento de ingreso requiere **Server Members Intent**. El canal debe permitir al
bot **Ver canal** y **Enviar mensajes**; **Insertar enlaces** es opcional y, si no
está disponible, PixelBot envía una bienvenida simple en texto.

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

## Perfiles de comunidad y cumpleaños multiplataforma

Discord, Twitch, YouTube y Kick utilizan el mismo perfil, sin tablas específicas por
plataforma. El perfil reúne identidades, cumpleaños, sorteos, premios, cupones,
solicitudes de canciones y presencia actual en la cola. Aplica primero la migración:

```bash
npm run migrate:community-profiles
```

Para registrar o actualizar un cumpleaños:

```text
PUT https://TU-DOMINIO/api/pixelbot/birthdays/platforms/PLATAFORMA/users/USUARIO
x-api-key: TU_INTEGRATION_API_KEY
Content-Type: application/json

{"displayName":"USUARIO","day":15,"month":8}
```

`PLATAFORMA` acepta `discord`, `twitch`, `youtube` o `kick`. La respuesta incluye
`message`, listo para enviarlo al chat. El año es opcional. Para Discord agrega
`"communityId":"GUILD_ID"`; las otras plataformas también pueden usar
`communityId` si se necesita separar comunidades.

La primera identidad registrada crea un `profileId`. Para indicar que otra cuenta
pertenece a la misma persona, registra esa identidad incluyendo el mismo identificador:

```json
{"profileId":42,"displayName":"OTRO_NOMBRE","day":15,"month":8}
```

El cumpleaños se guarda una sola vez en el perfil y cada identidad puede tener un
nombre diferente. Los nombres iguales no se vinculan automáticamente, para evitar
mezclar por error a personas distintas.

Para consultar un usuario:

```text
GET https://TU-DOMINIO/api/pixelbot/birthdays/platforms/PLATAFORMA/users/USUARIO
x-api-key: TU_INTEGRATION_API_KEY
```

Para consultar todas las identidades vinculadas a una persona:

```text
GET https://TU-DOMINIO/api/pixelbot/birthdays/profiles/PROFILE_ID
x-api-key: TU_INTEGRATION_API_KEY
```

Para buscar una persona por cualquiera de sus nombres y consultar su ficha completa:

```text
GET https://TU-DOMINIO/api/pixelbot/community/profiles?q=USUARIO
GET https://TU-DOMINIO/api/pixelbot/community/profiles/PROFILE_ID
x-api-key: TU_INTEGRATION_API_KEY
```

Para obtener los próximos cumpleaños del mes actual en horario de Santiago:

```text
GET https://TU-DOMINIO/api/pixelbot/birthdays/platforms/PLATAFORMA?scope=upcoming
x-api-key: TU_INTEGRATION_API_KEY
```

Usa `scope=month` para incluir también los cumpleaños que ya pasaron durante el
mes. Se puede consultar otro mes con `month=1` a `month=12` y cambiar la zona
horaria con `timezone=America/Santiago`.
