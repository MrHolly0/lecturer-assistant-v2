import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';

/** Bounded, aggregate-only diagnostics: no request data, identifiers or environment. */
export function runtimeDiagnostics({ intervalMs = 1000 } = {}) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let gcCount = 0, gcMs = 0, gcMaxMs = 0;
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gcCount++; gcMs += entry.duration; gcMaxMs = Math.max(gcMaxMs, entry.duration);
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  let lastTime = performance.now(), lastCpu = process.cpuUsage(), lastLoop = performance.eventLoopUtilization();
  let utilization = 0, cpuRatio = 0, sampleGapMaxMs = 0, loopMaxNs = 0, recentLoopNs = 0;
  const timer = setInterval(() => {
    const now = performance.now(), cpu = process.cpuUsage(), loop = performance.eventLoopUtilization();
    const elapsed = now - lastTime;
    utilization = performance.eventLoopUtilization(loop, lastLoop).utilization;
    cpuRatio = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / (elapsed * 1000);
    sampleGapMaxMs = Math.max(sampleGapMaxMs, elapsed);
    recentLoopNs = delay.max; loopMaxNs = Math.max(loopMaxNs, recentLoopNs); delay.reset();
    lastTime = now; lastCpu = cpu; lastLoop = loop;
  }, intervalMs);
  timer.unref();
  return {
    snapshot() {
      const cpu = process.cpuUsage(), resources = process.resourceUsage();
      const memory = process.memoryUsage();
      return {
        runtime_process_resident_memory_bytes: memory.rss,
        runtime_process_heap_used_bytes: memory.heapUsed,
        runtime_event_loop_utilization: utilization,
        runtime_process_cpu_ratio: cpuRatio,
        runtime_process_cpu_seconds_total: (cpu.user + cpu.system) / 1e6,
        runtime_event_loop_delay_max_seconds: Math.max(loopMaxNs, delay.max) / 1e9,
        runtime_event_loop_delay_recent_max_seconds: Math.max(recentLoopNs, delay.max) / 1e9,
        runtime_event_loop_delay_p99_seconds: delay.count ? delay.percentile(99) / 1e9 : 0,
        runtime_sample_max_gap_seconds: sampleGapMaxMs / 1000,
        runtime_gc_count_total: gcCount, runtime_gc_seconds_total: gcMs / 1000,
        runtime_gc_max_seconds: gcMaxMs / 1000,
        runtime_major_page_faults_total: resources.majorPageFault,
        runtime_involuntary_context_switches_total: resources.involuntaryContextSwitches,
        runtime_voluntary_context_switches_total: resources.voluntaryContextSwitches
      };
    },
    close() { clearInterval(timer); observer.disconnect(); delay.disable(); }
  };
}
