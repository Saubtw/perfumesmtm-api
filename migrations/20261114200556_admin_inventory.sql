begin;
create table public.sillage_admins (
 user_id uuid primary key references auth.users(id), email text not null unique,
 role text not null check(role in ('owner','editor','viewer')), enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.sillage_brands(name text primary key,enabled boolean not null default true);
create table public.sillage_inventory(
 product_id text primary key references public.sillage_products(id), enabled boolean not null default false,
 stock integer not null default 0 check(stock>=0), average_cost numeric(12,2) not null default 0 check(average_cost>=0),
 retail_price integer check(retail_price>0),updated_at timestamptz not null default now()
);
create table public.sillage_promotions(
 id uuid primary key default gen_random_uuid(),name text not null,description text not null default '',
 price integer not null check(price>0),product_ids text[] not null check(cardinality(product_ids) between 2 and 4),
 enabled boolean not null default false,position integer not null default 0,tone text not null default 'sage'
);
create table public.sillage_stock_batches(
 id uuid primary key,kind text not null check(kind in ('purchase','sale','loss')),actor uuid references auth.users(id),
 note text not null default '',lot_quantity integer,created_at timestamptz not null default now()
);
create table public.sillage_stock_movements(
 id bigint generated always as identity primary key,batch_id uuid not null references public.sillage_stock_batches(id),
 product_id text not null references public.sillage_inventory(product_id),quantity integer not null check(quantity<>0),
 unit_cost numeric(12,2) not null,unit_price numeric(12,2) not null default 0,created_at timestamptz not null default now(),
 unique(batch_id,product_id)
);
create table public.sillage_admin_audit(
 id bigint generated always as identity primary key,actor uuid references auth.users(id),action text not null,
 target text not null,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create index sillage_stock_movements_product_idx on public.sillage_stock_movements(product_id);
create index sillage_stock_movements_batch_idx on public.sillage_stock_movements(batch_id);
create index sillage_stock_batches_actor_idx on public.sillage_stock_batches(actor);
create index sillage_admin_audit_actor_idx on public.sillage_admin_audit(actor);
alter table public.sillage_admins enable row level security;
alter table public.sillage_brands enable row level security;
alter table public.sillage_inventory enable row level security;
alter table public.sillage_promotions enable row level security;
alter table public.sillage_stock_batches enable row level security;
alter table public.sillage_stock_movements enable row level security;
alter table public.sillage_admin_audit enable row level security;
revoke all on public.sillage_admins,public.sillage_brands,public.sillage_inventory,public.sillage_promotions,public.sillage_stock_batches,public.sillage_stock_movements,public.sillage_admin_audit from anon,authenticated;
grant all on public.sillage_admins,public.sillage_brands,public.sillage_inventory,public.sillage_promotions,public.sillage_stock_batches,public.sillage_stock_movements,public.sillage_admin_audit to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Keep the original Chanel version; Intense is a separate product.
insert into public.sillage_products(id,display_index,name,brand,gender,image_url,published,olfactory,source_reference,source_hash)
values('119',119,'Coco Mademoiselle Intense','Chanel','femenino','/images/catalog/cocomademoiselleintense.png',true,'{"note":"Versión Eau de Parfum Intense. Perfil olfativo pendiente de verificación."}','user attachment 2026-11-14','9606ca6077053a580ddec3f5c6a4a981b9d875c0fa4a74486ca013c0fa1c49e8') on conflict(id) do nothing;
update public.sillage_products set name='Invictus Victory Elixir',image_url='/images/catalog/invictusvictoryelixir.png' where id='68';
insert into public.sillage_brands(name) select distinct brand from public.sillage_products;
insert into public.sillage_inventory(product_id,enabled,stock,average_cost)
select id,id=any(array['22','24','30','35','42','44','50','54','65','67','68','75','92','104','111','119']),
case when id=any(array['22','24','30','35','42','44','50','54','65','67','68','75','92','104','111','119']) then 1 else 0 end,
case when id=any(array['22','24','30','35','42','44','50','54','65','67','68','75','92','104','111','119']) then 310 else 0 end
from public.sillage_products;
update public.sillage_products p set published=i.enabled from public.sillage_inventory i where p.id=i.product_id;
with batch as (
 insert into public.sillage_stock_batches(id,kind,note,lot_quantity)
 values(gen_random_uuid(),'purchase','Pedido inicial de 22: 16 para venta; 6 personales fuera de inventario comercial.',22) returning id
)
insert into public.sillage_stock_movements(batch_id,product_id,quantity,unit_cost)
select batch.id,i.product_id,1,310 from batch cross join public.sillage_inventory i where i.enabled;

create function public.sillage_record_stock(p_id uuid,p_actor uuid,p_kind text,p_lines jsonb,p_lot_quantity integer,p_note text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare line jsonb; inv public.sillage_inventory%rowtype; q integer; cost numeric; retail numeric; total integer;
begin
 if not exists(select 1 from public.sillage_admins where user_id=p_actor and enabled and role in ('owner','editor')) then raise exception 'ADMIN_REQUIRED'; end if;
 -- Serializes retries of the same submission and ensures idempotency.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.sillage_stock_batches where id=p_id) then return p_id; end if;
 if p_kind not in ('purchase','sale','loss') or jsonb_array_length(p_lines) not between 1 and 119 then raise exception 'INVALID_LINES'; end if;
 if (select count(distinct value->>'product_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'DUPLICATE_PRODUCT'; end if;
 select sum((value->>'quantity')::integer) into total from jsonb_array_elements(p_lines);
 if total<=0 or total>10000 then raise exception 'INVALID_QUANTITY'; end if;
 if p_kind='purchase' then
   if p_lot_quantity<total or p_lot_quantity>10000 or p_lot_quantity is null then raise exception 'INVALID_LOT'; end if;
   cost:=case when p_lot_quantity>=50 then 270 when p_lot_quantity>=35 then 290 when p_lot_quantity>=20 then 310 when p_lot_quantity>=10 then 350 when p_lot_quantity>=5 then 400 else 500 end;
 end if;
 insert into public.sillage_stock_batches(id,kind,actor,note,lot_quantity) values(p_id,p_kind,p_actor,p_note,p_lot_quantity);
 for line in select value from jsonb_array_elements(p_lines) order by value->>'product_id' loop
   q:=(line->>'quantity')::integer;
   if q<=0 or q>10000 then raise exception 'INVALID_QUANTITY'; end if;
   select * into strict inv from public.sillage_inventory where product_id=line->>'product_id' for update;
   retail:=coalesce((line->>'unit_price')::numeric,0);
   if p_kind<>'purchase' then
     if inv.stock<q then raise exception 'INSUFFICIENT_STOCK'; end if;
     cost:=inv.average_cost;
   end if;
   if retail<0 or (p_kind='sale' and retail<=0) then raise exception 'INVALID_PRICE'; end if;
   update public.sillage_inventory set
     average_cost=case when p_kind='purchase' then round((stock*average_cost+q*cost)/(stock+q),2) else average_cost end,
     stock=stock+case when p_kind='purchase' then q else -q end,updated_at=now() where product_id=inv.product_id;
   insert into public.sillage_stock_movements(batch_id,product_id,quantity,unit_cost,unit_price)
   values(p_id,inv.product_id,case when p_kind='purchase' then q else -q end,cost,case when p_kind='sale' then retail else 0 end);
 end loop;
 insert into public.sillage_admin_audit(actor,action,target,detail) values(p_actor,'stock.'||p_kind,p_id::text,jsonb_build_object('lines',p_lines,'lot_quantity',p_lot_quantity));
 return p_id;
end $$;
revoke all on function public.sillage_record_stock(uuid,uuid,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.sillage_record_stock(uuid,uuid,text,jsonb,integer,text) to service_role;

-- Public reads also respect brand visibility, including direct PostgREST access.
create function public.sillage_admin_metrics(p_since timestamptz)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
 'revenue',coalesce((select sum(-m.quantity*m.unit_price) from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='sale' and b.created_at>=p_since),0),
 'cogs',coalesce((select sum(-m.quantity*m.unit_cost) from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='sale' and b.created_at>=p_since),0),
 'sold',coalesce((select sum(-m.quantity) from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='sale' and b.created_at>=p_since),0),
 'losses',coalesce((select sum(-m.quantity*m.unit_cost) from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='loss' and b.created_at>=p_since),0),
 'purchases',coalesce((select sum(m.quantity*m.unit_cost) from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='purchase' and b.created_at>=p_since),0),
 'stock',coalesce((select sum(stock) from sillage_inventory),0),
 'inventoryValue',coalesce((select sum(stock*average_cost) from sillage_inventory),0),
 'daily',coalesce((select jsonb_agg(d) from (select (b.created_at at time zone 'America/Mexico_City')::date as day,sum(-m.quantity*m.unit_price) revenue from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='sale' and b.created_at>=p_since group by 1 order by 1) d),'[]'),
 'top',coalesce((select jsonb_agg(t) from (select m.product_id,sum(-m.quantity) units,sum(-m.quantity*m.unit_price) revenue from sillage_stock_movements m join sillage_stock_batches b on b.id=m.batch_id where b.kind='sale' and b.created_at>=p_since group by 1 order by units desc limit 5)t),'[]')
);
$$;
revoke all on function public.sillage_admin_metrics(timestamptz) from public,anon,authenticated;
grant execute on function public.sillage_admin_metrics(timestamptz) to service_role;
create function public.sillage_set_product(p_id text,p_enabled boolean,p_price integer,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from public.sillage_admins where user_id=p_actor and enabled and role in ('owner','editor')) then raise exception 'ADMIN_REQUIRED'; end if;
 update public.sillage_inventory set enabled=p_enabled,retail_price=p_price,updated_at=now() where product_id=p_id;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 update public.sillage_products set published=p_enabled,updated_at=now() where id=p_id;
 insert into public.sillage_admin_audit(actor,action,target,detail) values(p_actor,'product.update',p_id,jsonb_build_object('enabled',p_enabled,'price',p_price));
end $$;
revoke all on function public.sillage_set_product(text,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.sillage_set_product(text,boolean,integer,uuid) to service_role;
grant select(name,enabled) on public.sillage_brands to anon,authenticated;
create policy sillage_brands_read on public.sillage_brands for select to anon,authenticated using(enabled);
drop policy sillage_public_read on public.sillage_products;
create policy sillage_public_read on public.sillage_products for select to anon,authenticated using(published and exists(select 1 from public.sillage_brands b where b.name=brand and b.enabled));
commit;
