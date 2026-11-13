import { z } from 'zod';
export const olfactorySchema = z.object({
  family: z.string().optional(), opening: z.string().optional(), heart: z.string().optional(), base: z.string().optional(),
  smell: z.string().optional(), summary: z.string().optional(), profile: z.string().optional(), occasion: z.string().optional(), notes: z.string().optional(), note: z.string().optional()
});
export type Olfactory = z.infer<typeof olfactorySchema>;
export type Product = { id: string; display_index: number; slug: string; name: string; brand: string; house: string; gender: string;
  image: string; detail_url: string; olfactory: Olfactory | null; price?: number | null };
export type Recommendation = Pick<Product,'id'|'name'|'image'|'detail_url'> & {reason:string};
export const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(120).default(24),
  q: z.string().max(120).default(''), brand: z.string().max(100).optional(), gender: z.enum(['masculino','femenino','unisex']).optional(),
  sort: z.enum(['default','az','za']).default('default'),
  note: z.string().max(80).optional(), exclude_note: z.string().max(80).optional(), family: z.string().max(80).optional(),
  occasion: z.string().max(80).optional(), profile: z.string().max(80).optional()
}).strict();
export type CatalogQuery = z.infer<typeof querySchema>;
export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const safeImage = (s: string) => /^\/(?!\/)[a-zA-Z0-9/_ .%-]+$/.test(s) || /^https:\/\//.test(s) ? s : '';
