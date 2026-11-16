import { createHmac, timingSafeEqual } from 'node:crypto';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const denied = status => Object.assign(new Error('Upgrade not admitted'), { status });

/** Unverified sockets never enter either presenter budget. Tickets carry no access token. */
export class UpgradeAdmission {
  constructor(key, { now = Date.now, pendingLimit = 64, connectedLimit = 256, personLimit = 8 } = {}) {
    Object.assign(this, { key, now, pendingLimit, connectedLimit, personLimit });
    this.pending = 0; this.connected = 0; this.people = new Map(); this.used = new Map();
    this.deniedSources = new Map();
  }
  rejected(source) {
    const now = this.now(), old = this.deniedSources.get(source);
    const current = old && old.until > now ? old : { until: now + 1000, count: 0 };
    if (!old && this.deniedSources.size >= 10000) this.deniedSources.delete(this.deniedSources.keys().next().value);
    this.deniedSources.set(source, current);
    return ++current.count > 32 ? 429 : 401;
  }
  reserve(session, protocols) {
    const entries = String(protocols ?? '').split(',').map(x => x.trim());
    const tickets = entries.filter(x => x.startsWith('ticket.'));
    if (entries.length !== 2 || !entries.includes('lecturer.v1') || tickets.length !== 1) throw denied(401);
    const token = tickets[0].slice(7);
    if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw denied(401);
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', this.key).update('presenter-upgrade-v1.' + payload).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw denied(401);
    let claim;
    try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw denied(401); }
    const now = this.now();
    if (claim.v !== 1 || claim.session !== session || !UUID.test(claim.person ?? '') || !UUID.test(claim.nonce ?? '') ||
        !Number.isSafeInteger(claim.expires) || claim.expires <= now || claim.expires > now + 30000) throw denied(401);
    for (const [nonce, expires] of this.used) if (expires <= now) this.used.delete(nonce);
    if (this.used.has(claim.nonce)) throw denied(401);
    if (this.pending >= this.pendingLimit || this.used.size >= 8192 || (this.people.get(claim.person) ?? 0) >= this.personLimit) throw denied(429);
    this.used.set(claim.nonce, claim.expires);
    this.people.set(claim.person, (this.people.get(claim.person) ?? 0) + 1); this.pending++;
    let phase = 'pending';
    return { personId: claim.person, promote: () => {
      if (phase !== 'pending' || this.connected >= this.connectedLimit) throw denied(503);
      this.pending--; this.connected++; phase = 'connected';
    }, release: () => {
      if (phase === 'closed') return;
      if (phase === 'pending') this.pending--; else this.connected--;
      phase = 'closed';
      const count = this.people.get(claim.person) - 1;
      if (count) this.people.set(claim.person, count); else this.people.delete(claim.person);
    }};
  }
}
