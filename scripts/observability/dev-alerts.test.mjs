import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { applyDevAlerts,loadDevRules,validateDevRule } from './apply-dev-alerts.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('versioned operational rules cannot target production or notify externally',async()=>{
 const rules=await loadDevRules(root);rules.forEach(validateDevRule);
 for(const rule of rules){assert.throws(()=>validateDevRule({...rule,params:{...rule.params,index:['logs-*.otel-prd*']}}));assert.throws(()=>validateDevRule({...rule,actions:[{id:'external'}]}));}
});
test('refuses to overwrite an existing rule with independently configured notifications',async()=>{
 const [rule]=await loadDevRules(root);let mutations=0;
 await assert.rejects(applyDevAlerts(async(_path,body)=>{if(body)mutations++;return {data:[{...rule,id:'existing',actions:[{id:'configured-by-operator'}]}]};},[rule]));
 assert.equal(mutations,0);
});
