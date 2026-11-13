import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import {env} from '../src/config/env.js';
import {SessionRepository} from '../src/repositories/sessions.js';
import {CatalogRepository} from '../src/repositories/catalog.js';
import {CloudAgent} from '../src/integrations/openai/agent.js';
import {createApp} from '../src/app.js';
import {buildContext} from '../src/services/context.js';
env.COOKIE_SECRET='test-only-secret-with-more-than-32-characters';
test('session owner isolation, persistent quotas, locks and restart recovery',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sillage-')),path=join(dir,'sessions.sqlite');let store=new SessionRepository(path);
  try{const s=store.create('a',7);store.remote(s.id,'remote_123');assert.throws(()=>store.owned(s.id,'b'));store.consume('a',1,60000);store.acquire(s.id,2,60000);assert.throws(()=>store.acquire(s.id,2,60000));store.release(s.id);store.db.close();store=new SessionRepository(path);assert.equal(store.owned(s.id,'a').remote_id,'remote_123');assert.throws(()=>store.consume('a',1,60000));store.close(s.id);assert.throws(()=>store.owned(s.id,'a'));}finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP security, validation, session ID guessing and signed-cookie ownership',async()=>{
  const sessions=new SessionRepository(':memory:'),catalog=new CatalogRepository();const agent=new CloudAgent(catalog,sessions,{} as any);const {app}=createApp({sessions,catalog,agent});
  try{
    await request(app).get('/api/v1/health').expect(200);await request(app).get('/api/v1/perfumes?limit=1000').expect(400);await request(app).get('/api/v1/perfumes/no-such-product').expect(404);
    await request(app).get('/api/v1/perfumes').set('Origin','https://evil.example').expect(403);
    await request(app).post('/api/v1/chat/sessions').send({}).expect(403);
    await request(app).get('/api/v1/chat/sessions/no-session/messages').set('Authorization','Malformed').expect(401);
    await request(app).post('/api/v1/chat/sessions').set('Origin',env.CLIENT_ORIGIN).set('Content-Type','application/json').send('{invalid').expect(400);
    const a=request.agent(app),b=request.agent(app);const result=await a.post('/api/v1/chat/sessions').set('Origin',env.CLIENT_ORIGIN).send({}).expect(201);const id=result.body.id;
    await a.get(`/api/v1/chat/sessions/${id}/messages`).expect(200);await b.get(`/api/v1/chat/sessions/${id}/messages`).expect(404);
    await request(app).get(`/api/v1/chat/sessions/${id}/messages`).set('Cookie','sillage_visitor=forged').expect(404);
    await a.post(`/api/v1/chat/sessions/${id}/messages`).set('Origin',env.CLIENT_ORIGIN).send({message:'x'.repeat(2001)}).expect(400);
    await a.post(`/api/v1/chat/sessions/${id}/messages`).set('Origin',env.CLIENT_ORIGIN).send({message:'hi',visitorId:'b'}).expect(400);
    await request(app).post('/api/v1/perfumes').set('Origin',env.CLIENT_ORIGIN).send({stock:100}).expect(404);
    await request(app).get('/api/v1/perfumes/9/availability').expect(404);
  }finally{sessions.db.close();}
});
test('invalid timezone and unknown current product cannot poison context; forged geo headers ignored',async()=>{
  const c=await buildContext({timezone:'Fake/Zone',current_product_id:'missing',current_page:'https://evil.example'},'127.0.0.1',new CatalogRepository(),{'cf-ipcity':'Torreón'});
  assert.equal(c.datetime.timezone,'UTC');assert.equal(c.current_product_id,null);assert.equal(c.location,null);assert.equal(c.weather,null);assert.equal(c.current_page,'/');
});
