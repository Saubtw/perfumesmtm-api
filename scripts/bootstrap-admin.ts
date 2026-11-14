import {createClient} from '@supabase/supabase-js';
import {env} from '../src/config/env.js';
const email=process.env.MTM_ADMIN_EMAIL;
const password=process.env.MTM_ADMIN_PASSWORD;
if(!email||!password)throw new Error('Supply MTM_ADMIN_EMAIL and MTM_ADMIN_PASSWORD in the process environment.');
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let existing;
for(let page=1;page<=100;page++){
 const result=await db.auth.admin.listUsers({page,perPage:100});if(result.error)throw new Error('Cannot inspect admin accounts.');
 existing=result.data.users.find(u=>u.email?.toLowerCase()===email.toLowerCase());if(existing||result.data.users.length<100)break;
}
const result=existing?await db.auth.admin.updateUserById(existing.id,{password,email_confirm:true}):await db.auth.admin.createUser({email,password,email_confirm:true});
if(result.error||!result.data.user)throw new Error('Cannot configure owner authentication.');
const member=await db.from('sillage_admins').upsert({user_id:result.data.user.id,email,role:'owner',enabled:true});
if(member.error)throw new Error('Cannot save owner permissions.');
const auth=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await auth.auth.signInWithPassword({email,password});if(login.error)throw new Error('Owner sign-in verification failed.');
if(login.data.session)await db.auth.admin.signOut(login.data.session.access_token,'local');
console.log('Owner configured and sign-in verified. No credentials were written to source files.');
