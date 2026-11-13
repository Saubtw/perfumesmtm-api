import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { env } from '../config/env.js';
import { supabaseClient } from '../integrations/supabase/client.js';
import { HttpError, unavailable } from '../utils/errors.js';
import { normalize, safeImage, olfactorySchema, type Product, type CatalogQuery } from '../types/catalog.js';

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
export const mappingSchema = z.object({ table: identifier, columns: z.object({
  id: identifier, name: identifier, brand: identifier, image: identifier, gender: identifier,
  slug: identifier.optional(), display_index: identifier.optional(), olfactory: identifier.optional()
}).strict(), published: z.object({ column: identifier, value: z.union([z.boolean(),z.string(),z.number()]) }) }).strict();
const archiveSchema = z.array(z.object({ id: z.number().int(), name:z.string(), brand:z.string(), house:z.string(), gender:z.string(), image:z.string() }));
type Link = {source_id: number; product_id: string; verified: true};
export class CatalogRepository {
  private cache?: { until: number; products: Product[] };
  async products(fresh = false): Promise<Product[]> {
    if (!fresh && this.cache && this.cache.until > Date.now()) return this.cache.products;
    const details = z.record(z.string(), olfactorySchema).parse(JSON.parse(await readFile(new URL('../../data/olfactory.json', import.meta.url),'utf8')));
    let products: Product[];
    if (env.CATALOG_SOURCE === 'archive') {
      const rows = archiveSchema.parse(JSON.parse(await readFile(new URL('../../data/catalog.json', import.meta.url),'utf8')));
      products = rows.map(row => ({ ...row, id: String(row.id), display_index: row.id, slug: normalize(`${row.brand} ${row.name}`).replaceAll(' ','-'),
        olfactory:details[row.id] ?? null, detail_url:`/#perfume=${encodeURIComponent(row.id)}` }));
    } else {
      if (!env.SUPABASE_CATALOG_MAPPING) throw unavailable('Mapeo del catálogo Supabase');
      const mapping = mappingSchema.parse(JSON.parse(await readFile(env.SUPABASE_CATALOG_MAPPING,'utf8')));
      const c = mapping.columns;
      const links = z.array(z.object({source_id:z.number().int(), product_id:z.string(), verified:z.literal(true)})).parse(
        JSON.parse(await readFile('./product-links.json','utf8').catch((e: NodeJS.ErrnoException) => { if(e.code === 'ENOENT') return '[]'; throw e; }))
      ) as Link[];
      if(new Set(links.map(l=>l.product_id)).size !== links.length || new Set(links.map(l=>l.source_id)).size !== links.length) throw unavailable('Vínculos olfativos duplicados');
      const client = supabaseClient();
      const rows: Record<string,any>[] = [];
      // Bounded chunks: never select *, never expose arbitrary tables or filters to clients.
      for (let offset=0; offset<10000; offset+=200) {
        const {data,error} = await client.from(mapping.table).select([...new Set(Object.values(c))].join(',')).eq(mapping.published.column,mapping.published.value).order(c.display_index ?? c.id).range(offset,offset+199);
        if(error) throw new HttpError(503,'CATALOG_UNAVAILABLE','No fue posible consultar el catálogo público.');
        rows.push(...(data as unknown as Record<string,any>[]));
        if(!data || data.length<200) break;
        if(offset === 9800) throw unavailable('Catálogo supera el límite de recuperación');
      }
      products = rows.map((row,index) => {
        const id = String(row[c.id]); const link = links.find(l=>l.product_id===id);
        const slug = c.slug && typeof row[c.slug]==='string' ? row[c.slug] : id;
        return {id, display_index: c.display_index && Number.isInteger(row[c.display_index]) ? row[c.display_index] : link?.source_id ?? index+1,
          slug, name:z.string().parse(row[c.name]), brand:z.string().parse(row[c.brand]), house:row[c.brand], gender:z.string().parse(row[c.gender]),
          image:safeImage(z.string().parse(row[c.image])),
          detail_url:`/#perfume=${encodeURIComponent(id)}`, olfactory:c.olfactory ? olfactorySchema.parse(row[c.olfactory]) : link ? details[link.source_id] ?? null : null};
      });
    }
    // Match identities, never workbook row positions: source ordering differs from the catalog.
    const prices = z.array(z.object({brand:z.string(),name:z.string(),price:z.number().int().positive()})).parse(
      JSON.parse(await readFile(new URL('../../data/pricing.json', import.meta.url),'utf8')));
    const priceByIdentity = new Map(prices.map(row=>[normalize(`${row.brand} ${row.name}`),row.price]));
    products = products.map(product=>({...product,price:priceByIdentity.get(normalize(`${product.brand} ${product.name}`)) ?? null}));
    this.cache={until:Date.now()+30000,products}; return products;
  }
  async findPublishedPerfumes(query: CatalogQuery) {
    let items = await this.products();
    const contains = (text: string, value?: string) => !value || normalize(text).includes(normalize(value));
    items = items.filter(p => contains(`${p.name} ${p.brand}`,query.q) && (!query.brand || p.brand===query.brand) && (!query.gender || p.gender===query.gender)
      && contains([p.olfactory?.opening,p.olfactory?.heart,p.olfactory?.base,p.olfactory?.notes].join(' '),query.note)
      && (!query.exclude_note || (p.olfactory && !contains([p.olfactory.opening,p.olfactory.heart,p.olfactory.base,p.olfactory.notes].join(' '),query.exclude_note)))
      && contains(p.olfactory?.family ?? '',query.family) && contains(p.olfactory?.occasion ?? '',query.occasion) && contains(p.olfactory?.profile ?? '',query.profile));
    if(query.sort!=='default') items=[...items].sort((a,b)=>a.name.localeCompare(b.name,'es')*(query.sort==='za'?-1:1));
    const total=items.length; return {items:items.slice((query.page-1)*query.limit,query.page*query.limit),total,page:query.page,limit:query.limit,source:env.CATALOG_SOURCE};
  }
  async findPerfumeById(id: string, fresh=false) { return (await this.products(fresh)).find(p=>p.id===id) ?? null; }
  async findPerfumeBySlug(slug: string) { return (await this.products()).find(p=>p.slug===slug) ?? null; }
  searchPerfumes(query: CatalogQuery) { return this.findPublishedPerfumes(query); }
  async getOlfactoryProfile(id:string) { return (await this.findPerfumeById(id))?.olfactory ?? null; }
  async findRelatedPerfumes(id:string) {
    const product=await this.findPerfumeById(id); if(!product) throw new HttpError(404,'NOT_FOUND','Perfume inexistente.');
    const words=new Set(normalize(product.olfactory?.family ?? '').split(' ').filter(x=>x.length>3));
    return (await this.products()).filter(p=>p.id!==id).map(p=>({p,score:normalize(p.olfactory?.family ?? '').split(' ').filter(x=>words.has(x)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4).map(x=>x.p);
  }
}
