import { randomUUID } from 'node:crypto';
import { openBroker, ensureDurableConsumers, publishClaims } from '../common/broker.mjs';
import { rpcClient, healthServer, requiredKey, integer, backoff, sleep, logFailure } from '../common/runtime.mjs';

const rpc = rpcClient(process.env.CORE_URL ?? 'http://core:8080', requiredKey('SERVICE_EVENTS_KEY'));
const owner = randomUUID(), shutdown = new AbortController();
let ready = false, broker;
let status = {}, statusAt = 0;
const server = healthServer(integer(process.env.PORT, 8094, 1, 65535), () => ready, () => ({
  integration_outbox_pending_events: status.pending, integration_outbox_dead_events: status.dead,
  integration_outbox_pending_bytes: status.bytes, integration_outbox_oldest_seconds: status.oldestSeconds,
  integration_outbox_cleanup_events: status.cleanup,
  integration_outbox_metrics_age_seconds: (Date.now() - statusAt) / 1000
}));
const stop = () => { shutdown.abort(); ready = false; server.close(); void broker?.connection.close().catch(() => {}); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);

let failures = 0;
while (!shutdown.signal.aborted) {
  try {
    broker = await openBroker(process.env.AMQP_URL ?? 'amqp://rabbitmq');
    await ensureDurableConsumers(broker.channel);
    let closed = false;
    broker.connection.once('close', () => { closed = true; ready = false; });
    while (!shutdown.signal.aborted && !closed) {
      const batch = await rpc('/internal/v1/events/outbox/claim', { owner, limit: 256, leaseSeconds: 30 });
      if (Date.now() - statusAt >= 5000) {
        status = await rpc('/internal/v1/events/outbox/status', {}); statusAt = Date.now();
      }
      ready = true; failures = 0;
      if (!batch.items.length) { await sleep(100, shutdown.signal); continue; }
      // A stalled confirmation cannot hold an infinite set of claimed events.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Confirm deadline')), 10000); timer.unref();
      });
      let items;
      try { items = await Promise.race([publishClaims(broker.channel, batch.items), timeout]); }
      finally { clearTimeout(timer); }
      await rpc('/internal/v1/events/outbox/ack', { items });
    }
  } catch (error) {
    ready = false;
    if (!shutdown.signal.aborted) logFailure('event-publisher', error);
  } finally { await broker?.connection.close().catch(() => {}); broker = undefined; }
  if (!shutdown.signal.aborted) await sleep(backoff(failures++), shutdown.signal).catch(() => {});
}
