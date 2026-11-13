BEGIN;
CREATE TABLE public.sillage_chat_sessions (
 id uuid PRIMARY KEY,owner text NOT NULL,remote_id text UNIQUE,created_at bigint NOT NULL,updated_at bigint NOT NULL,
 expires_at bigint NOT NULL,messages integer NOT NULL DEFAULT 0 CHECK(messages>=0),busy_until bigint NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted'))
);
CREATE INDEX sillage_chat_owner ON public.sillage_chat_sessions(owner,expires_at);
CREATE INDEX sillage_chat_expiry ON public.sillage_chat_sessions(expires_at);
CREATE TABLE public.sillage_chat_quotas(key text PRIMARY KEY,count integer NOT NULL,expires_at bigint NOT NULL);
CREATE INDEX sillage_chat_quota_expiry ON public.sillage_chat_quotas(expires_at);
CREATE TABLE public.sillage_chat_usage(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,session_id uuid NOT NULL REFERENCES public.sillage_chat_sessions(id) ON DELETE CASCADE,
 created_at bigint NOT NULL,latency_ms integer NOT NULL,tokens integer,error_code text);
CREATE INDEX sillage_chat_usage_session ON public.sillage_chat_usage(session_id);
ALTER TABLE public.sillage_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sillage_chat_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sillage_chat_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sillage_chat_sessions,public.sillage_chat_quotas,public.sillage_chat_usage FROM anon,authenticated;
GRANT ALL ON public.sillage_chat_sessions,public.sillage_chat_quotas,public.sillage_chat_usage TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.sillage_chat_usage_id_seq TO service_role;
CREATE FUNCTION public.sillage_create_chat_session(p_id uuid,p_owner text,p_now bigint,p_expires bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner,0));
 IF (SELECT count(*) FROM public.sillage_chat_sessions WHERE owner=p_owner AND expires_at>p_now AND status='active')>=5 THEN RAISE EXCEPTION 'SESSION_LIMIT'; END IF;
 INSERT INTO public.sillage_chat_sessions(id,owner,created_at,updated_at,expires_at) VALUES(p_id,p_owner,p_now,p_now,p_expires) RETURNING to_jsonb(sillage_chat_sessions.*) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.sillage_acquire_chat_session(p_id uuid,p_now bigint,p_busy_until bigint,p_max integer) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.sillage_chat_sessions SET busy_until=p_busy_until,messages=messages+1,updated_at=p_now WHERE id=p_id AND busy_until<p_now AND messages<p_max AND status='active' AND expires_at>p_now;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.sillage_consume_quota(p_key text,p_now bigint,p_expires bigint) RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result integer;
BEGIN
 INSERT INTO public.sillage_chat_quotas AS q(key,count,expires_at) VALUES(p_key,1,p_expires)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN q.expires_at<=p_now THEN 1 ELSE q.count+1 END,
 expires_at=CASE WHEN q.expires_at<=p_now THEN EXCLUDED.expires_at ELSE q.expires_at END RETURNING count INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sillage_create_chat_session(uuid,text,bigint,bigint),public.sillage_acquire_chat_session(uuid,bigint,bigint,integer),public.sillage_consume_quota(text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sillage_create_chat_session(uuid,text,bigint,bigint),public.sillage_acquire_chat_session(uuid,bigint,bigint,integer),public.sillage_consume_quota(text,bigint,bigint) TO service_role;
COMMIT;
