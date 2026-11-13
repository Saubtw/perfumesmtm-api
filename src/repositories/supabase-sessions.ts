import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {env} from '../config/env.js';
import {HttpError,unavailable} from '../utils/errors.js';
import type {Session,SessionStore} from './sessions.js';
// This client is NEVER used for public catalog queries or exposed to the model.
export class SupabaseSessionRepository implements SessionStore {
  client:SupabaseClient;
  constructor(){this.client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});}
  async create(owner:string,days:number):Promise<Session> {
    const id=randomUUID(),now=Date.now();
    const {data,error}=await this.client.rpc('sillage_create_chat_session',{p_id:id,p_owner:owner,p_now:now,p_expires:now+days*86400000});
    if(error) {if(error.message.includes('SESSION_LIMIT'))throw new HttpError(429,'SESSION_LIMIT','Límite de conversaciones activas alcanzado.');throw unavailable('Almacenamiento de conversaciones');}
    return data as Session;
  }
  async owned(id:string,owner:string):Promise<Session> {
    const {data,error}=await this.client.from('sillage_chat_sessions').select('id,owner,remote_id,expires_at,messages,busy_until,status').eq('id',id).eq('owner',owner).eq('status','active').gt('expires_at',Date.now()).maybeSingle();
    if(error)throw unavailable('Almacenamiento de conversaciones');if(!data)throw new HttpError(404,'SESSION_NOT_FOUND','Conversación inexistente o expirada.');return data;
  }
  private async update(id:string,value:Record<string,unknown>){const {error}=await this.client.from('sillage_chat_sessions').update(value).eq('id',id);if(error)throw unavailable('Almacenamiento de conversaciones');}
  async remote(id:string,remote:string){await this.update(id,{remote_id:remote,updated_at:Date.now()});}
  async acquire(id:string,max:number,timeout:number){const now=Date.now();const {data,error}=await this.client.rpc('sillage_acquire_chat_session',{p_id:id,p_now:now,p_busy_until:now+timeout,p_max:max});if(error)throw unavailable('Almacenamiento de conversaciones');if(!data)throw new HttpError(409,'SESSION_BUSY_OR_LIMIT','La conversación está ocupada o alcanzó su límite.');}
  async release(id:string){await this.update(id,{busy_until:0});}
  async close(id:string){await this.update(id,{status:'deleted'});}
  async consume(key:string,limit:number,period:number){const now=Date.now();const {data,error}=await this.client.rpc('sillage_consume_quota',{p_key:key,p_now:now,p_expires:now+period});if(error)throw unavailable('Límites de uso');if(Number(data)>limit)throw new HttpError(429,'RATE_LIMIT','Demasiadas solicitudes. Intenta más tarde.');}
  async log(id:string,latency:number,tokens:number|null,error:string|null){const {error:failure}=await this.client.from('sillage_chat_usage').insert({session_id:id,created_at:Date.now(),latency_ms:latency,tokens,error_code:error});if(failure)console.error('{"event":"usage_log_failed"}');}
  async expired():Promise<Session[]>{const now=Date.now();const {data,error}=await this.client.from('sillage_chat_sessions').select('id,owner,remote_id,expires_at,messages,busy_until,status').or(`expires_at.lte.${now},status.eq.deleted`).lt('busy_until',now).limit(100);if(error)throw unavailable('Limpieza de conversaciones');return data??[];}
  async remove(id:string){const {error}=await this.client.from('sillage_chat_sessions').delete().eq('id',id);if(error)throw unavailable('Almacenamiento de conversaciones');}
  async cleanupQuotas(){const {error}=await this.client.from('sillage_chat_quotas').delete().lte('expires_at',Date.now());if(error)throw unavailable('Limpieza de límites');}
  destroy(){}
}
