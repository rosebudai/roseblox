import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRpgWorld, queryMeleeTargets } from '../src/rpg.js';

test('melee finds multiple forward enemies within reach and respects real wall occlusion', async t => {
  const world = await createRpgWorld(); t.after(() => world.dispose());
  const origin = new THREE.Vector3(), forward = new THREE.Vector3(0,0,-1);
  const target = (id,x,y,z) => ({ id, position:new THREE.Vector3(x,y,z) });
  const candidates = [target('near',0,0,-2),target('side',1.5,0,-2),target('behind',0,0,1),target('far',0,0,-4),target('above',0,4,-1)];
  const visible = c => !world.castSegment(origin.clone().add(new THREE.Vector3(0,1,0)),c.position.clone().add(new THREE.Vector3(0,1,0)));
  assert.deepEqual(queryMeleeTargets(origin,forward,candidates,{visible}).map(c=>c.id),['near','side']);
  const wall=world.addBody({position:[0,1,-1],shape:{type:'box',size:[.6,2,.2]}});
  assert.deepEqual(queryMeleeTargets(origin,forward,candidates,{visible}).map(c=>c.id),['side']);
  wall.remove();
  assert.deepEqual(queryMeleeTargets(origin,new THREE.Vector3(0,0,1),candidates,{visible}).map(c=>c.id),['behind']);
});
