begin;
create policy sillage_admins_private on public.sillage_admins as restrictive for all to anon,authenticated using(false) with check(false);
create policy sillage_inventory_private on public.sillage_inventory as restrictive for all to anon,authenticated using(false) with check(false);
create policy sillage_promotions_private on public.sillage_promotions as restrictive for all to anon,authenticated using(false) with check(false);
create policy sillage_batches_private on public.sillage_stock_batches as restrictive for all to anon,authenticated using(false) with check(false);
create policy sillage_movements_private on public.sillage_stock_movements as restrictive for all to anon,authenticated using(false) with check(false);
create policy sillage_audit_private on public.sillage_admin_audit as restrictive for all to anon,authenticated using(false) with check(false);
commit;
