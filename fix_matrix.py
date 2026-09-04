import re

with open("src/components/planner/MarketFeedMatrix.jsx", "r") as f:
    content = f.read()

# Mocking the checking and resetting of circuit breaker flag

search_fetch = """
      if (typeof _telemetry_timestamp === 'number') {
        const age = Date.now() - _telemetry_timestamp;
        setIsStale(age > 60000);
      }
"""

replace_fetch = """
      if (typeof _telemetry_timestamp === 'number') {
        const age = Date.now() - _telemetry_timestamp;
        setIsStale(age > 60000);
      }

      // Look for a simulated circuit breaker state from the edge or simulate if any asset has < -8 change
      const isCbTriggered = arr.some(a => a.change24h < -8.0);
      setIsCircuitBreaker(isCbTriggered || data.circuitBreakerActive === true);
"""

content = content.replace(search_fetch, replace_fetch)


search_reset = """
  const handlePanicCloseAll = async () => {
"""

replace_reset = """
  const handleResetCircuitBreaker = async () => {
     if (!window.confirm("WARNING: Are you sure you want to manually override and reset the volatility circuit breaker?")) return;
     try {
       // Since it's a simulated UI, just toggle it back and we'd ping the API.
       setIsCircuitBreaker(false);
       // Typically: fetch(getWorkerUrl('/api/admin/reset-circuit-breaker', ...))
     } catch (err) { /* ignore */ }
  };

  const handlePanicCloseAll = async () => {
"""

content = content.replace(search_reset, replace_reset)


search_ui = """
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
"""

replace_ui = """
      {isCircuitBreaker && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/50 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse">
           <div className="flex items-center gap-3">
              <SafeIcon name="AlertTriangle" className="w-8 h-8 text-amber-500" />
              <div>
                 <h3 className="text-amber-400 font-bold text-lg uppercase tracking-wider">Treasury Circuit Breaker Active</h3>
                 <p className="text-amber-500/80 text-sm">Flash-crash volatility detected (>8% drop). Automated execution halted.</p>
              </div>
           </div>
           <button
             onClick={handleResetCircuitBreaker}
             className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 rounded-lg font-bold text-sm uppercase tracking-wider transition-colors border border-amber-500/30"
           >
             Reset Circuit Breaker
           </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
"""

content = content.replace(search_ui, replace_ui)

with open("src/components/planner/MarketFeedMatrix.jsx", "w") as f:
    f.write(content)
