#!/usr/bin/env node
// Run inside a lab container (also works from stdin). Outputs aggregate counters only.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const duration = Number(process.env.DIAGNOSTICS_DURATION_MS ?? 900000);
const interval = Number(process.env.DIAGNOSTICS_INTERVAL_MS ?? 1000);
const port = Number(process.env.PORT ?? 8091);
if (!Number.isInteger(duration) || duration < 1000 || duration > 21600000
    || !Number.isInteger(interval) || interval < 250 || interval > 10000
    || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid diagnostics budget');

const files = {
  cpu: '/sys/fs/cgroup/cpu.stat', cpuLimit: '/sys/fs/cgroup/cpu.max',
  memory: '/sys/fs/cgroup/memory.current', swap: '/sys/fs/cgroup/memory.swap.current',
  memoryEvents: '/sys/fs/cgroup/memory.events', memoryStats: '/sys/fs/cgroup/memory.stat',
  memoryPressure: '/proc/pressure/memory', cpuPressure: '/proc/pressure/cpu',
  ioPressure: '/proc/pressure/io', vmMemory: '/proc/meminfo'
};
const memoryKeys = new Set(['anon', 'file', 'kernel', 'pgfault', 'pgmajfault', 'pgscan', 'pgsteal']);
const vmKeys = new Set(['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree', 'Dirty', 'Writeback']);
const parse = (name, value) => {
  if (name === 'memory' || name === 'swap') return Number(value.trim());
  if (name === 'cpuLimit') return value.trim();
  if (name.endsWith('Pressure')) return Object.fromEntries(value.trim().split('\n').map(line => {
    const [kind, ...values] = line.split(/\s+/);
    return [kind, Object.fromEntries(values.map(v => {
      const [key, n] = v.split('='); return [key, Number(n)];
    }))];
  }));
  return Object.fromEntries(value.trim().split('\n').flatMap(line => {
    const [rawKey, rawValue] = line.split(/\s+/), key = rawKey.replace(/:$/, '');
    if ((name === 'memoryStats' && !memoryKeys.has(key)) || (name === 'vmMemory' && !vmKeys.has(key))) return [];
    return [[key, Number(rawValue)]];
  }));
};
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
const start = performance.now();
while (!stopped && performance.now() - start < duration) {
  const started = performance.now(), sample = { at: new Date().toISOString(), elapsedMs: started - start,
    node: process.version, metrics: {} };
  await Promise.all(Object.entries(files).map(async ([name, path]) => {
    try { sample[name] = parse(name, await readFile(path, 'utf8')); }
    catch (error) { sample[name] = { unavailable: error.code ?? 'ERROR' }; }
  }));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('metrics unavailable');
    const body = await response.text();
    if (body.length > 65536) throw new Error('oversized metrics');
    for (const line of body.split('\n')) {
      const match = line.match(/^([a-z_][a-z_0-9]*) ([0-9.eE+-]+)$/);
      if (match && Number.isFinite(Number(match[2]))) sample.metrics[match[1]] = Number(match[2]);
    }
  } catch { sample.metricsUnavailable = true; }
  sample.collectionMs = performance.now() - started;
  if (!process.stdout.write(JSON.stringify(sample) + '\n'))
    await new Promise(resolve => process.stdout.once('drain', resolve));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, interval - (performance.now() - started))));
}
