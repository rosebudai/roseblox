import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "miniplex";
import { createVoxelKit } from "../src/voxelKit.js";
import { disposeObject } from "../src/resources/renderer/disposeObject.js";

// Test real seeded scenery placement without a renderer or physics simulation.
function fixture(t) {
  const world=new World(),scene=new THREE.Scene();
  const warnings=[];
  t.mock.method(console,"warn",message=>warnings.push(message));
  const game={world,scene,renderer:{},engine:{initialized:true,disposed:false,addResource(){}},
    onFrame:()=>()=>{},addCameraObstacle:()=>()=>{},
    addBox({size,position,color,body="fixed"}) {
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color}));
      mesh.position.set(...position);
      const entity={mesh,transform:{position:mesh.position.clone()},data:{body}};
      scene.add(mesh);world.add(entity);return entity;
    },
  };
  const unsubscribe=world.onEntityRemoved.subscribe(entity=>{entity.mesh.removeFromParent();disposeObject(entity.mesh);});
  const kit=createVoxelKit(game,{seed:27,lighting:false});
  t.after(()=>{kit.dispose();unsubscribe();});
  return {game,kit,warnings};
}

test("positive empty scatter warns once, returns an empty disposable handle and adds no terrain", t => {
  const {game,kit,warnings}=fixture(t);
  kit.ground({size:[8,1,24],position:[0,-.5,-8]});
  kit.ground({size:[2,1.4,24],position:[-5,-.7,-8]});
  kit.ground({size:[2,1.4,24],position:[5,-.7,-8]});
  kit.ground({size:[8,1,5],position:[0,-.5,6.5]});
  kit.ground({size:[8,1,4],position:[0,-.5,-22]});
  const before=game.world.entities.length;
  const trees=kit.scatter("trees",{count:34,bounds:[-14,14,-24,11],exclude:[-6,6,-25,11]});
  assert.equal(trees.count,0);
  assert.equal(trees.object.count,0);
  assert.equal(game.world.entities.length,before,"scatter must not silently add supporting terrain");
  assert.equal(warnings.length,1);
  assert.match(warnings[0],/trees: placed 0\/34/);
  assert.match(warnings[0],/after bounds\/exclude sampling/);
  assert.match(warnings[0],/kit\.ground coverage, bounds and exclude.*returned count/);
  trees.dispose();trees.dispose();assert.equal(trees.object.parent,null);
  assert.equal(warnings.length,1);
});

test("intentional count zero stays silent and clouds do not require ground", t => {
  const {kit,warnings}=fixture(t);
  for(const kind of ["trees","rocks","flowers","clouds"]) {
    const empty=kit.scatter(kind,{count:0});
    assert.equal(empty.count,0);empty.dispose();
  }
  assert.equal(kit.scatter("clouds",{count:3}).count,3);
  assert.deepEqual(warnings,[]);
});

test("documented visual background support places the requested trees at its actual height without warnings", t => {
  const {kit,warnings}=fixture(t);
  const background=kit.ground({size:[32,1,40],position:[0,-1,-8],body:"none"});
  const trees=kit.scatter("trees",{count:34,bounds:[-15,15,-27,11],exclude:[-5,5,-24,9]});
  assert.equal(background.data.body,"none","visual support remains the caller's explicit body choice");
  assert.equal(trees.count,34);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  for(let i=0;i<trees.object.count;i+=3) {
    trees.object.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    assert.ok(Math.abs(position.y-scale.y/2-(-.5))<1e-5,"tree trunk rests on the background's top surface");
  }
  assert.deepEqual(warnings,[]);
});
