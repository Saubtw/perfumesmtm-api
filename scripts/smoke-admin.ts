import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {managementClient,checked} from '../src/services/management.js';
import {env} from '../src/config/env.js';
const base=process.env.MTM_TEST_URL??'http://localhost:3001/api/v1';
const email=process.env.MTM_ADMIN_EMAIL,password=process.env.MTM_ADMIN_PASSWORD;
if(!email||!password)throw new Error('Supply owner test credentials in process environment.');
const db=managementClient();let cookie='',viewerId='',promoId='';
async function call(path:string,body?:unknown,method='POST',session=cookie){
 const response=await fetch(base+path,{method:body===undefined?'GET':method,headers:{Origin:env.CLIENT_ORIGIN,'Content-Type':'application/json',...(session?{Cookie:session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return response;
}
try{
 assert.equal((await call('/admin/state')).status,401);
 const login=await call('/admin/login',{email,password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0];
 const state=await (await call('/admin/state')).json();assert.equal(state.products.length,119);assert.equal(state.products.filter((p:any)=>p.enabled).length,16);assert.equal(state.products.reduce((s:number,p:any)=>s+p.stock,0),16);
 const original=state.products.find((p:any)=>p.id==='9');
 try{
  assert.equal((await call('/admin/products/9',{enabled:true,retail_price:original.price},'PATCH')).status,204);
  assert.equal((await (await call('/perfumes?limit=120')).json()).total,17);
 }finally{assert.equal((await call('/admin/products/9',{enabled:false,retail_price:original.price},'PATCH')).status,204);}
 try{
  assert.equal((await call('/admin/brands',{name:'Chanel',enabled:false},'PATCH')).status,204);
  assert.equal((await (await call('/perfumes?limit=120')).json()).total,15);
 }finally{await call('/admin/brands',{name:'Chanel',enabled:true},'PATCH');}
 const promo={name:'QA temporary combo '+randomUUID(),description:'Temporary verification',price:900,product_ids:['44','92'],position:999,tone:'sage',enabled:true};
 const saved=await call('/admin/promotions',promo);assert.equal(saved.status,200);promoId=(await saved.json()).id;
 const offers=await (await call('/storefront')).json();assert.ok(offers.promotions.some((p:any)=>p.id===promoId));
 assert.equal((await call('/admin/promotions',{...promo,id:promoId,enabled:false})).status,200);
 const testEmail=`mtm-qa-${randomUUID()}@example.com`;const testPassword=randomUUID()+'aA1!';
 const account=await call('/admin/accounts',{email:testEmail,password:testPassword,role:'viewer'});assert.equal(account.status,201);viewerId=(await account.json()).user_id;
 const viewer=await call('/admin/login',{email:testEmail,password:testPassword});assert.equal(viewer.status,200);const viewerCookie=viewer.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await call('/admin/state',undefined,'GET',viewerCookie)).status,200);
 assert.equal((await call('/admin/products/44',{enabled:false,retail_price:500},'PATCH',viewerCookie)).status,403);
 assert.equal((await call('/admin/accounts',{email:'blocked@example.com',password:testPassword,role:'editor'},'POST',viewerCookie)).status,403);
 const changedEmail=`mtm-qa-${randomUUID()}@example.com`,changedPassword=randomUUID()+'aA1!';
 assert.equal((await call('/admin/email',{email:changedEmail,current_password:testPassword},'POST',viewerCookie)).status,204);
 const newLogin=await call('/admin/login',{email:changedEmail,password:testPassword});assert.equal(newLogin.status,200);const newCookie=newLogin.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await call('/admin/password',{current_password:testPassword,password:changedPassword},'POST',newCookie)).status,204);
 const newPasswordLogin=await call('/admin/login',{email:changedEmail,password:changedPassword});assert.equal(newPasswordLogin.status,200);
 assert.equal((await call('/admin/accounts/'+viewerId,{enabled:false,role:'viewer'},'PATCH')).status,204);
 assert.equal((await call('/admin/state',undefined,'GET',newPasswordLogin.headers.get('set-cookie')!.split(';')[0])).status,403);
 const oversell=await call('/admin/stock',{id:randomUUID(),kind:'sale',lot_quantity:null,note:'QA oversell must fail',lines:[{product_id:'44',quantity:2,unit_price:500}]});assert.equal(oversell.status,409);
 const metrics=await (await call('/admin/metrics?days=all')).json();assert.equal(metrics.stock,16);assert.equal(Number(metrics.inventoryValue),4960);assert.equal(Number(metrics.sold),0);
 const publicPage=await (await call('/perfumes?limit=120')).json();assert.equal(publicPage.total,16);assert.ok(publicPage.items.every((p:any)=>!('average_cost' in p)&&!('stock' in p)));
 assert.equal((await call('/admin/logout',{})).status,204);cookie='';assert.equal((await call('/admin/state')).status,401);
 console.log('PASS: owner login, public 16, activation/hiding, brand filtering, editable promos, viewer permissions, own email/password changes, account revocation, oversell protection, initial cost and private-data boundary.');
}finally{
 if(promoId){checked(await db.from('sillage_admin_audit').delete().eq('target',promoId));checked(await db.from('sillage_promotions').delete().eq('id',promoId));}
 if(viewerId){checked(await db.from('sillage_admin_audit').delete().eq('actor',viewerId));checked(await db.from('sillage_admin_audit').delete().eq('target',viewerId));checked(await db.from('sillage_admins').delete().eq('user_id',viewerId));const removed=await db.auth.admin.deleteUser(viewerId);assert.equal(removed.error,null,'Temporary QA account cleanup failed.');}
}
