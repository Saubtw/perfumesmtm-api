# PERFUMES MTM · API

API Express/TypeScript para el catálogo, precios públicos y asesor de perfumes. El cliente está en https://github.com/Saubtw/perfumesmtm-client.

## Ejecutar

Requiere Node.js 24+.

```sh
npm ci
npm run dev
npm test
npm run build
npm start
```

Sin `.env`, el desarrollo usa el catálogo de archivo incluido y escucha en http://localhost:3001. El asesor requiere credenciales propias. Para Supabase/OpenAI, copiar `.env.example` a `.env`, completar las variables y preparar `catalog-mapping.json` a partir del ejemplo revisado. Nunca subir esos archivos privados.

Producción requiere las variables y validaciones descritas en `docs/deployment.md`: catálogo y sesiones Supabase, claves del servidor, agente existente, origen HTTPS y COOKIE_SECRET estable. El proceso debe ejecutarse desde la raíz de este repositorio. Conservar `data/catalog.json`, `data/olfactory.json` y `data/pricing.json` junto a `dist/` y las dependencias.

## Contrato

`GET /api/v1/health`, catálogo y fichas públicas. El precio MXN procede de `data/pricing.json`, vinculado por identidad; no se publican costos o márgenes. El carrito y WhatsApp se resuelven en el navegador: abrir WhatsApp no crea pedidos ni modifica inventario.

Los endpoints de conversaciones exigen origen permitido y propiedad de sesión. Las claves de OpenAI y Supabase permanecen en el servidor. Consultar `docs/api.md`, `docs/supabase.md` y `docs/ai-agent.md` para la integración.

## Administración privada

Panel `/dashboard-admin` con catálogo reversible, marcas y combos editables, stock, costos y resultados, y cuentas con permisos. El catálogo inicial publica solo los 16 perfumes comerciales. Consulta [la guía](docs/admin.md).
