import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** Only the managed ingress may assert the address across SNAT; ordinary XFF is ignored. */
export function clientAddress(request, key = process.env.TRUSTED_PROXY_KEY ?? '') {
  const presented = request.headers['x-lecturer-proxy-key'], address = request.headers['x-lecturer-client-ip'];
  if (key.length >= 32 && typeof presented === 'string' && presented.length === key.length &&
      typeof address === 'string' && address.length <= 45 && isIP(address) &&
      Buffer.byteLength(key) === Buffer.byteLength(presented) &&
      timingSafeEqual(Buffer.from(key), Buffer.from(presented))) return address;
  return request.socket.remoteAddress ?? 'unknown';
}
