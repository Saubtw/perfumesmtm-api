import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {env} from '../src/config/env.js';
import {CatalogRepository} from '../src/repositories/catalog.js';
import {SupabaseSessionRepository} from '../src/repositories/supabase-sessions.js';
import {CloudAgent} from '../src/integrations/openai/agent.js';
import assert from 'node:assert/strict';
const catalog=new CatalogRepository();const products=await catalog.products(true);
assert.equal(env.CATALOG_SOURCE,'supabase');assert.equal(products.length,118);assert.ok(products.every(p=>p.olfactory));
const publicClient=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
const privateRead=await publicClient.from('sillage_chat_sessions').select('id').limit(1);assert.ok(privateRead.error);
// A nonexistent primary key guarantees this probe cannot change a real catalog record.
const write=await publicClient.from('sillage_products').update({name:'permission probe'}).eq('id','__sillage_nonexistent_permission_probe__');assert.ok(write.error);
const rpc=await publicClient.rpc('sillage_consume_quota',{p_key:'not-permitted',p_now:Date.now(),p_expires:Date.now()+1000});assert.ok(rpc.error);
const sessions=new SupabaseSessionRepository(),owner=`smoke:${randomUUID()}`,s=await sessions.create(owner,1);
let agent:CloudAgent|undefined;
try {
  await assert.rejects(()=>sessions.owned(s.id,'different-owner'));await sessions.acquire(s.id,2,60000);await assert.rejects(()=>sessions.acquire(s.id,2,60000));await sessions.release(s.id);
  const restarted=new SupabaseSessionRepository();assert.equal((await restarted.owned(s.id,owner)).id,s.id);
  if(process.argv.includes('--ai')) {
    agent=new CloudAgent(catalog,sessions);
    const result=await agent.run(s,'Recomiéndame dos perfumes con coco sin tabaco y explica por qué encajan.',{locale:'es-MX'},()=>{},AbortSignal.timeout(90000));
    assert.ok(result.text);assert.ok(result.recommendations.length>0);assert.ok(result.recommendations.every(p=>products.some(real=>real.id===p.id)));
    const reloaded=await restarted.owned(s.id,owner);assert.ok(reloaded.remote_id);const history=await agent.history(reloaded.remote_id);assert.ok(history.messages.length>=2);
    assert.ok(result.recommendations.every(p=>!!p.reason&&!('available' in p)));assert.doesNotMatch(result.text,/disponibilidad|existencias|stock|carrito|comprar/i);
    const followup=await agent.run(reloaded,'¿Qué nota te pedí evitar?',{},()=>{},AbortSignal.timeout(90000));assert.match(followup.text,/tabaco/i);assert.doesNotMatch(followup.text,/disponibilidad|existencias|stock|carrito|comprar/i);
    console.log(JSON.stringify({agent:'connected',cards:result.recommendations.map(p=>({id:p.id,name:p.name,reason:p.reason})),history:history.messages.length,resume:'passed'}));
  }
  console.log(JSON.stringify({supabase:'connected',products:products.length,profiles:products.filter(p=>p.olfactory).length,public_write:'denied',private_read:'denied',private_rpc:'denied',sessions:'persistent and isolated'}));
}finally{const latest=await sessions.owned(s.id,owner);if(latest.remote_id&&agent)await agent.remove(latest.remote_id);await sessions.remove(s.id);}
