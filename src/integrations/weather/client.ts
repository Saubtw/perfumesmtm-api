import { z } from 'zod';
import { env } from '../../config/env.js';
const cache=new Map<string,{until:number;data:unknown}>();
export async function currentWeather(latitude:number,longitude:number) {
  if(!env.WEATHER_PROVIDER||!env.WEATHER_API_KEY)return null;
  const lat=latitude.toFixed(1),lon=longitude.toFixed(1),key=`${env.WEATHER_PROVIDER}:${lat},${lon}`;
  const hit=cache.get(key);if(hit&&hit.until>Date.now())return hit.data;
  try {
    const url=env.WEATHER_PROVIDER==='weatherapi'
      ? `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(env.WEATHER_API_KEY)}&q=${lat},${lon}&aqi=no`
      : `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(env.WEATHER_API_KEY)}`;
    const response=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!response.ok)return null;
    const raw=await response.json();let data;
    if(env.WEATHER_PROVIDER==='weatherapi') {
      const w=z.object({current:z.object({temp_c:z.number(),humidity:z.number().min(0).max(100),condition:z.object({text:z.string()})})}).parse(raw).current;
      data={temperature_c:w.temp_c,humidity_percent:w.humidity,condition:w.condition.text};
    } else {
      const w=z.object({main:z.object({temp:z.number(),humidity:z.number().min(0).max(100)}),weather:z.array(z.object({main:z.string()}))}).parse(raw);
      data={temperature_c:w.main.temp,humidity_percent:w.main.humidity,condition:w.weather[0]?.main??null};
    }
    if(cache.size>=200)cache.delete(cache.keys().next().value!);cache.set(key,{until:Date.now()+600000,data});return data;
  } catch {return null;}
}
