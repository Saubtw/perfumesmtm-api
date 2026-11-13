# Importación controlada

La fuente original es `CATALOGO_PERFUMES_Y_FICHAS.md`, contrastada contra la identidad de las 118 referencias de `api/data/catalog.json`. El importador lee UTF-8, conserva variantes (EDT/EDP/ediciones/género), separa las fichas por su número estable y valida marca/nombre normalizados. Se verificaron 118 identidades exactas, sin discrepancias. Nunca se generan notas, rendimiento, precios ni cantidades.

```sh
npm run catalog:import
```

Genera `api/reports/catalog-import.json` y `profiles-normalized.json` con hash SHA-256 de la fuente, candidatos, identidad pendiente, coincidencia ambigua o estado verificado. Los reportes quedan fuera de Git. Una coincidencia exacta propone un candidato; no lo aprueba automáticamente. Para vincular otro esquema usar `api/product-links.json` con entradas `{"source_id":9,"product_id":"ID_REAL","verified":true}` revisadas, sin IDs repetidos. El repositorio rechaza duplicados. No se utiliza coincidencia aproximada. En la tabla Sillage creada, los IDs son precisamente los IDs estables del frontend: `product-links.sillage.example.json` registra ese vínculo explícito, comprobado después de importar; el reporte final contiene 118 asociaciones verificadas.

`npm run catalog:import -- --apply` incorpora únicamente perfiles locales ausentes, de forma atómica, sin sobrescribir los anteriores. No escribe arbitrariamente en Supabase. La carga inicial remota está versionada en `api/migrations/001_sillage_catalog.sql`: inserta datos existentes del frontend por sus IDs conocidos, con el perfil JSONB y procedencia original. Los conflictos preservan registros previos; cambios posteriores requieren revisión explícita de las diferencias y una migración específica, no un upsert masivo que sobrescriba datos.

`npm run db:prepare -w api` regenera esa migración a partir de los archivos reales. No la aplica. En este proyecto ya se ejecutó por MCP después de inspeccionar el esquema vacío. Para otra base inspeccionar primero y adaptar nombres/relaciones. Los perfiles JSONB conservan los campos de la fuente, incluida la advertencia de verificación; no se asignan escalas numéricas cuando el documento solo usa texto.

Los scripts Python existentes apuntan ahora a `client/public/` y `api/data/`; conservan las rutas locales de las fotografías originales y no se ejecutan durante build o despliegue. No regenerar imágenes sin disponer de sus fuentes originales.
