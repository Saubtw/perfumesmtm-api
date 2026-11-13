import { isIP } from 'node:net';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { CatalogRepository } from '../repositories/catalog.js';
import { currentWeather } from '../integrations/weather/client.js';
export const contextSchema=z.object({locale:z.string().max(30).default('es-MX'),timezone:z.string().max(80).default('UTC'),current_page:z.string().max(300).default('/'),current_product_id:z.string().max(150).nullable().default(null),weather_useful:z.boolean().default(false)}).strict();
const geoSchema=z.object({city:z.string().nullable(),region:z.string().nullable(),country_name:z.string().nullable(),latitude:z.number(),longitude:z.number()});
export async function buildContext(input:unknown,ip:string,catalog:CatalogRepository,headers:Record<string,unknown>={}) {
  const c=contextSchema.parse(input ?? {});
  let timezone=c.timezone; try {new Intl.DateTimeFormat('es-MX',{timeZone:timezone});} catch {timezone='UTC';}
  const product=c.current_product_id ? await catalog.findPerfumeById(c.current_product_id) : null;
  let location:unknown=null,weather:unknown=null;
  if(env.IP_GEO_PROVIDER==='cloudflare' && env.TRUST_HOSTING_HEADERS==='true') {
    const trusted=z.object({city:z.string().max(120),region:z.string().max(120),country:z.string().length(2),latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180)}).safeParse({city:headers['cf-ipcity'],region:headers['cf-region'],country:headers['cf-ipcountry'],latitude:headers['cf-iplatitude'],longitude:headers['cf-iplongitude']});
    if(trusted.success) {const g=trusted.data;location={city:g.city,region:g.region,country:g.country,source:'approximate_cloudflare'};if(c.weather_useful)weather=await currentWeather(g.latitude,g.longitude);}
  }
  if(env.IP_GEO_PROVIDER==='ipapi' && isIP(ip) && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip)) {
    try {
      const geo=geoSchema.parse(await (await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`,{signal:AbortSignal.timeout(3000)})).json());
      location={city:geo.city,region:geo.region,country:geo.country_name,source:'approximate_ip'};
      if(c.weather_useful) weather=await currentWeather(geo.latitude,geo.longitude);
    } catch { /* Optional context: unknown values remain null. */ }
  }
  return {locale:c.locale,location,datetime:{local:new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,dateStyle:'short',timeStyle:'long'}).format(new Date()),timezone},weather,current_page:c.current_page.startsWith('/')&&!c.current_page.startsWith('//') ? c.current_page : '/',current_product_id:product?.id ?? null};
}
