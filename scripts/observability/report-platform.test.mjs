import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizePlatformAssessment } from './report-platform.mjs';
test('missing telemetry is unknown, never 100 percent availability or zero cost',()=>{
 const r=summarizePlatformAssessment({volume:{dev:{httpStatus:403}},rules:{}});
 assert.equal(r.environments.dev.technicalSuccessRatio,null);
 assert.equal(r.environments.dev.auditStorageScenario,null);
});
test('separates measured latency denominators, policy deletion and audit cost assumptions',()=>{
 const r=summarizePlatformAssessment({indices:[{index:'.ds-logs-audit.otel-dev-test','docs.count':'100','store.size':'1000',pri:'1',rep:'0'}],
 streams:{data_streams:[{name:'logs-audit.otel-dev',ilm_policy:'logs'}]},policies:{logs:{policy:{phases:{hot:{}}}}},
 volume:{dev:{hits:{total:{value:20,relation:'eq'}},aggregations:{serverHttp:{doc_count:10,errors:{doc_count:1},measured:{doc_count:5,fast:{doc_count:4},latency:{values:{'95.0':800}}}}}}},rules:{}});
 assert.equal(r.environments.dev.technicalSuccessRatio,0.9);
 assert.equal(r.environments.dev.requestsWithin500msRatio,0.8);
 assert.equal(r.environments.dev.streamsWithoutExplicitDeletion,1);
 assert.equal(r.environments.dev.auditStorageScenario.estimatedBytesFor7Days,1400);
});
