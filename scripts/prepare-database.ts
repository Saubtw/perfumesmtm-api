import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const products=JSON.parse(await readFile('data/catalog.json','utf8'));
const profiles=JSON.parse(await readFile('data/olfactory.json','utf8'));
const hash=createHash('sha256').update(await readFile('../CATALOGO_PERFUMES_Y_FICHAS.md')).digest('hex');
const quote=(value:unknown)=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const values=products.map((p:any)=>`(${[String(p.id),p.id,p.name,p.brand,p.gender,p.image,JSON.stringify(profiles[p.id]??{}),`CATALOGO_PERFUMES_Y_FICHAS.md#${p.id}`,hash,true].map(quote).join(',')})`).join(',\n');
await mkdir('migrations',{recursive:true});
await writeFile('migrations/001_sillage_catalog.sql',`-- Prepared locally; NOT applied. Inspect actual database first using docs/inspect-supabase.sql.
-- Dedicated namespace in public avoids changing existing inventory tables.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sillage_products (
 id text PRIMARY KEY, display_index integer UNIQUE NOT NULL, name text NOT NULL, brand text NOT NULL,
 gender text NOT NULL CHECK(gender IN ('masculino','femenino','unisex')), image_url text NOT NULL,
 published boolean NOT NULL DEFAULT false,
 stock integer CHECK(stock>=0), price numeric(12,2) CHECK(price>=0), currency text,
 olfactory jsonb NOT NULL DEFAULT '{}'::jsonb, source_reference text NOT NULL, source_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.sillage_products.stock IS 'NULL means unknown. Never infer inventory from a photograph.';
ALTER TABLE public.sillage_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sillage_products FROM anon, authenticated;
GRANT SELECT (id,display_index,name,brand,gender,image_url,published,stock,price,currency,olfactory) ON public.sillage_products TO anon, authenticated;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sillage_products' AND policyname='sillage_public_read') THEN
 CREATE POLICY sillage_public_read ON public.sillage_products FOR SELECT TO anon,authenticated USING(published=true);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS sillage_products_published_brand ON public.sillage_products(published,brand);
CREATE INDEX IF NOT EXISTS sillage_products_olfactory ON public.sillage_products USING gin(olfactory);
INSERT INTO public.sillage_products(id,display_index,name,brand,gender,image_url,olfactory,source_reference,source_hash,published) VALUES
${values}
ON CONFLICT(id) DO NOTHING;
-- Existing stock, prices, profiles and publication states are preserved on every rerun.
COMMIT;
`);
await writeFile('catalog-mapping.sillage.example.json',JSON.stringify({table:'sillage_products',columns:{id:'id',name:'name',brand:'brand',image:'image_url',gender:'gender',display_index:'display_index',olfactory:'olfactory'},published:{column:'published',value:true}},null,2));
await writeFile('product-links.sillage.example.json',JSON.stringify(products.map((p:any)=>({source_id:p.id,product_id:String(p.id),verified:true})),null,2));
console.log('Prepared migrations/001_sillage_catalog.sql; no remote changes. Stock and prices remain NULL.');
