import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudAgent} from '../src/integrations/openai/agent.js';
import {CatalogRepository} from '../src/repositories/catalog.js';
import {SessionRepository} from '../src/repositories/sessions.js';
function mockClient(events:any[]) {
  const submitted:any[]=[];let created=0;
  const stream=()=>({controller:new AbortController(),async *[Symbol.asyncIterator](){for(const event of events)yield event;}});
  const client:any={beta:{agents:{retrieve:async()=>({name:'Perfume AI Advisor',model:'gpt-6.1-sol',instructions:'Saved instructions'}),sessions:{
    create:async(body:any)=>{created++;assert.ok(body.agent_id!==undefined);assert.equal(body.agent.multi_agent.enabled,false);assert.ok(body.agent.tools.some((t:any)=>t.name==='search_catalog'));return stream();},
    retrieve:async()=>({metadata:{advisor_policy:'catalog-v3'},required_actions:[{type:'function_call',name:'get_perfume_details',arguments:{id:'9'},call_id:'call1',turn_id:'turn1'}]}),update:async()=>({}),
    events:{stream:async()=>stream(),create:async(_id:string,body:any)=>{submitted.push(body);}},
    items:{list:async()=>({data:[],has_more:false})},delete:async()=>({deleted:true})
  }}}};return {client,submitted,get created(){return created;}};
}
test('saved cloud agent session is persisted, tools are resolved, done text replaces deltas, followup reuses remote',async()=>{
  const sessions=new SessionRepository(':memory:'),catalog=new CatalogRepository(),s=sessions.create('owner',7);
  const mock=mockClient([
    {type:'agent.session.created',session:{id:'remote1'}},
    {type:'agent.session.turn.output_text.delta',item_id:'msg1',content_index:0,delta:'Hi'},
    {type:'agent.session.requires_action'},
    {type:'agent.session.turn.output_text.done',item_id:'msg1',content_index:0,text:'Hola.'},
    {type:'agent.session.turn.completed',turn:{subagent_id:null},usage:{total_tokens:123}}
  ]);
  try{const agent=new CloudAgent(catalog,sessions,mock.client);const output:any[]=[];const result=await agent.run(s,'hola',{},(type,data)=>output.push({type,data}),new AbortController().signal);
    assert.equal(result.text,'Hola.');assert.equal(sessions.owned(s.id,'owner').remote_id,'remote1');
    const toolResult=mock.submitted.find(x=>x.events[0].type==='agent.session.input.tool_result');assert.equal(JSON.parse(toolResult.events[0].output).name,'Asad');
    await agent.run(sessions.owned(s.id,'owner'),'siguiente',{},()=>{},new AbortController().signal);assert.equal(mock.created,1);assert.ok(mock.submitted.some(x=>x.events[0].type==='agent.session.input.message'));assert.ok(output.some(x=>x.type==='complete'));
  }finally{sessions.db.close();}
});
test('closed stream, lifecycle failures and unsupported pending actions fail safely and cancel',async()=>{
  for(const event of [null,{type:'agent.session.turn.failed',turn:{subagent_id:null}},{type:'error',error:{message:'private upstream detail'}}]){
    const sessions=new SessionRepository(':memory:'),s=sessions.create('a',7);sessions.remote(s.id,'remote');
    const mock=mockClient(event?[event]:[]),agent=new CloudAgent(new CatalogRepository(),sessions,mock.client);
    try{await assert.rejects(()=>agent.run(sessions.owned(s.id,'a'),'hello',{},()=>{},new AbortController().signal));assert.ok(mock.submitted.some(x=>x.events[0].type==='agent.session.input.cancel'));}finally{sessions.db.close();}
  }
});
