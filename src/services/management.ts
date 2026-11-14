import {createClient} from '@supabase/supabase-js';
import {env} from '../config/env.js';
import {HttpError} from '../utils/errors.js';
export const initialIds=['22','24','30','35','42','44','50','54','65','67','68','75','92','104','111','119'];
export const costTiers=[{min:1,cost:500},{min:5,cost:400},{min:10,cost:350},{min:20,cost:310},{min:35,cost:290},{min:50,cost:270}];
export const lotCost=(quantity:number)=>[...costTiers].reverse().find(t=>quantity>=t.min)?.cost ?? 0;
export function managementClient(){return createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}});}
export function checked<T>(result:{data:T;error:unknown}):NonNullable<T> {if(result.error)throw new HttpError(503,'MANAGEMENT_UNAVAILABLE','No se pudo guardar o consultar la información. Intenta de nuevo.');return result.data as NonNullable<T>;}
export async function publicManagement(){
  if(!env.SUPABASE_SECRET_KEY)return {inventory:initialIds.map(product_id=>({product_id,enabled:true,retail_price:null})),brands:[],promotions:[]};
  const db=managementClient();
  const [inventory,brands,promotions]=await Promise.all([
    db.from('sillage_inventory').select('product_id,enabled,retail_price'),
    db.from('sillage_brands').select('name,enabled'),
    db.from('sillage_promotions').select('id,name,description,price,product_ids,position,enabled,tone').eq('enabled',true).order('position')]);
  return {inventory:checked(inventory)??[],brands:checked(brands)??[],promotions:checked(promotions)??[]};
}
