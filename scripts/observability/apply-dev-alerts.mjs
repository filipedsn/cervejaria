import fs from 'node:fs/promises';

export const DEV_RULE_FILES=['kibana-alert-http-5xx-dev.json','kibana-alert-db-technical-failure-dev.json','kibana-alert-telemetry-gap-dev.json'];
export function validateDevRule(rule) {
  if(!rule.name?.endsWith('-dev')||!rule.tags?.includes('TAP-96')||!rule.tags?.includes('development'))throw new Error('DEV rule identity required');
  if(!Array.isArray(rule.params?.index)||!rule.params.index.length||rule.params.index.some(index=>!index.endsWith('.otel-dev*')))throw new Error('Only DEV data streams are permitted');
  if(rule.actions?.length!==0)throw new Error('This deployment does not authorize external notifications');
  if(rule.params.excludeHitsFromPreviousRun!==false)throw new Error('A stable evaluation window is required');
}

/** Applies only the named TAP-96 DEV rules, leaving every other rule untouched. */
export async function applyDevAlerts(request,rules) {
  rules.forEach(validateDevRule);
  const listing=await request('/api/alerting/rules/_find?per_page=100',undefined,true);
  if(!Array.isArray(listing.data))throw new Error('Cannot inventory existing rules');
  const result=[];
  for(const rule of rules) {
    const matches=listing.data.filter(existing=>existing.name===rule.name);
    if(matches.length>1)throw new Error('Duplicate DEV rule name; refusing ambiguous update');
    let response;
    if(matches.length) {
      const existing=matches[0];
      if(!existing.tags?.includes('TAP-96')||existing.actions?.length!==0)throw new Error('Existing rule is not an unmodified TAP-96 DEV rule');
      const {name,tags,schedule,params,actions,notify_when}=rule;
      response=await request('/api/alerting/rule/'+encodeURIComponent(existing.id),{name,tags,schedule,params,actions,notify_when},true,'PUT');
      if(!existing.enabled){const enabled=await request('/api/alerting/rule/'+encodeURIComponent(existing.id)+'/_enable',undefined,true,'POST');if(enabled.httpStatus)throw new Error('DEV rule enable failed');response.enabled=true;}
    } else response=await request('/api/alerting/rule',rule,true,'POST');
    if(response.httpStatus||!response.id)throw new Error('DEV rule application failed: '+rule.name);
    result.push({id:response.id,name:rule.name,enabled:response.enabled??true,notifications:'none'});
  }
  return result;
}

export async function loadDevRules(root) {
  return Promise.all(DEV_RULE_FILES.map(file=>fs.readFile(root+'/deploy/observability/'+file,'utf8').then(JSON.parse)));
}
