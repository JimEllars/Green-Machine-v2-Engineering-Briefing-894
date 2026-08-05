const fs = require('fs');

let content = fs.readFileSync('edge-ledger-worker/src/thirdweb_bridge.ts', 'utf8');

const logSaveSearch = `        await env.GREEN_STATE.put(\`ai_consult_log:\${Date.now()}\`, JSON.stringify({
            riskViolation: parsed.riskViolation || false,
            riskLevel: parsed.riskLevel || 'Unknown',
            timestamp: Date.now(),
            ai_inference_ms: duration
        }), { expirationTtl: 86400 });`;

const logSaveReplace = `        await env.GREEN_STATE.put(\`ai_consult_log:\${Date.now()}\`, JSON.stringify({
            riskViolation: parsed.riskViolation || false,
            riskLevel: parsed.riskLevel || 'Unknown',
            timestamp: Date.now(),
            ai_inference_ms: duration,
            model_used: aiModel
        }), { expirationTtl: 86400 });`;

content = content.replace(logSaveSearch, logSaveReplace);


const aggregateSearch = `             let total_inference_ms = 0;
             let count_ms = 0;
             for (const key of consultList) {
                  try {
                      const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                      if (logData.ai_inference_ms) {
                          total_inference_ms += logData.ai_inference_ms;
                          count_ms++;
                      }
                  } catch(e) {}
             }
             let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
             return { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms };`;

const aggregateReplace = `             let total_inference_ms = 0;
             let count_ms = 0;
             let llama_count = 0;
             let mistral_count = 0;
             for (const key of consultList) {
                  try {
                      const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                      if (logData.ai_inference_ms) {
                          total_inference_ms += logData.ai_inference_ms;
                          count_ms++;
                      }
                      if (logData.model_used === 'mistral-7b') {
                          mistral_count++;
                      } else {
                          llama_count++;
                      }
                  } catch(e) {}
             }
             let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
             let total_models = llama_count + mistral_count;
             let model_usage = {
                llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
                mistral_7b_pct: total_models > 0 ? (mistral_count / total_models) * 100 : 0
             };
             return { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms, model_usage };`;


content = content.replace(aggregateSearch, aggregateReplace);


const aggregateSearch2 = `        let total_inference_ms = 0;
        let count_ms = 0;
        for (const key of consultList) {
            try {
                const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                if (logData.ai_inference_ms) {
                    total_inference_ms += logData.ai_inference_ms;
                    count_ms++;
                }
            } catch(e) {}
        }
        let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;`;

const aggregateReplace2 = `        let total_inference_ms = 0;
        let count_ms = 0;
        let llama_count = 0;
        let mistral_count = 0;
        for (const key of consultList) {
            try {
                const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                if (logData.ai_inference_ms) {
                    total_inference_ms += logData.ai_inference_ms;
                    count_ms++;
                }
                if (logData.model_used === 'mistral-7b') {
                    mistral_count++;
                } else {
                    llama_count++;
                }
            } catch(e) {}
        }
        let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
        let total_models = llama_count + mistral_count;
        let model_usage = {
           llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
           mistral_7b_pct: total_models > 0 ? (mistral_count / total_models) * 100 : 0
        };`;

content = content.replace(aggregateSearch2, aggregateReplace2);

const telemetrySaveSearch = `           investing_brain_telemetry: { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms },`;
const telemetrySaveReplace = `           investing_brain_telemetry: { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms, model_usage },`;

content = content.replace(telemetrySaveSearch, telemetrySaveReplace);

fs.writeFileSync('edge-ledger-worker/src/thirdweb_bridge.ts', content);
