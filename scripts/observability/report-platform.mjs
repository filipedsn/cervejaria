import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HTTP_ACTIONS=['http.get','http.post','http.put','http.patch','http.delete'];
/** Read-only queries. The caller owns authentication; no credentials enter the report. */
export async function collectPlatformAssessment(request) {
  const report={measuredAt:new Date().toISOString(),windowHours:24};
  report.version=(await request('/')).version?.number;
  report.health=await request('/_cluster/health');
  report.license=await request('/_license?filter_path=license.type,license.status');
  report.indices=await request('/_cat/indices/*otel*?format=json&bytes=b&h=index,docs.count,store.size,pri.store.size,pri,rep');
  report.streams=await request('/_data_stream/*otel*?filter_path=data_streams.name,data_streams.ilm_policy,data_streams.lifecycle');
  report.policies=await request('/_ilm/policy');
  report.volume={};
  for(const env of ['dev','prd']) report.volume[env]=await request(`/logs-audit*.otel-${env}*/_search`,{
    size:0,track_total_hits:true,query:{range:{'@timestamp':{gte:'now-24h'}}},aggs:{
      latest:{max:{field:'@timestamp'}},actions:{terms:{field:'attributes.event.action',size:50}},
      withId:{filter:{exists:{field:'attributes.event.id'}},aggs:{unique:{cardinality:{field:'attributes.event.id',precision_threshold:40000}}}},
      serverHttp:{filter:{terms:{'attributes.event.action':HTTP_ACTIONS}},aggs:{
        errors:{filter:{range:{'attributes.http.response.status_code':{gte:500}}}},
        measured:{filter:{exists:{field:'attributes.http.response.duration_ms'}},aggs:{
          fast:{filter:{range:{'attributes.http.response.duration_ms':{lte:500}}}},
          latency:{percentiles:{field:'attributes.http.response.duration_ms',percents:[50,95,99]}},
        }},
      }},
    },
  });
  const spaces=await request('/api/spaces/space',undefined,true);
  report.rules={};
  for(const space of Array.isArray(spaces)?spaces:[{id:'default'}]) {
    const prefix=space.id==='default'?'':'/s/'+encodeURIComponent(space.id);
    const result=await request(prefix+'/api/alerting/rules/_find?per_page=100',undefined,true);
    report.rules[space.id]=result.data?.map(rule=>({id:rule.id,name:rule.name,enabled:rule.enabled,type:rule.rule_type_id,schedule:rule.schedule,execution:rule.execution_status,lastRun:rule.last_run,actionCount:rule.actions?.length??0}))??result;
  }
  return {raw:report,summary:summarizePlatformAssessment(report)};
}

export function summarizePlatformAssessment(raw) {
  const groups={};
  if(Array.isArray(raw.indices)) for(const i of raw.indices) {
    const env=i.index.includes('.otel-dev')?'dev':i.index.includes('.otel-prd')?'prd':'infra_or_other';
    const group=groups[env]??={indices:0,documents:0,bytes:0,primaries:0,configuredReplicas:0};
    group.indices++;group.documents+=Number(i['docs.count'])||0;group.bytes+=Number(i['store.size'])||0;group.primaries+=Number(i.pri)||0;group.configuredReplicas+=Number(i.rep)||0;
  }
  const environments={};
  for(const env of ['dev','prd']) {
    const data=raw.volume?.[env],agg=data?.aggregations;
    const docs=data?.hits?.total?.relation==='eq'?data.hits.total.value:null;
    const http=agg?.serverHttp,measured=http?.measured;
    const streamPolicies=(raw.streams?.data_streams??[]).filter(s=>s.name.endsWith('.otel-'+env)).map(s=>({policy:s.ilm_policy??null,deleteAfter:raw.policies?.[s.ilm_policy]?.policy?.phases?.delete?.min_age??null,dataRetention:s.lifecycle?.data_retention??null}));
    const averageBytes=groups[env]?.documents>0?groups[env].bytes/groups[env].documents:null;
    environments[env]={auditDocuments24h:docs,latestEvent:agg?.latest?.value_as_string??null,
      technicalSuccessRatio:http?.doc_count>0?(http.doc_count-http.errors.doc_count)/http.doc_count:null,
      eligibleServerRequests:http?.doc_count??null,measuredLatencyRequests:measured?.doc_count??null,
      requestsWithin500msRatio:measured?.doc_count>0?measured.fast.doc_count/measured.doc_count:null,
      latencyPercentilesMs:measured?.latency?.values??null,
      eventsWithId:agg?.withId?.doc_count??null,estimatedUniqueEventIds:agg?.withId?.unique?.value??null,
      streams:streamPolicies.length,streamsWithoutExplicitDeletion:streamPolicies.filter(s=>!s.deleteAfter&&!s.dataRetention).length,
      policyDistribution:streamPolicies.reduce((acc,s)=>{const key=s.policy??'no_policy';acc[key]=(acc[key]??0)+1;return acc;},{}),
      auditStorageScenario:docs!==null&&averageBytes!==null?{estimatedBytesPerDay:docs*averageBytes,estimatedBytesFor7Days:docs*averageBytes*7,estimatedBytesFor30Days:docs*averageBytes*30,assumption:'24h audit documents multiplied by historical mixed-signal average bytes/document; capacity scenario, not a bill or precise audit size'}:null,
    };
  }
  return {measuredAt:raw.measuredAt,version:raw.version,license:raw.license?.license,health:raw.health?.status,
    activePrimaryShards:raw.health?.active_primary_shards,unassignedPrimaryShards:raw.health?.unassigned_primary_shards,unassignedShards:raw.health?.unassigned_shards,
    groups,environments,rules:raw.rules,
    limitations:['HTTP SLI covers audited server routes; excludes polling and missing telemetry, so it is not full application availability.','Older records without event.id cannot be reliably deduplicated; cardinality is an estimate.','ILM delete min_age is relative to rollover when rollover applies.','No currency estimate without an agreed unit price; no retention/deletion changes are performed.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const es=process.env.ELASTICSEARCH_URL??'http://127.0.0.1:9200';
  const kibana=process.env.KIBANA_URL??'http://127.0.0.1:5601';
  const authorization=process.env.ELASTIC_API_KEY?'ApiKey '+process.env.ELASTIC_API_KEY:process.env.ELASTIC_PASSWORD?'Basic '+Buffer.from((process.env.ELASTIC_USER??'elastic')+':'+process.env.ELASTIC_PASSWORD).toString('base64'):undefined;
  if(!authorization) throw new Error('Configure an authorized Elastic read credential in the environment.');
  const result=await collectPlatformAssessment(async(route,body,isKibana)=>{
    const response=await fetch((isKibana?kibana:es)+route,{method:body?'POST':'GET',headers:{Authorization:authorization,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    return response.ok?response.json():{httpStatus:response.status};
  });
  const output=process.argv[2]??'work/observability-platform-assessment.json';
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.summary,null,2));
}
