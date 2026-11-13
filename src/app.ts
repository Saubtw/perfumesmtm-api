import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z,ZodError } from 'zod';
import { env } from './config/env.js';
import { CatalogRepository } from './repositories/catalog.js';
import { SessionRepository,type SessionStore } from './repositories/sessions.js';
import { SupabaseSessionRepository } from './repositories/supabase-sessions.js';
import { CloudAgent } from './integrations/openai/agent.js';
import { identify,ipKey } from './middleware/identity.js';
import { buildContext,contextSchema } from './services/context.js';
import { querySchema } from './types/catalog.js';
import { HttpError } from './utils/errors.js';
const idSchema=z.string().min(1).max(150);
export function createApp(dependencies?:{catalog:CatalogRepository;sessions:SessionStore;agent:CloudAgent}) {
  const catalog=dependencies?.catalog ?? new CatalogRepository();
  const sessions=dependencies?.sessions ?? (env.SUPABASE_SECRET_KEY ? new SupabaseSessionRepository() : new SessionRepository(env.SESSION_DB_PATH));
  const agent=dependencies?.agent ?? new CloudAgent(catalog,sessions);
  const app=express();app.disable('x-powered-by');app.set('trust proxy',env.TRUST_PROXY_HOPS);
  app.use(helmet(),cors({origin:env.CLIENT_ORIGIN,credentials:true}),express.json({limit:'16kb'}),cookieParser(env.COOKIE_SECRET));
  app.use('/api', async(req,res,next)=>{
    if(req.headers.origin && req.headers.origin!==env.CLIENT_ORIGIN) return next(new HttpError(403,'ORIGIN_DENIED','Origen no permitido.'));
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin!==env.CLIENT_ORIGIN) return next(new HttpError(403,'ORIGIN_REQUIRED','Se requiere un origen autorizado.'));
    res.setHeader('Cache-Control','no-store');
    try {await sessions.consume(`ip:${ipKey(req)}`,300,60000);next();} catch(error){next(error);}
  });
  app.get('/api/v1/health',(_req,res)=>res.json({status:'ok',catalog_source:env.CATALOG_SOURCE,session_store:env.SUPABASE_SECRET_KEY?'supabase':'sqlite',supabase_configured:!!env.SUPABASE_PUBLISHABLE_KEY,openai_configured:!!env.OPENAI_API_KEY&&!!env.OPENAI_AGENT_ID,chat_configured:env.COOKIE_SECRET.length>=32}));
  app.get(['/api/v1/perfumes','/api/v1/perfumes/search'],async(req,res)=>res.json(await catalog.findPublishedPerfumes(querySchema.parse(req.query))));
  app.get('/api/v1/perfumes/:id/related',async(req,res)=>res.json({items:await catalog.findRelatedPerfumes(idSchema.parse(req.params.id))}));
  app.get('/api/v1/perfumes/:id',async(req,res)=>{
    const p=await catalog.findPerfumeById(idSchema.parse(req.params.id));if(!p) throw new HttpError(404,'NOT_FOUND','Perfume inexistente.');res.json(p);
  });
  app.use('/api/v1/chat',identify(sessions));
  app.post('/api/v1/chat/sessions',async(_req,res)=>{
    agent.sdk();await sessions.consume(`sessions:${res.locals.owner}`,10,86400000);
    const s=await sessions.create(res.locals.owner,env.SESSION_RETENTION_DAYS);res.status(201).json({id:s.id,expires_at:s.expires_at});
  });
  app.get('/api/v1/chat/sessions/:id/messages',async(req,res)=>{
    const s=await sessions.owned(idSchema.parse(req.params.id),res.locals.owner);
    const query=z.object({after:z.string().max(200).optional()}).strict().parse(req.query);
    res.json(await agent.history(s.remote_id,query.after));
  });
  app.post('/api/v1/chat/sessions/:id/cancel',async(req,res)=>{
    const s=await sessions.owned(idSchema.parse(req.params.id),res.locals.owner);if(s.remote_id) await agent.cancel(s.remote_id);res.sendStatus(204);
  });
  app.delete('/api/v1/chat/sessions/:id',async(req,res)=>{
    const s=await sessions.owned(idSchema.parse(req.params.id),res.locals.owner);
    if(s.busy_until>Date.now()) throw new HttpError(409,'SESSION_BUSY','Espera a que termine la respuesta para iniciar otro chat.');
    if(s.remote_id) await agent.remove(s.remote_id);await sessions.remove(s.id);res.sendStatus(204);
  });
  // One message endpoint. Accept: text/event-stream opts into streaming.
  app.post('/api/v1/chat/sessions/:id/messages',async(req,res,next)=>{
    let acquired=false;let sessionId='';let heartbeat:ReturnType<typeof setInterval>|undefined;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),env.CHAT_TIMEOUT_MS);
    const disconnect=()=>{if(!res.writableEnded) controller.abort();};res.on('close',disconnect);
    try {
      const body=z.object({message:z.string().trim().min(1).max(env.CHAT_MAX_MESSAGE_LENGTH),context:contextSchema.optional()}).strict().parse(req.body);
      const s=await sessions.owned(idSchema.parse(req.params.id),res.locals.owner);sessionId=s.id;
      await sessions.consume(`minute:${res.locals.owner}`,env.CHAT_RATE_LIMIT_PER_MINUTE,60000);
      await sessions.consume(`daily:${res.locals.owner}`,env.CHAT_MAX_MESSAGES_PER_VISITOR_DAY,86400000);
      await sessions.acquire(s.id,env.CHAT_MAX_MESSAGES_PER_SESSION,env.CHAT_TIMEOUT_MS+20000);acquired=true;
      const context=await buildContext(body.context,req.ip ?? '',catalog,req.headers);
      const streaming=req.get('accept')==='text/event-stream';
      if(streaming) {res.set({'Content-Type':'text/event-stream','X-Accel-Buffering':'no',Connection:'keep-alive'});res.flushHeaders();heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);}
      const result=await agent.run(s,body.message,context,(type,data)=>{if(streaming&&!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);},controller.signal);
      await sessions.release(s.id);acquired=false;
      if(streaming) res.end();else res.json(result);
    } catch(error) {
      if(res.headersSent) {if(!res.destroyed) {res.write(`event: error\ndata: ${JSON.stringify({code:error instanceof HttpError?error.code:'AGENT_UNAVAILABLE',message:'No se pudo completar la respuesta. Cierra y vuelve a abrir el asesor para continuar.'})}\n\n`);res.end();}}
      else next(error);
    } finally {clearTimeout(timer);if(heartbeat) clearInterval(heartbeat);res.off('close',disconnect);if(acquired) {try {await sessions.release(sessionId);}catch{console.error('{"event":"session_release_failed"}');}}}
  });
  app.use((_req,_res,next)=>next(new HttpError(404,'NOT_FOUND','Ruta inexistente.')));
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const status=error instanceof ZodError||error.type==='entity.parse.failed'?400:error instanceof HttpError?error.status:error.type==='entity.too.large'?413:500;
    const code=status===400?'INVALID_INPUT':error instanceof HttpError?error.code:status===413?'BODY_TOO_LARGE':'INTERNAL_ERROR';
    if(status>=500) console.error(JSON.stringify({event:'request_error',code,status}));
    if(status===429) res.set('Retry-After','60');
    res.status(status).json({error:{code,message:error instanceof HttpError?error.message:status===400?'Solicitud inválida.':'Servicio temporalmente no disponible.'}});
  });
  return {app,sessions,agent};
}
