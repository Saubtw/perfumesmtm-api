import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CatalogRepository,mappingSchema} from '../src/repositories/catalog.js';
import {querySchema} from '../src/types/catalog.js';
import {CatalogTools} from '../src/services/tools.js';
test('catalog publishes only the 16 commercial references and preserves all other products',async()=>{
  const repo=new CatalogRepository();const page=await repo.findPublishedPerfumes(querySchema.parse({limit:10,page:2}));assert.equal(page.total,16);assert.equal(page.items.length,6);
  assert.ok(page.items.every(p=>!('available' in p)&&Number.isInteger(p.price)&&p.olfactory));assert.equal((await repo.findPerfumeById('44'))?.name,'212 VIP Black');assert.equal(await repo.findPerfumeById('9'),null);
  assert.equal((await repo.allArchiveProducts()).length,119);assert.equal((await repo.findPerfumeById('119'))?.name,'Coco Mademoiselle Intense');
  assert.ok((await repo.findRelatedPerfumes('44')).length>0);assert.throws(()=>querySchema.parse({available:'true'}));
});
test('search, gender, notes, rejected note, warm/cold profiles and exact brand filtering',async()=>{
  const repo=new CatalogRepository();
  assert.equal((await repo.searchPerfumes(querySchema.parse({q:'sauvage'}))).total,0);
  assert.equal((await repo.findPublishedPerfumes(querySchema.parse({gender:'femenino'}))).total,4);
  for(const filter of [{note:'vainilla'},{note:'lavanda'},{occasion:'calor'},{occasion:'frío'},{profile:'frescura alta'},{profile:'dulzor alto'}]) assert.ok((await repo.findPublishedPerfumes(querySchema.parse(filter))).total>0);
  const without=await repo.findPublishedPerfumes(querySchema.parse({note:'vainilla',exclude_note:'tabaco',limit:120}));
  assert.ok(without.total>0);assert.ok(without.items.every(p=>![p.olfactory?.opening,p.olfactory?.heart,p.olfactory?.base,p.olfactory?.notes].join(' ').includes('tabaco')));
  assert.ok((await repo.findPublishedPerfumes(querySchema.parse({brand:'Afnan'}))).items.every(p=>p.brand==='Afnan'));
});
test('bounded validation rejects SQL-like identifiers, unknown query options and excessive retrieval',()=>{
  assert.throws(()=>querySchema.parse({limit:1000}));assert.throws(()=>querySchema.parse({sql:'select *'}));assert.throws(()=>mappingSchema.parse({table:'products;drop table users',columns:{},published:{column:'x',value:true}}));
});
test('recommendations verify identity, explain the match and have no inventory dependency',async()=>{
  const tools=new CatalogTools(new CatalogRepository());await assert.rejects(()=>tools.execute('execute_sql',{}));await assert.rejects(()=>tools.execute('get_perfume_details',{id:'44',price:1}));
  await tools.execute('present_recommendations',{ids:['44','9','fabricated'],reasons:{'44':'Combina vainilla con un perfil especiado para la noche.'},follow_up:'¿Qué ocasión tienes en mente?'});assert.equal(tools.recommendations.length,1);assert.equal(tools.recommendations[0].id,'44');assert.equal(tools.recommendations[0].reason,'Combina vainilla con un perfil especiado para la noche.');assert.deepEqual(Object.keys(tools.recommendations[0]).sort(),['detail_url','id','image','name','reason']);assert.ok(tools.followUp);
  await assert.rejects(()=>tools.execute('check_availability',{id:'44'}));
  const candidates=await tools.execute('search_catalog',{note:'lavanda'}) as any;assert.ok(candidates.items.length>0);assert.ok(candidates.items.every((p:any)=>!('available' in p)));
});
