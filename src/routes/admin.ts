import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {createClient} from '@supabase/supabase-js';
import {env} from '../config/env.js';
import {HttpError} from '../utils/errors.js';
import {managementClient,checked,costTiers} from '../services/management.js';
import type {SessionStore} from '../repositories/sessions.js';
import {ipKey} from '../middleware/identity.js';
import type {CatalogRepository} from '../repositories/catalog.js';
const cookie='mtm_admin';
const cookieOptions={httpOnly:true,secure:env.NODE_ENV==='production',sameSite:env.COOKIE_SAME_SITE,path:'/api/v1/admin'} as const;
const credentials=z.object({email:z.email().max(254),password:z.string().min(8).max(128)}).strict();
const uuid=z.uuid();
export function adminRoutes(sessions:SessionStore,catalog:CatalogRepository){
 const router=Router();
 const audit=async(actor:string,action:string,target:string,detail:unknown)=>checked(await managementClient().from('sillage_admin_audit').insert({actor,action,target,detail}));
 router.post('/login',async(req,res)=>{
   await sessions.consume(`admin-login:${ipKey(req)}`,8,900000);
   const body=credentials.parse(req.body);
   const auth=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await auth.auth.signInWithPassword(body);
   if(error||!data.session)throw new HttpError(401,'INVALID_LOGIN','Correo o contraseña incorrectos.');
   const member=checked(await managementClient().from('sillage_admins').select('user_id,email,role,enabled').eq('user_id',data.user.id).maybeSingle());
   if(!member?.enabled)throw new HttpError(403,'ADMIN_REQUIRED','Esta cuenta no tiene acceso al panel.');
   res.cookie(cookie,data.session.access_token,{...cookieOptions,maxAge:Math.min(data.session.expires_in,3600)*1000});
   await audit(member.user_id,'login',member.user_id,{});
   res.json({user:member});
 });
 router.use(async(req:Request,res:Response,next:NextFunction)=>{
   const token=req.cookies[cookie];if(!token)throw new HttpError(401,'LOGIN_REQUIRED','Inicia sesión para continuar.');
   const db=managementClient();const {data,error}=await db.auth.getUser(token);
   if(error||!data.user)throw new HttpError(401,'SESSION_EXPIRED','Tu sesión terminó. Vuelve a entrar.');
   const member=checked(await db.from('sillage_admins').select('user_id,email,role,enabled').eq('user_id',data.user.id).maybeSingle());
   if(!member?.enabled)throw new HttpError(403,'ADMIN_REQUIRED','Esta cuenta no tiene acceso al panel.');
   res.locals.admin=member;
   if(!['GET','HEAD'].includes(req.method)&&!['/logout','/password','/email'].includes(req.path)&&member.role==='viewer')throw new HttpError(403,'READ_ONLY','Tu cuenta solo permite consultar.');
   next();
 });
 router.get('/me',(_req,res)=>res.json({user:res.locals.admin}));
 router.get('/metrics',async(req,res)=>{
   const days=z.enum(['7','30','90','all']).parse(req.query.days??'30');
   const since=days==='all'?'2000-01-01T00:00:00Z':new Date(Date.now()-Number(days)*86400000).toISOString();
   res.json(checked(await managementClient().rpc('sillage_admin_metrics',{p_since:since})));
 });
 router.post('/logout',async(req,res)=>{await managementClient().auth.admin.signOut(req.cookies[cookie],'local');res.clearCookie(cookie,cookieOptions).sendStatus(204);});
 router.get('/state',async(_req,res)=>{
   const db=managementClient();const [products,inventory,brands,promotions,batches,movements,auditLog,admins]=await Promise.all([
     db.from('sillage_products').select('id,name,brand,gender,image_url').order('display_index'),db.from('sillage_inventory').select('*'),
     db.from('sillage_brands').select('*').order('name'),db.from('sillage_promotions').select('*').order('position'),
     db.from('sillage_stock_batches').select('*').order('created_at',{ascending:false}).limit(1000),
     db.from('sillage_stock_movements').select('*').order('created_at',{ascending:false}).limit(10000),
     db.from('sillage_admin_audit').select('id,actor,action,target,created_at').order('created_at',{ascending:false}).limit(100),
     res.locals.admin.role==='owner'?db.from('sillage_admins').select('user_id,email,role,enabled'):Promise.resolve({data:[],error:null})]);
   const prices=await catalog.allArchiveProducts();
   res.json({user:res.locals.admin,products:checked(products).map(p=>({...p,...checked(inventory).find(i=>i.product_id===p.id),price:checked(inventory).find(i=>i.product_id===p.id)?.retail_price??prices.find(i=>i.id===p.id)?.price??null})),brands:checked(brands),promotions:checked(promotions),batches:checked(batches),movements:checked(movements),audit:checked(auditLog),admins:checked(admins),costTiers,historyLimit:10000});
 });
 router.patch('/products/:id',async(req,res)=>{
   const id=z.string().max(150).parse(req.params.id);const body=z.object({enabled:z.boolean(),retail_price:z.number().int().positive().max(100000)}).strict().parse(req.body);
   checked(await managementClient().rpc('sillage_set_product',{p_id:id,p_enabled:body.enabled,p_price:body.retail_price,p_actor:res.locals.admin.user_id}));
   catalog.invalidate();res.sendStatus(204);
 });
 router.patch('/brands',async(req,res)=>{
   const body=z.object({name:z.string().max(100),enabled:z.boolean()}).strict().parse(req.body);
   const result=checked(await managementClient().from('sillage_brands').update({enabled:body.enabled}).eq('name',body.name).select('name'));
   if(!result.length)throw new HttpError(404,'NOT_FOUND','Marca inexistente.');
   await audit(res.locals.admin.user_id,'brand.update',body.name,body);catalog.invalidate();res.sendStatus(204);
 });
 router.post('/stock',async(req,res)=>{
   const body=z.object({id:uuid,kind:z.enum(['purchase','sale','loss']),lot_quantity:z.number().int().min(1).max(10000).nullable(),note:z.string().trim().max(500),lines:z.array(z.object({product_id:z.string().min(1).max(150),quantity:z.number().int().min(1).max(10000),unit_price:z.number().positive().max(100000).optional()}).strict()).min(1).max(119)}).strict().parse(req.body);
   if(new Set(body.lines.map(l=>l.product_id)).size!==body.lines.length)throw new HttpError(400,'DUPLICATE_PRODUCT','Agrupa las unidades de cada perfume en una sola línea.');
   if(body.kind==='sale'&&body.lines.some(l=>!l.unit_price))throw new HttpError(400,'INVALID_PRICE','Indica el precio real de venta por unidad.');
   if(body.kind==='purchase'&&(!body.lot_quantity||body.lot_quantity<body.lines.reduce((s,l)=>s+l.quantity,0)))throw new HttpError(400,'INVALID_LOT','El lote debe incluir al menos las unidades que ingresan a stock.');
   const result=await managementClient().rpc('sillage_record_stock',{p_id:body.id,p_actor:res.locals.admin.user_id,p_kind:body.kind,p_lines:body.lines,p_lot_quantity:body.lot_quantity,p_note:body.note});
   if(result.error)throw new HttpError(409,'STOCK_NOT_SAVED',result.error.message.includes('INSUFFICIENT_STOCK')?'No hay suficientes unidades. Revisa el stock y vuelve a intentar.':'No se pudo registrar el movimiento. Revisa las cantidades e intenta de nuevo.');
   res.status(201).json({id:result.data});
 });
 const promo=z.object({id:uuid.optional(),name:z.string().trim().min(1).max(100),description:z.string().max(300),price:z.number().int().positive().max(100000),product_ids:z.array(z.string().max(150)).min(2).max(4),enabled:z.boolean(),position:z.number().int().min(0).max(999),tone:z.enum(['sage','rose','brass']).default('sage')}).strict();
 router.post('/promotions',async(req,res)=>{
   const body=promo.parse(req.body);const items=await catalog.products(true);
   const selected=body.product_ids.map(id=>items.find(p=>p.id===id));
   if(body.enabled&&(selected.some(p=>!p)||selected.reduce((s,p)=>s+(p?.price??0),0)<=body.price))throw new HttpError(400,'INVALID_PROMOTION','Para activar el combo, elige perfumes visibles y un precio menor al total individual.');
   const row=checked(await managementClient().from('sillage_promotions').upsert(body).select('id').single());
   await audit(res.locals.admin.user_id,'promotion.save',row.id,body);res.json(row);
 });
 router.use('/accounts',(_req,res,next)=>{if(res.locals.admin.role!=='owner')throw new HttpError(403,'OWNER_REQUIRED','Solo el propietario puede administrar cuentas.');next();});
 router.post('/accounts',async(req,res)=>{
   const body=credentials.extend({role:z.enum(['editor','viewer'])}).parse(req.body);const db=managementClient();
   const {data,error}=await db.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true});
   if(error||!data.user)throw new HttpError(400,'ACCOUNT_NOT_CREATED','No se pudo crear la cuenta. Revisa el correo y la contraseña; el correo podría estar registrado.');
   const member={user_id:data.user.id,email:body.email,role:body.role,enabled:true};
   const result=await db.from('sillage_admins').insert(member);if(result.error){await db.auth.admin.deleteUser(data.user.id);checked(result);}
   await audit(res.locals.admin.user_id,'account.create',data.user.id,{email:body.email,role:body.role});res.status(201).json(member);
 });
 router.patch('/accounts/:id',async(req,res)=>{
   const id=uuid.parse(req.params.id);const body=z.object({enabled:z.boolean(),role:z.enum(['editor','viewer'])}).strict().parse(req.body);
   if(id===res.locals.admin.user_id)throw new HttpError(400,'OWNER_PROTECTED','La cuenta propietaria se conserva activa.');
   const updated=checked(await managementClient().from('sillage_admins').update(body).eq('user_id',id).neq('role','owner').select('user_id'));
   if(!updated.length)throw new HttpError(404,'NOT_FOUND','Cuenta no editable.');await audit(res.locals.admin.user_id,'account.update',id,body);res.sendStatus(204);
 });
 router.post('/password',async(req,res)=>{
   await sessions.consume(`admin-sensitive:${res.locals.admin.user_id}`,8,900000);
   const body=z.object({current_password:z.string().min(8).max(128),password:z.string().min(8).max(128)}).strict().parse(req.body);
   const auth=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const verified=await auth.auth.signInWithPassword({email:res.locals.admin.email,password:body.current_password});
   if(verified.error)throw new HttpError(401,'INVALID_PASSWORD','La contraseña actual no es correcta.');
   const change=await managementClient().auth.admin.updateUserById(res.locals.admin.user_id,{password:body.password});
   if(change.error)throw new HttpError(400,'PASSWORD_NOT_CHANGED','No se pudo cambiar la contraseña. Intenta con otra de al menos ocho caracteres.');
   await audit(res.locals.admin.user_id,'password.change',res.locals.admin.user_id,{});res.clearCookie(cookie,cookieOptions).sendStatus(204);
 });
 router.post('/email',async(req,res)=>{
   await sessions.consume(`admin-sensitive:${res.locals.admin.user_id}`,8,900000);
   const body=z.object({email:z.email().max(254),current_password:z.string().min(8).max(128)}).strict().parse(req.body);
   const email=body.email.toLowerCase(),member=res.locals.admin;
   const auth=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const verified=await auth.auth.signInWithPassword({email:member.email,password:body.current_password});
   if(verified.error)throw new HttpError(401,'INVALID_PASSWORD','La contraseña actual no es correcta.');
   const db=managementClient();
   const change=await db.auth.admin.updateUserById(member.user_id,{email,email_confirm:true});
   if(change.error)throw new HttpError(400,'EMAIL_NOT_CHANGED','No se pudo cambiar el correo. Puede estar registrado en otra cuenta.');
   const saved=await db.from('sillage_admins').update({email}).eq('user_id',member.user_id);
   if(saved.error){await db.auth.admin.updateUserById(member.user_id,{email:member.email,email_confirm:true});checked(saved);}
   await audit(member.user_id,'email.change',member.user_id,{previous_email:member.email,email});
   res.clearCookie(cookie,cookieOptions).sendStatus(204);
 });
 return router;
}
