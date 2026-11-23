import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,validatePublicURL,resolvePublic} from '../scripts/network.mjs';

test('public-address policy rejects local, private, mapped, reserved and link-local targets', () => {
  for (const address of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','255.255.255.255','224.0.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','::','fc00::1','fe80::1','ff02::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true); assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});
test('scan URLs reject credentials, private protocols, ports and sensitive query parameters', () => {
  for (const url of ['file:///etc/passwd','http://localhost/','http://localhost.example.local/','http://127.1/','http://2130706433/','http://[::1]/','https://user:password@example.com/','https://example.com:8080/','https://example.com/?api_key=secret','https://example.com/?token=secret','http://intranet/']) assert.throws(()=>validatePublicURL(url),url);
  assert.equal(validatePublicURL('https://example.com/?q=heading#chapter').href,'https://example.com/?q=heading');
});
test('a mixed public/private DNS answer is rejected; returned address is pinned input for socket', async () => {
  await assert.rejects(()=>resolvePublic('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
  let calls=0; const answer=await resolvePublic('example.com',async()=>{calls++;return [{address:'8.8.8.8',family:4}]});
  assert.deepEqual(answer,{address:'8.8.8.8',family:4}); assert.equal(calls,1);
  await assert.rejects(()=>resolvePublic('example.com',async()=>[]));
});
