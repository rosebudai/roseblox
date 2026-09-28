import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRpgWorld, queryMeleeTargets, queryRangedTarget } from '../src/rpg.js';

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

test('ranged soft lock prefers the enemy nearest the crosshair, in range, in front of the shooter and visible', () => {
  const eye = new THREE.Vector3(0,3,6), from = new THREE.Vector3(0,1.3,0), aim = new THREE.Vector3(0,-.25,-1);
  const target = (id,x,y,z) => ({ id, position:new THREE.Vector3(x,y,z) });
  const center = target('center',0,1,-8), side = target('side',2.5,1,-8);
  const others = [target('wide',9,1,-5), target('between',0,1,3), target('far',0,1,-60)];
  const pick = (candidates, options) => queryRangedTarget(eye, aim, from, candidates, options)?.id ?? null;
  assert.equal(pick([...others, side, center]), 'center');
  assert.equal(pick([...others, side]), 'side');
  assert.equal(pick([...others, side, center], { visible: c => c !== center }), 'side');
  assert.equal(pick([side], { cone: .06 }), null, 'a narrow first-person cone needs real aim');
  assert.equal(pick(others), null, 'out of cone, behind the shooter, or out of range');
  assert.throws(() => queryRangedTarget(eye, aim, from, [], { range: 0 }), /positive/);
});
