import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=randomBytes(8).toString('hex');
const prefix='tap96-release-'+id;
const network=prefix+'-net', es=prefix+'-es', collector=prefix+'-collector';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),prefix+'-'));
const owned=[];
function docker(args) {
 const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:120000});
 if(r.status!==0) throw new Error('Disposable observability Docker operation failed: '+args[0]);
 return r.stdout.trim();
}
async function port() {const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const esPort=await port(), otlpPort=await port();
let networkCreated=false;
try {
 docker(['network','create','--label','codex.purpose=tap96-release-qa','--label','codex.run='+id,network]);networkCreated=true;
 docker(['run','-d','--rm','--name',es,'--label','codex.purpose=tap96-release-qa','--label','codex.run='+id,'--network',network,'--network-alias','es','-p',`127.0.0.1:${esPort}:9200`,'--memory','2g','-e','discovery.type=single-node','-e','xpack.security.enabled=false','-e','ES_JAVA_OPTS=-Xms512m -Xmx512m','--tmpfs','/usr/share/elasticsearch/data:rw,size=1g','docker.elastic.co/elasticsearch/elasticsearch:8.17.0']);owned.push(es);
 let ready=false;
 for(let i=0;i<90;i++) {try {const r=await fetch(`http://127.0.0.1:${esPort}/_cluster/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
 if(!ready) throw new Error('Disposable Elasticsearch startup timeout');
 const mapping=await fetch(`http://127.0.0.1:${esPort}/_component_template/metrics-otel@custom`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({template:{mappings:{properties:{_metric_names_hash:{type:'keyword',time_series_dimension:true}}}}})});
 if(!mapping.ok) throw new Error('Disposable metric compatibility mapping failed');
 const config=path.join(temp,'collector.yaml');
 await fs.writeFile(config,`receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\nprocessors:\n  transform/dataset:\n    error_mode: propagate\n    log_statements:\n      - context: log\n        statements:\n          - set(attributes["data_stream.dataset"], "technical")\n          - set(attributes["data_stream.dataset"], "audit") where attributes["event.category"] == "audit"\n    metric_statements:\n      - context: resource\n        statements:\n          - set(attributes["data_stream.dataset"], "generic")\n  batch:\n    timeout: 1s\nexporters:\n  elasticsearch:\n    endpoint: http://es:9200\n    mapping:\n      mode: otel\n    logs_dynamic_index:\n      enabled: true\n    metrics_dynamic_index:\n      enabled: true\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      processors: [transform/dataset, batch]\n      exporters: [elasticsearch]\n    metrics:\n      receivers: [otlp]\n      processors: [transform/dataset, batch]\n      exporters: [elasticsearch]\n`);
 docker(['run','-d','--rm','--name',collector,'--label','codex.purpose=tap96-release-qa','--label','codex.run='+id,'--network',network,'-p',`127.0.0.1:${otlpPort}:4318`,'--mount',`type=bind,source=${config},target=/etc/otelcol-contrib/config.yaml,readonly`,'otel/opentelemetry-collector-contrib:0.130.1','--config=/etc/otelcol-contrib/config.yaml']);owned.push(collector);
 const endpoint=`http://127.0.0.1:${otlpPort}`;
 const env={...process.env,TAP96_ES_URL:`http://127.0.0.1:${esPort}`,PDV_QA_EDOT_CAPTURE_PINO:'1',OTEL_EXPORTER_OTLP_ENDPOINT:endpoint,OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:endpoint+'/v1/logs',OTEL_TRACES_EXPORTER:'none',OTEL_LOGS_EXPORTER:'otlp',OTEL_METRICS_EXPORTER:'otlp',OTEL_METRIC_EXPORT_INTERVAL:'10000',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=development,data_stream.namespace=dev',ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING:'false'};
 console.log('OBSERVABILITY_QA_ISOLATED=YES; destination=disposable; shared_DEV=NO; PROD=NO');
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','../scripts/node24-tsx-host.mjs','--import','tsx','scripts/run-e2e-release-disposable-qa.mjs',...process.argv.slice(2)],{cwd:backend,env,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',c=>resolve(c??1));});
 if(code!==0) throw new Error('Release regression failed; inspect case evidence');
 console.log('OBSERVABILITY_RELEASE_QA=PASS');
} finally {
 for(const name of owned.reverse()) {
  const raw=docker(['inspect',name]);const data=JSON.parse(raw)[0];
  if(data.Config.Labels['codex.run']!==id||data.Config.Labels['codex.purpose']!=='tap96-release-qa') throw new Error('QA ownership mismatch');
  docker(['stop','--timeout','5',name]);
 }
 if(networkCreated) docker(['network','rm',network]);
 if(!path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(temp).startsWith(prefix+'-')) throw new Error('Invalid QA cleanup path');
 await fs.rm(temp,{recursive:true,force:true});
 console.log('OBSERVABILITY_QA_CLEANUP=PASS');
}
