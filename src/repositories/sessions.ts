import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/errors.js';
export type Session = {id:string;owner:string;remote_id:string|null;expires_at:number;messages:number;busy_until:number;status:string};
type MaybePromise<T>=T|Promise<T>;
export interface SessionStore {
  create(owner:string,days:number):MaybePromise<Session>;owned(id:string,owner:string):MaybePromise<Session>;
  remote(id:string,remote:string):MaybePromise<unknown>;acquire(id:string,max:number,timeout:number):MaybePromise<unknown>;
  release(id:string):MaybePromise<unknown>;close(id:string):MaybePromise<unknown>;consume(key:string,limit:number,period:number):MaybePromise<unknown>;
  log(id:string,latency:number,tokens:number|null,error:string|null):MaybePromise<unknown>;expired():MaybePromise<Session[]>;
  remove(id:string):MaybePromise<unknown>;cleanupQuotas():MaybePromise<unknown>;destroy():void;
}
export class SessionRepository implements SessionStore {
  db:DatabaseSync;
  constructor(path:string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL,remote_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,messages INTEGER NOT NULL DEFAULT 0,busy_until INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active');
      CREATE INDEX IF NOT EXISTS session_owner ON sessions(owner);
      CREATE TABLE IF NOT EXISTS quotas(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL,created_at INTEGER NOT NULL,latency_ms INTEGER NOT NULL,tokens INTEGER,error_code TEXT);`);
  }
  create(owner:string,days:number) {
    const active=this.db.prepare('SELECT count(*) AS n FROM sessions WHERE owner=? AND expires_at>? AND status=?').get(owner,Date.now(),'active') as {n:number};
    if(active.n>=5) throw new HttpError(429,'SESSION_LIMIT','Límite de conversaciones activas alcanzado.');
    const id=randomUUID(),now=Date.now();
    this.db.prepare('INSERT INTO sessions(id,owner,created_at,updated_at,expires_at) VALUES(?,?,?,?,?)').run(id,owner,now,now,now+days*86400000);
    return this.owned(id,owner);
  }
  owned(id:string,owner:string):Session {
    const row=this.db.prepare('SELECT * FROM sessions WHERE id=? AND owner=? AND expires_at>? AND status=?').get(id,owner,Date.now(),'active') as Session|undefined;
    if(!row) throw new HttpError(404,'SESSION_NOT_FOUND','Conversación inexistente o expirada.'); return row;
  }
  remote(id:string,remote:string) { this.db.prepare('UPDATE sessions SET remote_id=?,updated_at=? WHERE id=?').run(remote,Date.now(),id); }
  acquire(id:string,max:number,timeout:number) {
    const result=this.db.prepare('UPDATE sessions SET busy_until=?,messages=messages+1,updated_at=? WHERE id=? AND busy_until<? AND messages<?').run(Date.now()+timeout,Date.now(),id,Date.now(),max);
    if(!result.changes) throw new HttpError(409,'SESSION_BUSY_OR_LIMIT','La conversación está ocupada o alcanzó su límite.');
  }
  release(id:string) {this.db.prepare('UPDATE sessions SET busy_until=0 WHERE id=?').run(id);}
  close(id:string) {this.db.prepare("UPDATE sessions SET status='deleted' WHERE id=?").run(id);}
  consume(key:string,limit:number,period:number) {
    const now=Date.now();
    const row=this.db.prepare(`INSERT INTO quotas(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`).get(key,now+period,now,now) as {count:number};
    if(row.count>limit) throw new HttpError(429,'RATE_LIMIT','Demasiadas solicitudes. Intenta más tarde.');
  }
  log(id:string,latency:number,tokens:number|null,error:string|null) {this.db.prepare('INSERT INTO usage(session_id,created_at,latency_ms,tokens,error_code) VALUES(?,?,?,?,?)').run(id,Date.now(),latency,tokens,error);}
  expired():Session[] { return this.db.prepare("SELECT * FROM sessions WHERE (expires_at<=? OR status='deleted') AND busy_until<? LIMIT 100").all(Date.now(),Date.now()) as Session[]; }
  remove(id:string) {this.db.prepare('DELETE FROM usage WHERE session_id=?').run(id);this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);}
  cleanupQuotas() {this.db.prepare('DELETE FROM quotas WHERE expires_at<=?').run(Date.now());}
  destroy(){this.db.close();}
}
