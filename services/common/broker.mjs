import amqp from 'amqplib';

export const EXCHANGE = 'lecturer.integration.v1';
export const ANALYTICS_QUEUE = 'lecturer.analytics.v1';

export async function openBroker(url) {
  const addresses = url.split(',').map(address => address.trim());
  const first = Math.floor(Math.random() * addresses.length);
  let connection, lastError;
  for (let i = 0; i < addresses.length; i++) {
    try { connection = await amqp.connect(addresses[(first + i) % addresses.length], { timeout: 2000 }); break; }
    catch (error) { lastError = error; }
  }
  if (!connection) throw lastError;
  // Channel/connection failures are handled by each service's reconnect loop.
  connection.on('error', () => {});
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  // Channel-level failures also require a new consumer/confirm channel.
  channel.once('close', () => { void connection.close().catch(() => {}); });
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  return { connection, channel };
}

export async function ensureDurableConsumers(channel) {
  await channel.assertQueue(ANALYTICS_QUEUE, { durable: true, arguments: {
    'x-queue-type': 'quorum', 'x-max-length-bytes': 268435456,
    'x-overflow': 'reject-publish'
  }});
  await channel.bindQueue(ANALYTICS_QUEUE, EXCHANGE, 'domain.#');
}

/** A returned transient invalidation is recoverable from the authoritative snapshot. */
export async function publishClaims(channel, claims) {
  const returned = new Set();
  const onReturn = message => returned.add(message.properties.messageId);
  channel.on('return', onReturn);
  try {
    return await Promise.all(claims.map(claim => new Promise(resolve => {
      try {
        const payload = Buffer.from(claim.payload);
        if (payload.length > 65536) throw new Error('Event exceeds limit');
        channel.publish(EXCHANGE, claim.routingKey, payload, {
          persistent: !claim.routingKey.startsWith('realtime.'), mandatory: true,
          contentType: 'application/json', messageId: claim.id
        }, error => resolve({ id: claim.id, claimToken: claim.claimToken,
          delivered: !error && (claim.routingKey.startsWith('realtime.') || !returned.has(claim.id)) }));
      } catch {
        resolve({ id: claim.id, claimToken: claim.claimToken, delivered: false });
      }
    })));
  } finally { channel.off('return', onReturn); }
}
