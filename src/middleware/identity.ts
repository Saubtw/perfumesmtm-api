import type { Request,Response,NextFunction } from 'express';
import { createHash,randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError,unavailable } from '../utils/errors.js';
import { supabaseClient } from '../integrations/supabase/client.js';
import type { SessionStore } from '../repositories/sessions.js';
export const ipKey=(req:Request)=>createHash('sha256').update(req.ip ?? req.socket.remoteAddress ?? 'unknown').digest('hex');
export const identify=(sessions:SessionStore)=>async(req:Request,res:Response,next:NextFunction)=>{
  try {
    await sessions.consume(`origin:${ipKey(req)}`,120,60000);
    if(env.COOKIE_SECRET.length<32) throw unavailable('COOKIE_SECRET (mínimo 32 caracteres)');
    let owner:string;
    if(req.headers.authorization) {
      if(!/^Bearer [^\s]+$/.test(req.headers.authorization)) throw new HttpError(401,'UNAUTHORIZED','Autenticación inválida.');
      const {data,error}=await supabaseClient().auth.getUser(req.headers.authorization.slice(7));
      if(error || !data.user) throw new HttpError(401,'UNAUTHORIZED','Autenticación inválida.');owner=`user:${data.user.id}`;
    } else {
      let visitor=req.signedCookies?.sillage_visitor;
      if(typeof visitor!=='string' || !/^[0-9a-f-]{36}$/.test(visitor)) {
        visitor=randomUUID();res.cookie('sillage_visitor',visitor,{signed:true,httpOnly:true,secure:env.NODE_ENV==='production',sameSite:env.COOKIE_SAME_SITE,path:'/api',maxAge:env.SESSION_RETENTION_DAYS*86400000});
      }
      owner=`anonymous:${visitor}`;
    }
    res.locals.owner=owner;next();
  } catch(error) {next(error);}
};
