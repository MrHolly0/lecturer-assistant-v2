alter table channel.outbox add column claim_token uuid;
alter table channel.delivery_reports add column attempt_token uuid;

create index idx_channel_outbox_expired_lease
    on channel.outbox (locked_until)
    where status = 'IN_FLIGHT';
