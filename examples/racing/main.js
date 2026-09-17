import * as THREE from 'three';
import { createMechanics } from '../../build/mechanics.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#98d4f4'); scene.fog = new THREE.Fog('#98d4f4', 140, 310);
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, .1, 400);
scene.add(new THREE.HemisphereLight('#e9f7ff', '#947f49', 2.3));
const sun = new THREE.DirectionalLight('#fff6d8', 3.3); sun.position.set(-35,75,35); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:200}); sun.shadow.normalBias=.03; scene.add(sun);
const mechanics = await createMechanics();
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .8 });
const road=mat('#394b59'), grass=mat('#a6b26e'), blue=mat('#2475a8'), white=mat('#f6eee1'), yellow=mat('#ffe356'), dark=mat('#162731');
function box(size,position,material,physical=false,yaw=0){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);mesh.rotation.y=yaw;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  if(physical)mechanics.addBody({position,shape:{type:'box',size},quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw)});
  return mesh;
}
box([500,1,500],[0,-.5,0],grass,true);
const ring=new THREE.Mesh(new THREE.RingGeometry(31,45,128),road);ring.rotation.x=-Math.PI/2;ring.position.y=.015;ring.receiveShadow=true;scene.add(ring);
for(let i=0;i<96;i++){
  const a=i/96*Math.PI*2;
  for(const r of [30.7,45.3])box([.65,.8,r*.068],[Math.cos(a)*r,.4,Math.sin(a)*r],i%4<2?white:blue,true,-a);
  if(i%2===0)box([.2,.025,1.7],[Math.cos(a)*38,.035,Math.sin(a)*38],white,false,-a);
}
for(let i=0;i<12;i++)box([1,.035,1.05],[0,.06,31.7+i*1.1],i%2?dark:white);
// Sparse scenery leaves clear sight lines for assessing controls.
for(let i=0;i<18;i++){
  const a=i/18*Math.PI*2,r=60+(i%3)*8;
  box([3,2+i%4,3],[Math.cos(a)*r,1+(i%4)/2,Math.sin(a)*r],i%2?blue:yellow);
}
box([18,.5,10],[0,.25,0],white,true);box([12,4,6],[0,2.5,0],blue,true);box([13,.4,7],[0,4.7,0],yellow);
const car=await mechanics.addArcadeVehicle({canvas:renderer.domElement,camera,position:[0,.65,38],heading:Math.PI/2,maxSpeed:27});
const carRoot=new THREE.Group();scene.add(carRoot);car.bindObject(carRoot);
function detail(size,p,material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...p);mesh.castShadow=true;carRoot.add(mesh);return mesh;}
detail([1.75,.45,3.55],[0,-.05,0],yellow);detail([1.35,.45,1.6],[0,.37,.3],blue);detail([1.15,.08,1.1],[0,.64,.3],dark);
detail([.13,.04,3.5],[0,.19,0],dark);detail([1.85,.12,.3],[0,.45,1.58],dark);
for(const x of [-.9,.9])for(const z of [-1.05,1.1])detail([.22,.55,.65],[x,-.13,z],dark);
for(const x of [-.57,.57]){detail([.38,.14,.05],[x,.02,-1.79],white);detail([.35,.12,.05],[x,.03,1.79],mat('#e84936'));}
let checkpoint=0,lap=1;
const gates=[[-38,0],[0,-38],[38,0],[0,38]].map(([x,z],index)=>mechanics.addBody({position:[x,1.5,z],shape:{type:'box',size:[14,4,14]},sensor:true,data:{checkpoint:index}}));
mechanics.onCollision(({type,a,b})=>{
  if(type!=='start'||!car.active)return;
  const other=a===car?b:b===car?a:null;
  if(other===gates[checkpoint]){checkpoint++;if(checkpoint===4){lap++;checkpoint=0;}document.querySelector('#progress').textContent=`Checkpoints ${checkpoint} / 4 · Lap ${lap}`;}
});
const menu=document.querySelector('#menu'),button=document.querySelector('#start'),status=document.querySelector('#status');
button.disabled=false;button.textContent='DRIVE';status.textContent='Follow the circuit to the right. Brake before the corners; hold Space for a looser drift.';
button.onclick=()=>car.start();
let last=performance.now();
function frame(now){
  requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.25);last=now;
  mechanics.advance(dt,{paused:!car.active});menu.hidden=car.active;
  if(car.enabled&&!car.active){button.textContent='RESUME';status.textContent='Paused. Resume to continue driving.';}
  document.querySelector('#speed').textContent=Math.round(Math.abs(car.speed)*3.6);
  document.querySelector('#surface').textContent=car.active?(car.grounded?'On track':'Airborne'):'Paused';
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
addEventListener('pagehide',()=>{mechanics.dispose();renderer.dispose();},{once:true});
