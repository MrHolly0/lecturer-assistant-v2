create table if not exists analytics.outbox_archive
(like analytics.outbox including all);

insert into analytics.outbox_archive (id, event_id, status, created_at)
select id, event_id, status, created_at
from analytics.outbox
on conflict (id) do nothing;
