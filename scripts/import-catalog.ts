import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalize,olfactorySchema } from '../src/types/catalog.js';
import { CatalogRepository } from '../src/repositories/catalog.js';
const apply=process.argv.includes('--apply');
const source=await readFile('../CATALOGO_PERFUMES_Y_FICHAS.md','utf8');
const hash=createHash('sha256').update(source).digest('hex');
const catalog=z.array(z.object({id:z.number().int(),brand:z.string(),name:z.string()})).parse(JSON.parse(await readFile('data/catalog.json','utf8')));
const fields:Record<string,string>={'Familia olfativa':'family','Salida':'opening','Corazón':'heart','Fondo':'base','A qué huele':'smell','Perfil':'profile','Ideal para':'occasion','Notas reportadas':'notes','Observación / verificación':'note'};
export function parseProfiles(markdown:string) {
  return [...markdown.matchAll(/^## (\d+)\. (.+?) — (.+?)\r?\n([\s\S]*?)(?=^## \d+\.|$(?![\s\S]))/gm)].map(match=>{
    const profile:Record<string,string>={};
    for(const line of match[4].split(/\r?\n/)) {const field=line.match(/^- \*\*(.+?):\*\*\s*(.+)$/);if(field&&fields[field[1]])profile[fields[field[1]]]=field[2].trim();}
    return {source_id:Number(match[1]),brand:match[2],name:match[3],profile:olfactorySchema.parse(profile),source_reference:`CATALOGO_PERFUMES_Y_FICHAS.md#${match[1]}`,source_hash:hash};
  });
}
const profiles=parseProfiles(source);
const sourceReview=profiles.filter(p=>!catalog.some(c=>c.id===p.source_id&&normalize(c.brand)===normalize(p.brand)&&normalize(c.name)===normalize(p.name)));
if(profiles.length!==118 || new Set(profiles.map(p=>p.source_id)).size!==118) throw new Error('La fuente no contiene 118 IDs únicos; no se importó nada.');
let products:Awaited<ReturnType<CatalogRepository['products']>>=[];
let remoteError:string|null=null;
try {products=await new CatalogRepository().products();} catch {remoteError='No se pudo leer el catálogo configurado.';}
const existing=z.array(z.object({source_id:z.number(),product_id:z.string(),verified:z.literal(true)})).parse(JSON.parse(await readFile('product-links.json','utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '[]';throw e;})));
const proposals=profiles.map(p=>{
  const matches=products.filter(row=>normalize(row.brand)===normalize(p.brand)&&normalize(row.name)===normalize(p.name));
  const approved=existing.find(l=>l.source_id===p.source_id && matches.some(row=>row.id===l.product_id));
  return {source_id:p.source_id,source_reference:p.source_reference,source_hash:hash,candidate_ids:matches.map(p=>p.id),status:approved?'verified':matches.length===1?'exact_requires_review':matches.length>1?'ambiguous':'unmatched'};
});
await mkdir('reports',{recursive:true});
await writeFile('reports/catalog-import.json',JSON.stringify({source_hash:hash,total:profiles.length,remote_error:remoteError,source_review:sourceReview.map(p=>({source_id:p.source_id,brand:p.brand,name:p.name})),proposals},null,2));
await writeFile('reports/profiles-normalized.json',JSON.stringify(profiles,null,2));
if(apply) {
  if(sourceReview.length) throw new Error('Hay identidades de fuente pendientes; revise reports/catalog-import.json.');
  const previous=z.record(z.string(),olfactorySchema).parse(JSON.parse(await readFile('data/olfactory.json','utf8')));
  // Preserve every existing profile; report proposed changes for manual review.
  for(const profile of profiles) if(!previous[profile.source_id]) previous[profile.source_id]=profile.profile;
  await writeFile('data/olfactory.json.tmp',JSON.stringify(previous,null,2));await rename('data/olfactory.json.tmp','data/olfactory.json');
}
console.log(JSON.stringify({total:profiles.length,identity_review:sourceReview.length,verified:proposals.filter(p=>p.status==='verified').length,report:'reports/catalog-import.json',applied:apply}));
