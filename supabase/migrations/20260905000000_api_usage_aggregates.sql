CREATE VIEW public.api_usage_summary AS
SELECT COALESCE(sum(token_count), 0) as total_tokens, COALESCE(sum(execution_time_ms), 0) as total_execution_time_ms
FROM public.api_usage_logs;

GRANT SELECT ON public.api_usage_summary TO anon, authenticated, service_role;
