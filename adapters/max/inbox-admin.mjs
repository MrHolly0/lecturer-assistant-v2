// Local operations only: requires access to the adapter container and its private volume.
import { DurableInbox } from './inbox.mjs';
const [command = 'stats', value] = process.argv.slice(2);
if (!['stats', 'metrics', 'list', 'show', 'retry', 'purge'].includes(command)) throw new Error('Commands: stats, metrics, list [1..100], show ID, retry ID, purge ID');
if (['show', 'retry', 'purge'].includes(command) && !/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error('A single event SHA256 ID is required');
const inbox = new DurableInbox(process.env.MAX_INBOX_PATH ?? '/data/max-inbox/inbox.sqlite');
try {
  if (command === 'metrics') {
    const state = inbox.capacity();
    console.log(Object.entries({ work_items: state.work_items, work_bytes: state.work_bytes,
      dead_items: state.dead_items, dead_bytes: state.dead_bytes, dead_blocked: Number(inbox.deadFull(state)),
      dedup_items: state.dedup_items, dedup_evictions_total: state.dedup_evictions,
      work_limit_items: inbox.maxItems, work_limit_bytes: inbox.maxBytes,
      dead_limit_items: inbox.maxDeadItems, dead_limit_bytes: inbox.maxDeadBytes
    }).map(([name, count]) => `lecturer_max_inbox_${name} ${count}`).join('\n'));
  } else if (command === 'stats') console.log(JSON.stringify({ ...inbox.capacity(), states: inbox.stats() }));
  else if (command === 'list') console.log(JSON.stringify(inbox.dead(value === undefined ? 50 : Number(value))));
  else if (command === 'show') console.log(JSON.stringify(inbox.inspectDead(value) ?? null));
  else if (command === 'retry') console.log(JSON.stringify({ changed: inbox.retryDead(value) }));
  else console.log(JSON.stringify({ changed: inbox.purgeDead(value) }));
} finally { inbox.close(); }
