# Despliegues independientes

No se ha desplegado la aplicación. Las migraciones autorizadas de Supabase sí se aplicaron.

## Cliente

Construir con `npm run build -w client` y publicar `client/dist/` en hosting estático. Configurar `VITE_API_URL=https://api.example.com/api/v1` durante el build. Este valor es público; no incluir credenciales OpenAI ni secret keys. Los recursos de `client/public/` se copian al build; las rutas de ancla y del visor siguen funcionando. Los enlaces de tarjetas abren el visor existente por ID.

## API

Node 24+, `npm ci`, `npm run build -w api`, `npm run start -w api`. Publicar el directorio API con `dist/`, `data/catalog.json`, `data/olfactory.json`, el archivo de mapeo revisado y sus dependencias. Ejecutar desde `api/`; los scripts de workspace establecen ese directorio. Los JSON fuente se resuelven relativos al módulo, no al directorio del cliente.

Variables obligatorias de producción: NODE_ENV=production, CATALOG_SOURCE=supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_CATALOG_MAPPING, OPENAI_API_KEY, OPENAI_AGENT_ID, COOKIE_SECRET (mínimo 32 caracteres) y CLIENT_ORIGIN HTTPS exacto. PORT lo determina el hosting. Guardar secretos en el gestor del hosting; no incorporarlos a la imagen pública. El arranque rechaza configuraciones incompletas de producción.

El proceso usa HTTP detrás de un proxy TLS confiable. Permitir respuestas SSE sin buffering, con timeout superior a CHAT_TIMEOUT_MS más margen de cancelación. Configurar TRUST_PROXY_HOPS según la topología real; por defecto cero evita confiar en X-Forwarded-For del visitante. No abrir rutas alternativas al origen que permitan falsificar la cadena de proxies. Configurar un máximo de cuerpo de 16KB también en el proxy.

Preferir cliente y API bajo el mismo sitio (por ejemplo tienda.example.com y api.example.com), o reverse proxy /api. Para dominios de sitios distintos usar COOKIE_SAME_SITE=none; las cookies son Secure en producción. CORS debe coincidir exactamente con CLIENT_ORIGIN y el cliente enviar credentials. Navegadores que bloqueen cookies de terceros requieren el despliegue bajo el mismo sitio.

Las sesiones/propiedad/cuotas/locks/consumo viven en Supabase y permiten reinicios del backend. Mantener COOKIE_SECRET estable entre réplicas; cambiarlo invalida identidad anónima. El proceso limpia sesiones expiradas y su contraparte OpenAI cada minuto; los errores se reintentan en la siguiente limpieza. La retención por defecto es de siete días. SQLite solo es alternativa de desarrollo y requiere disco persistente; no se permite como sustituto de Supabase en producción.

## Ubicación y clima

WEATHER_PROVIDER acepta weatherapi u openweather y requiere su WEATHER_API_KEY. IP_GEO_PROVIDER acepta ipapi o cloudflare. Con cloudflare solo se leen sus cabeceras si TRUST_HOSTING_HEADERS=true, después de restringir el origen para recibir tráfico únicamente desde Cloudflare y habilitar Add visitor location headers. No habilitarlo en un servidor público directo: un cliente podría falsificar esas cabeceras. En localhost se ignoran por defecto. ipapi consulta IP pública aproximada con timeout; no envía la IP al modelo. Clima se consulta únicamente cuando la petición indica utilidad y hay coordenadas; caché geográfica de diez minutos. Los fallos producen null.

## Diagnóstico

- /health distingue configuración y almacén seleccionado, pero no demuestra salud remota. Ejecutar smoke:live para conectividad/permisos.
- 503 de catálogo: revisar mapeo, RLS, URL, permisos y red; no recurrir a stock ficticio.
- 503 de chat: revisar cookie secret, credenciales de servidor, migraciones y Agent ID. El agente debe llamarse Perfume AI Advisor y usar gpt-6.1-sol.
- 409: esperar/cancelar turno activo o comenzar otra conversación si alcanzó su límite.
- 429: revisar cuotas. No reintentar en bucle.
- Interrupción SSE: recuperar historial; los eventos no se reproducen automáticamente.
- No hay stock/precio: introducir datos comerciales verificados con un rol autorizado. No habilitar escritura pública.

Antes de publicar, establecer presupuesto OpenAI, protección del origen/TLS y proveedores contextuales reales. Las pruebas automatizadas no sustituyen verificar la configuración del hosting.
