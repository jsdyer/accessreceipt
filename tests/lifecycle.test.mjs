import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createResourceTracker,trackHTTPExchange} from '../scripts/network.mjs';
import {createCoverageTracker} from '../scripts/coverage.mjs';
class Resource extends EventEmitter {
  destroyed=false;
  destroy() { if (!this.destroyed) { this.destroyed=true; this.emit('close'); } }
}
function exchange() {
  const tracker=createResourceTracker(), request=new Resource(), response=new Resource(), upstream=new Resource(), body=new Resource(), socket=new Resource();
  trackHTTPExchange(request,response,upstream,resource=>tracker.track(resource));
  upstream.emit('socket',socket);upstream.emit('response',body);
  return {tracker,request,response,upstream,body,socket};
}
test('browser disconnect destroys an active HTTP request and streaming response', () => {
  for (const trigger of ['response-close','request-abort','timeout']) {
    const e=exchange();
    if (trigger==='response-close') e.response.destroy();
    else if (trigger==='request-abort') e.request.emit('aborted');
    else e.upstream.emit('timeout');
    assert.equal(e.upstream.destroyed,true,trigger);assert.equal(e.body.destroyed,true,trigger);
  }
});
test('proxy shutdown destroys HTTP requests, bodies and sockets, including late resources', () => {
  const e=exchange();e.tracker.close();
  for(const resource of [e.upstream,e.body,e.socket]) assert.equal(resource.destroyed,true);
  const late=new Resource();e.tracker.track(late);assert.equal(late.destroyed,true);
});
const req=(type,method='GET')=>({resourceType:()=>type,method:()=>method});
test('critical read-resource failures, HTTP errors and unfinished requests degrade coverage', () => {
  for (const type of ['document','script','stylesheet','fetch','xhr']) {
    for (const outcome of ['failed','httpError','pending']) {
      const tracker=createCoverageTracker(), request=req(type);tracker.started(request);
      if(outcome!=='pending') tracker[outcome](request);
      assert.equal(tracker.finish().status,'degraded',`${type} ${outcome}`);
    }
  }
});
test('successful reads produce comparable coverage; budget exhaustion is explicit', () => {
  const tracker=createCoverageTracker(), request=req('script');tracker.started(request);tracker.finished(request);
  assert.deepEqual(tracker.finish(),{status:'complete',budgetExhausted:false,criticalFailures:0,pendingCritical:0});
  const limited=createCoverageTracker();limited.blocked(req('image'),'budget');assert.equal(limited.finish().budgetExhausted,true);assert.equal(limited.finish().status,'degraded');
});
test('non-read telemetry policy blocks and shutdown aborts do not degrade captured coverage', () => {
  const tracker=createCoverageTracker(), telemetry=req('fetch','POST'), image=req('image');
  tracker.started(telemetry);tracker.blocked(telemetry,'non-read');tracker.failed(telemetry);tracker.failed(image);
  const captured=tracker.finish();assert.equal(captured.status,'complete');
  tracker.failed(req('script'));tracker.blocked(req('fetch'),'budget');
  assert.deepEqual(tracker.finish(),captured);
});
