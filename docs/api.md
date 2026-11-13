# API v1

Todas las rutas tienen prefijo `/api/v1`. Respuestas JSON, salvo SSE optativo. Los errores usan `{error:{code,message}}`: 400 entrada inválida, 401 autenticación inválida, 403 origen no autorizado, 404 referencia/conversación inexistente, 409 conversación ocupada o límite, 429 cuota, 502/503 integración no disponible. No se devuelve la respuesta privada del proveedor.

| Método y ruta | Comportamiento |
| --- | --- |
| GET /health | Proceso activo y configuración, sin credenciales. No sustituye la prueba de conexión. |
| GET /perfumes | `{items,total,page,limit,source}`; solo productos publicados. |
| GET /perfumes/search | Misma consulta con filtros; alias de búsqueda. |
| GET /perfumes/:id | Producto público o 404. |
| GET /perfumes/:id/related | Hasta cuatro referencias publicadas con afinidad de familia olfativa. |
| POST /chat/sessions | Crea una conversación propia; devuelve `{id,expires_at}`. |
| GET /chat/sessions/:id/messages | Historial remoto normalizado. Cursor opcional `after`; devuelve `messages,has_more,after`. |
| POST /chat/sessions/:id/messages | Envía mensaje; JSON o `Accept: text/event-stream`. |
| POST /chat/sessions/:id/cancel | Cancela turno remoto; conserva conversación. |
| DELETE /chat/sessions/:id | Elimina sesión remota y metadatos propios. Rechaza si hay turno activo. |

Filtros de catálogo: `page` (desde 1), `limit` (1–120), `q` (nombre/marca), `brand`, `gender`, `sort=default|az|za`, `note`, `exclude_note`, `family`, `occasion`, `profile`. Se rechazan parámetros adicionales, incluido el antiguo filtro available. La ruta de disponibilidad se retiró. Las coincidencias de notas son literales normalizadas; no equivalen a una certificación de ausencia de ingredientes. No se aceptan nombres de tablas, columnas ni SQL del cliente.

Producto: `id` string estable, `display_index` numérico, `slug`, `name`, `brand`, `house`, `gender`, `image`, `detail_url`, `olfactory`, `price` (MXN, o null si no existe una identidad verificada en la lista autorizada). El precio público procede de `api/data/pricing.json`; no se seleccionan columnas comerciales o de inventario de Supabase. No se exponen costos ni márgenes. `olfactory` mantiene los campos existentes y sus advertencias. Las rutas `/#perfume=ID` abren el visor existente. El carrito y WhatsApp funcionan en el cliente y no añaden endpoints de pedidos.

Cada recomendación contiene exclusivamente `{id,name,image,detail_url,reason}`. El servidor valida el ID y toma la imagen/enlace del catálogo; `reason` explica brevemente por qué encaja. Se puede recomendar cualquier perfume publicado, sin depender de su estado comercial histórico. No hay botones de carrito ni indicadores de disponibilidad.

Ejemplo de envío:

```json
{"message":"Busco coco sin tabaco","context":{"locale":"es-MX","timezone":"America/Mexico_City","current_page":"/#coleccion","current_product_id":null,"weather_useful":false}}
```

La respuesta contiene `text`, `recommendations` y `follow_up`. SSE emite `text` con el texto acumulado (reemplazar contenido), `complete` con el resultado completo o `error` recuperable. No expone eventos internos, razonamiento ni credenciales. Tras desconexión recuperar el historial antes de reenviar: no hay reenvío automático que pueda cobrar dos turnos. El endpoint de cancelación detiene el turno remoto; abortar el transporte también solicita cancelación.

El navegador debe enviar credenciales/cookies y un Origin permitido. Todas las mutaciones exigen Origin exacto, incluso solicitudes de herramientas HTTP externas. La cookie es HttpOnly y firmada. Opcionalmente `Authorization: Bearer <JWT de usuario Supabase>` identifica un usuario autenticado; el servidor verifica ese JWT antes de usar su identidad. Nunca se acepta visitorId en el cuerpo.
