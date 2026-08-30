import re

with open("src/hooks/useSystemDiagnostics.js", "r") as f:
    content = f.read()

# Replace the fetchComputeDebt useEffect with a cached/polling version
new_effect = """
  const [computeDebt, setComputeDebt] = useState(() => {
    const cached = localStorage.getItem('axim_compute_debt_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 60000) {
          return parsed.data;
        }
      } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;

    const fetchComputeDebt = async () => {
      if (document.visibilityState === 'hidden') {
         timeoutId = setTimeout(fetchComputeDebt, 60000);
         return;
      }

      try {
        const { data, error } = await supabase
          .from('api_usage_logs')
          .select('satellite_app, tokens_used, compute_cost, gross_revenue');
        if (error) {
           console.error("Failed to fetch api_usage_logs", error);
        } else if (data) {
          const aggregated = {};
          data.forEach(log => {
             const app = log.satellite_app || 'unknown';
             if (!aggregated[app]) aggregated[app] = { computeCost: 0, revenue: 0 };
             aggregated[app].computeCost += Number(log.compute_cost) || 0;
             aggregated[app].revenue += Number(log.gross_revenue) || 0;
          });
          const result = Object.keys(aggregated).map(app => ({
             app,
             computeCost: aggregated[app].computeCost,
             revenue: aggregated[app].revenue,
             ratio: aggregated[app].revenue > 0 ? (aggregated[app].computeCost / aggregated[app].revenue) : 0
          }));
          if (isMounted) {
            setComputeDebt(result);
            localStorage.setItem('axim_compute_debt_cache', JSON.stringify({ data: result, timestamp: Date.now() }));
          }
        }
      } catch (e) {
        console.error("Compute debt fetch failed", e);
      }

      if (isMounted) {
         timeoutId = setTimeout(fetchComputeDebt, 60000);
      }
    };

    fetchComputeDebt();

    const handleVisibilityChange = () => {
       if (document.visibilityState === 'visible') {
          clearTimeout(timeoutId);
          fetchComputeDebt();
       }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
"""

content = re.sub(r"  const \[computeDebt, setComputeDebt\] = useState\(\[\]\);\s*useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);", new_effect.strip(), content)

with open("src/hooks/useSystemDiagnostics.js", "w") as f:
    f.write(content)
