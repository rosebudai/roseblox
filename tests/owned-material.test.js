import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createOwnedMaterial } from "../src/resources/renderer/ownedMaterial.js";
import { disposeObject } from "../src/resources/renderer/disposeObject.js";

const countDisposals = resource => { let count = 0; resource.addEventListener("dispose", () => count++); return () => count; };
const texture = () => new THREE.DataTexture(new Uint8Array([255,128,0,255]),1,1);

test("Basic and Standard instances preserve shader type and independent material/texture state", () => {
  const map=texture(); const source=new THREE.MeshBasicMaterial({map,color:0x345678,transparent:true,opacity:.4});
  const sourceDisposals=countDisposals(source), mapDisposals=countDisposals(map);
  const one=createOwnedMaterial(source,{color:0xffffff,roughness:.7}),two=createOwnedMaterial(source);
  assert.ok(one instanceof THREE.MeshBasicMaterial); assert.equal(one.isMeshStandardMaterial,undefined);
  assert.equal(one.type,"MeshBasicMaterial"); assert.equal(one.opacity,.4);
  assert.equal(one.color.getHex(),0x345678);
  assert.notEqual(one.map,map);assert.notEqual(one.map,two.map);assert.equal(one.map.source,map.source);
  one.color.set(0xff0000);one.map.repeat.set(4,5);
  assert.equal(source.color.getHex(),0x345678);assert.equal(two.color.getHex(),0x345678);
  assert.deepEqual(two.map.repeat.toArray(),[1,1]);assert.deepEqual(map.repeat.toArray(),[1,1]);
  const oneMapDisposals=countDisposals(one.map),oneDisposals=countDisposals(one);
  disposeObject({material:one});one.dispose();one.map.dispose();
  assert.equal(oneMapDisposals(),1);assert.equal(oneDisposals(),1);
  assert.equal(sourceDisposals(),0);assert.equal(mapDisposals(),0);
  const secondDisposals=countDisposals(two.map);two.dispose();assert.equal(secondDisposals(),1);
  const standardSource=new THREE.MeshStandardMaterial({metalness:.9});
  const standard=createOwnedMaterial(standardSource);assert.ok(standard instanceof THREE.MeshStandardMaterial);assert.equal(standard.metalness,.9);standard.dispose();
  source.dispose();map.dispose();standardSource.dispose();
});

test("parameter objects retain Standard defaults and safely own shared texture wrappers", () => {
  const map=texture(),calls=countDisposals(map);
  const material=createOwnedMaterial({map,emissiveMap:map,roughness:.2},{color:0x68b8ff,roughness:.7});
  assert.ok(material instanceof THREE.MeshStandardMaterial);assert.equal(material.roughness,.2);
  assert.equal(material.color.getHex(),0x68b8ff);assert.notEqual(material.map,map);
  assert.equal(material.map,material.emissiveMap,"shared slots reuse one owned wrapper");
  const ownedCalls=countDisposals(material.map);disposeObject({material});
  assert.equal(ownedCalls(),1);assert.equal(calls(),0);map.dispose();
});

test("shader uniforms preserve nested texture ownership and release it without touching another instance", () => {
  const map=texture(),sourceCalls=countDisposals(map);
  const source=new THREE.ShaderMaterial({
    uniforms:{direct:{value:map},layers:{value:[map,{albedo:map}]},settings:{value:{tint:new THREE.Color(0x123456),nested:{map}}}},
    vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'void main(){gl_FragColor=vec4(1.0);}',
  });
  const hook=()=>{};source.onBeforeCompile=hook;
  const one=createOwnedMaterial(source),two=createOwnedMaterial(source);
  assert.ok(one instanceof THREE.ShaderMaterial);assert.equal(one.vertexShader,source.vertexShader);assert.equal(one.onBeforeCompile,hook);
  const owned=one.uniforms.direct.value;
  assert.notEqual(owned,map);assert.equal(one.uniforms.layers.value[0],owned);
  assert.equal(one.uniforms.layers.value[1].albedo,owned);assert.equal(one.uniforms.settings.value.nested.map,owned);
  one.uniforms.settings.value.tint.set(0xffffff);
  assert.equal(source.uniforms.settings.value.tint.getHex(),0x123456);assert.equal(two.uniforms.settings.value.tint.getHex(),0x123456);
  const calls=countDisposals(owned),otherCalls=countDisposals(two.uniforms.direct.value);
  disposeObject({material:one});one.dispose();assert.equal(calls(),1);assert.equal(otherCalls(),0);assert.equal(sourceCalls(),0);
  two.dispose();assert.equal(otherCalls(),1);source.dispose();map.dispose();
});

test("unsupported live render-target inputs fail without disposing caller resources", () => {
  const target=new THREE.WebGLRenderTarget(8,8);const calls=countDisposals(target.texture);
  const source=new THREE.ShaderMaterial({uniforms:{image:{value:target.texture}}});
  assert.throws(()=>createOwnedMaterial(source),/live render-target/);
  assert.throws(()=>createOwnedMaterial({map:target.texture}),/live render-target/);
  assert.throws(()=>createOwnedMaterial([]),/parameter object/);
  assert.equal(calls(),0);source.dispose();target.dispose();
});
