BEGIN;
CREATE POLICY sillage_private_no_client_access ON public.sillage_chat_sessions AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY sillage_private_no_client_access ON public.sillage_chat_quotas AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY sillage_private_no_client_access ON public.sillage_chat_usage AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
COMMIT;
