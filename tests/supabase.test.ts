import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CatalogRepository} from '../src/repositories/catalog.js';
import {env} from '../src/config/env.js';
test('Supabase adapter selects only mapped columns, publication filter and bounded requests; permission/network failures fail closed',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sillage-map-'));const mapping=join(dir,'mapping.json');
  writeFileSync(mapping,JSON.stringify({table:'existing_products',columns:{id:'pk',name:'title',brand:'brand',image:'photo',gender:'gender',olfactory:'olfactory'},published:{column:'is_live',value:true}}));
  const original={source:env.CATALOG_SOURCE,mapping:env.SUPABASE_CATALOG_MAPPING,key:env.SUPABASE_PUBLISHABLE_KEY,fetch:globalThis.fetch};
  env.CATALOG_SOURCE='supabase';env.SUPABASE_CATALOG_MAPPING=mapping;env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  try{
    let url='';globalThis.fetch=async(input:any)=>{url=String(input);return new Response(JSON.stringify([{pk:'real',title:'Existing perfume',brand:'Existing brand',photo:'/image.webp',gender:'unisex',units:0,price:null,olfactory:{smell:'real notes'},secret_cost:500}]),{status:200,headers:{'Content-Type':'application/json'}});};
    const repo=new CatalogRepository();const p=await repo.findPerfumeById('real');assert.equal((p as any).available,undefined);assert.equal((p as any).price,null);assert.equal((p as any).secret_cost,undefined);assert.ok(url.includes('is_live=eq.true'));assert.ok(url.includes('limit=200'));const selected=new URL(url).searchParams.get('select');assert.ok(!selected?.includes('*'));assert.ok(!selected?.includes('units'));assert.ok(!selected?.includes('price'));
    globalThis.fetch=async()=>new Response(JSON.stringify({code:'42501',message:'permission denied'}),{status:403,headers:{'Content-Type':'application/json'}});
    await assert.rejects(()=>new CatalogRepository().products(),(e:any)=>e.status===503);
    globalThis.fetch=async()=>{throw new TypeError('network unavailable');};await assert.rejects(()=>new CatalogRepository().products());
  }finally{env.CATALOG_SOURCE=original.source;env.SUPABASE_CATALOG_MAPPING=original.mapping;env.SUPABASE_PUBLISHABLE_KEY=original.key;globalThis.fetch=original.fetch;rmSync(dir,{recursive:true,force:true});}
});
