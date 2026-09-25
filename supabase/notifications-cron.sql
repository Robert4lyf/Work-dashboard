-- Dashboard notifications: run this once in Supabase > SQL Editor AFTER deploying the
-- send-notices function. Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET first (the secret must
-- match the CRON_SECRET you set for the function). It calls the function every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('dashboard-notices') where exists (select 1 from cron.job where jobname = 'dashboard-notices');
select cron.schedule(
  'dashboard-notices',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-notices',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
       body := '{}'::jsonb
     ) $$
);

-- Sent notices older than a week are no longer needed.
select cron.unschedule('dashboard-notices-cleanup') where exists (select 1 from cron.job where jobname = 'dashboard-notices-cleanup');
select cron.schedule('dashboard-notices-cleanup', '17 3 * * *',
  $$ delete from public.cockpit_notices where sent_at < now() - interval '7 days' $$);
