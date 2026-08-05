const fs = require('fs');

let content = fs.readFileSync('src/components/planner/SystemDiagnosticsPanel.jsx', 'utf8');

const search = `        {/* Realtime Status Badge */}
        <div className={\`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors \${
          realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
          (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]' :
          'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_10px_rgba(243,24,73,0.3)]'
        }\`}>
          <div className={\`w-1.5 h-1.5 rounded-full \${
            realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500 animate-pulse' :
            (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500 animate-pulse' :
            'bg-rose-500'
          }\`} />
          {realtimeStatus === 'SUBSCRIBED' ? 'Realtime: Subscribed' :
           (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'Realtime: Fallback Polling (30s)' :
           'Realtime: Offline'}
        </div>

        </div>
      </div>`;

const replace = `        {/* Realtime Status Badge */}
        <div className={\`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors \${
          realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
          (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]' :
          'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_10px_rgba(243,24,73,0.3)]'
        }\`}>
          <div className={\`w-1.5 h-1.5 rounded-full \${
            realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500 animate-pulse' :
            (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500 animate-pulse' :
            'bg-rose-500'
          }\`} />
          {realtimeStatus === 'SUBSCRIBED' ? 'Realtime: Subscribed' :
           (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'Realtime: Fallback Polling (30s)' :
           'Realtime: Offline'}
        </div>

        {/* DLQ Auto-Heal Telemetry Badge */}
        {dlqStatus?.dlq_autoheal_telemetry && (
          <div className={\`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors \${
            dlqStatus.dlq_autoheal_telemetry.status === 'HEALTHY' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
            'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
          }\`}>
            <div className={\`w-1.5 h-1.5 rounded-full \${
              dlqStatus.dlq_autoheal_telemetry.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            }\`} />
            {dlqStatus.dlq_autoheal_telemetry.status === 'HEALTHY' ? \`DLQ Auto-Heal: Operational (\${dlqStatus.dlq_autoheal_telemetry.healed_24h || 0} Healed)\` : 'DLQ Auto-Heal: Retrying DB Connection'}
          </div>
        )}

        </div>
      </div>`;

if(content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync('src/components/planner/SystemDiagnosticsPanel.jsx', content);
    console.log('Patched');
} else {
    console.log('Search string not found');
}
