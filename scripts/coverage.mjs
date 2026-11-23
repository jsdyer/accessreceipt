// Record only events observed before the axe capture finishes. Browser shutdown
// aborts are not evidence that the assessed page failed to load.
const criticalTypes = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);
const readMethods = new Set(['GET', 'HEAD']);
export function createCoverageTracker() {
  let active = true, budgetExhausted = false;
  const criticalFailures = new Set(), nonReadPolicyBlocks = new WeakSet();
  const pending = new Set();
  const critical = request => readMethods.has(request.method()) && criticalTypes.has(request.resourceType());
  return {
    started(request) { if (active && critical(request)) pending.add(request); },
    finished(request) { if (active) pending.delete(request); },
    blocked(request, reason) {
      if (!active) return;
      if (reason === 'budget') budgetExhausted = true;
      if (reason === 'non-read') nonReadPolicyBlocks.add(request);
      else if (critical(request)) criticalFailures.add(request);
      pending.delete(request);
    },
    failed(request) {
      if (!active) return;
      if (critical(request) && !nonReadPolicyBlocks.has(request)) criticalFailures.add(request);
      pending.delete(request);
    },
    httpError(request) { if (active && critical(request) && !nonReadPolicyBlocks.has(request)) criticalFailures.add(request); },
    finish() {
      active = false;
      return {status: budgetExhausted || criticalFailures.size || pending.size ? 'degraded' : 'complete',
        budgetExhausted, criticalFailures: criticalFailures.size, pendingCritical: pending.size};
    }
  };
}
