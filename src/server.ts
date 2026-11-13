import { createApp } from './app.js';
import { env } from './config/env.js';
const {app,sessions,agent}=createApp();
const server=app.listen(env.PORT,()=>console.log(`Perfumes MTM API: http://localhost:${env.PORT} (catalog: ${env.CATALOG_SOURCE})`));
async function cleanup() {
  await sessions.cleanupQuotas();
  for(const s of await sessions.expired()) {
    try {if(s.remote_id) await agent.remove(s.remote_id);await sessions.remove(s.id);} catch {console.error('{"event":"session_cleanup_failed"}');}
  }
}
const clean=()=>cleanup().catch(()=>console.error('{"event":"cleanup_unavailable"}'));
void clean();const cleaner=setInterval(()=>void clean(),60000);cleaner.unref();
function stop(){clearInterval(cleaner);server.close(()=>{sessions.destroy();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
