import { z } from 'zod';
import type { AgentToolParam } from 'openai/resources/beta/agents/agents';
import { querySchema, type Recommendation } from '../types/catalog.js';
import { CatalogRepository } from '../repositories/catalog.js';
const id=z.string().min(1).max(150);
export const toolSchemas = {
  search_catalog: z.object({ q:z.string().max(120).optional(),note:z.string().max(80).optional(),exclude_note:z.string().max(80).optional(),family:z.string().max(80).optional(),occasion:z.string().max(80).optional(),profile:z.string().max(80).optional(),gender:z.enum(['masculino','femenino','unisex']).optional() }).strict(),
  get_perfume_details:z.object({id}).strict(), compare_perfumes:z.object({ids:z.array(id).min(2).max(4)}).strict(),
  get_similar_perfumes:z.object({id}).strict(),
  present_recommendations:z.object({ids:z.array(id).max(4),reasons:z.record(id,z.string().trim().min(1).max(350)).optional(),follow_up:z.string().max(300).nullable()}).strict()
};
const descriptions:Record<string,string>={
  search_catalog:'Busca hasta seis perfumes publicados por notas, familia, ocasión, perfil o género. q busca nombre/marca; usa filtros breves, no toda la petición como q. Todos los perfumes registrados pueden recomendarse.',
  get_perfume_details:'Consulta ficha real por ID; conserva advertencias de verificación.',compare_perfumes:'Compara de dos a cuatro referencias reales.',
  get_similar_perfumes:'Busca alternativas del catálogo por afinidad de familia olfativa.',
  present_recommendations:'Selecciona hasta cuatro IDs reales y reasons: un mapa de ID a explicación breve de por qué encaja con la petición. Añade una pregunta de seguimiento cuando sea útil. Las tarjetas solo enlazan a la ficha del catálogo.'
};
export const toolDefinitions:AgentToolParam[]=Object.entries(toolSchemas).map(([name,schema])=>({type:'function',name,description:descriptions[name],parameters:z.toJSONSchema(schema) }));
export class CatalogTools {
  recommendations:Recommendation[]=[]; followUp:string|null=null;
  constructor(private catalog:CatalogRepository) {}
  async execute(name:string,args:unknown) {
    if(!Object.hasOwn(toolSchemas,name)) throw new Error('Herramienta no permitida');
    const parsed=toolSchemas[name as keyof typeof toolSchemas].parse(args) as any;
    switch(name) {
      case 'search_catalog': {
        return this.catalog.findPublishedPerfumes(querySchema.parse({...parsed,limit:6}));
      }
      case 'get_perfume_details': return this.catalog.findPerfumeById(parsed.id);
      case 'compare_perfumes': return Promise.all(parsed.ids.map((value:string)=>this.catalog.findPerfumeById(value)));
      case 'get_similar_perfumes': return this.catalog.findRelatedPerfumes(parsed.id);
      case 'present_recommendations': {
        // Verify catalog identity; images and links always come from real records.
        const products=await Promise.all([...new Set<string>(parsed.ids)].map(value=>this.catalog.findPerfumeById(value,true)));
        this.recommendations=products.flatMap(p=>p ? [{id:p.id,name:p.name,image:p.image,detail_url:p.detail_url,reason:parsed.reasons?.[p.id] ?? p.olfactory?.smell?.slice(0,300) ?? 'Consulta sus notas y perfil olfativo en la ficha.'}] : []);
        this.followUp=parsed.follow_up;
        return {products:this.recommendations,follow_up:this.followUp};
      }
    }
  }
}
