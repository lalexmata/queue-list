# Migración: Agregar columna platform

## Instrucciones para aplicar la migración en Neon (Railway)

1. Ve a tu dashboard de Neon: https://console.neon.tech/
2. Selecciona tu base de datos
3. Ve a la pestaña "SQL Editor"
4. Copia y pega el contenido del archivo `add_platform_column.sql`
5. Ejecuta la query

## O desde línea de comandos con psql:

```bash
psql $DATABASE_URL -f migrations/add_platform_column.sql
```

Para habilitar el orden manual de las solicitudes musicales:

```bash
psql $DATABASE_URL -f migrations/add_song_request_order.sql
```

Para crear o actualizar el registro de cupones por origen y la configuración del sorteo:

```bash
psql $DATABASE_URL -f migrations/add_giveaway_coupons.sql
```

## Verificar que la migración se aplicó correctamente:

```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'queue_items' AND column_name = 'platform';
```

## PixelBot

Aplica `add_pixelbot.sql` para crear la configuración por servidor de Discord,
los vínculos con Epic y los cumpleaños.

Aplica `add_giveaway_rounds.sql` para separar los cupones por sorteo, conservar
el historial y registrar múltiples ganadores.

Deberías ver:
```
 column_name | data_type | column_default 
-------------+-----------+----------------
 platform    | varchar   | 'unknown'
```
