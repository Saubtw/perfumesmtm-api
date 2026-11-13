import { mkdir,writeFile } from 'node:fs/promises';
import { env } from '../src/config/env.js';
if(!env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Configure SUPABASE_PUBLISHABLE_KEY');
const response=await fetch(`${env.SUPABASE_URL}/rest/v1/`,{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(12000)});
const document=await response.json();
await mkdir('reports',{recursive:true});
if(response.ok) {
  await writeFile('reports/supabase-openapi.json',JSON.stringify(document,null,2));
  console.log('Esquema REST guardado. No revela necesariamente tablas privadas, políticas RLS ni índices. Ejecuta docs/inspect-supabase.sql por MCP de solo lectura.');
} else {
  console.log(JSON.stringify({status:response.status,message:document.message ?? 'Inspección no disponible con esta clave.'}));
  process.exitCode=1;
}
