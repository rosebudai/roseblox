import * as THREE from 'three';
import {createRpgGame} from '../../build/rpgTemplate.js';
import {createUI} from './ui.js';
const interaction = new URLSearchParams(location.search).has('interaction');
const melee = new URLSearchParams(location.search).has('melee');
const q = new URLSearchParams(location.search), ranged = q.has('ranged'), gunner = q.has('gunner'), stalker = q.has('stalker');
const combat = interaction || melee || ranged || gunner || stalker || q.has('combat');
// Three seconds of 8 kHz silence, enough to seek within without a network asset.
const silence = () => { const b = new DataView(new ArrayBuffer(44 + 24000)), text = (at, s) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
 text(0, 'RIFF'); b.setUint32(4, 36 + 24000, true); text(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
 b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true); text(36, 'data'); b.setUint32(40, 24000, true);
 for (let i = 0; i < 24000; i++) b.setUint8(44 + i, 128);
 return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' })); };
window.fixture = await createRpgGame({
 createUI, onReady(game){window.fixture=game;window.readyCount=(window.readyCount??0)+1;}, onAlert(actor,state){(window.alerts??=[]).push(`${actor.def.id}:${state}`);},
 title:combat?'Ember watch':'Garden walk', description:'Engineering fixture: approach the guide, F, accept, gather the token, then return.',
 assets:{person:{type:'model',url:new URLSearchParams(location.search).get('model')||'./fixture.gltf'},...(q.has('audio')&&{music:{type:'audio',url:silence()}})}, player:{model:'person',feet:[0,.1,0],view:new URLSearchParams(location.search).get('view')||undefined,...(q.has('animated')&&{animations:{idle:'Idle',walk:'Walk'}})},
 visuals:combat?{background:'#42201d',ambient:1,sunColor:'#ff9977'}:{background:'#87ceeb',ambient:2},
 characters:[{id:'guide',name:'Guide',model:'person',feet:[-1.6,0,-1],dialogue:{text:'Retrieve the token and return.',choices:[{label:'Test error cleanup',action(){throw new Error('Intentional fixture choice failure')}}]}}, ...(combat?[{id:'enemy',name:'Sentinel',model:'person',feet:[0,0,ranged?-8:-2.4],enemy:true,health:40,aggroRange:0}]:[]).filter(def=>!(gunner||stalker)||def.id!=='enemy'), ...(melee?[
  {id:'side',name:'Side enemy',feet:[1.2,0,-2.1]}, {id:'blocked',name:'Behind wall',feet:[-1.2,0,-2.2]},
  {id:'behind',name:'Behind player',feet:[0,0,2]}, {id:'far',name:'Far enemy',feet:[0,0,-5]},
 ].map(def=>({...def,model:'person',enemy:true,health:40,aggroRange:0})):[]).map(def=>q.has('animated')?{...def,animations:{idle:'Idle',walk:'Idle'}}:def), ...(ranged?[{id:'side',name:'Side enemy',model:'person',feet:[2.5,0,-8],enemy:true,health:40,aggroRange:0}]:[]),
  ...(stalker?[{id:'hunter',name:'Hunter',model:'person',feet:[0,0,q.has('far')?-40:-12],enemy:'stalker',damage:25,loseAfter:2}]:[]),
  ...(gunner?[{id:'gunner',name:'Gunner',model:'person',feet:[0,0,-10],enemy:'ranged',health:40,damage:6,attackCooldown:1}]:[])],
 objects:[{id:'token',name:'Token',model:'person',feet:[1.6,0,-1],height:.7,item:'token'}, ...(stalker?[{id:'closet',name:'Closet',model:'person',feet:[0,0,1.6],height:2,width:1,hide:true}]:[]), ...(interaction?[
  {id:'scenery',name:'Decoration',model:'person',feet:[0,0,-.8],height:.4,width:.25},
  {id:'blocked-token',name:'Hidden token',model:'person',feet:[0,0,-1.6],height:.5,width:.25,item:'hidden'},
  {id:'marker',name:'Quest marker',model:'person',feet:[10,0,0],height:1,width:.5},
 ]:[])],
 quests:[{id:'collect',title:'Recover token',giver:'guide',ordered:true,objectives:[{type:'collect',item:'token',label:'Find token'},{type:'deliver',item:'token',target:'guide',label:'Return token'}],reward:{currency:5}}, ...(interaction?[{id:'visit-marker',autoStart:true,objectives:[{type:'talk',target:'marker'}]}]:[])],
 abilities:ranged||gunner?[{name:'Rifle',kind:'ranged',damage:10,range:30,cooldown:.1,ammo:{clip:3,reserve:3},reload:.3,effect(){window.shotEffects=(window.shotEffects??0)+1;}},{name:'Mend',heal:12,cooldown:0}]:combat?[{name:'Strike',damage:10,cooldown:.4,effect(){window.swingEffects=(window.swingEffects??0)+1;}},{name:'Mend',heal:12,cooldown:0},{name:'Heal',heal:28,cooldown:0}]:[],
 async buildWorld(g){if(q.has('holdWorld')){(window.heldGames??=[]).push(g);await new Promise(resolve=>(window.heldWorlds??=[]).push(resolve));}
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:combat?'#504340':'#53874b'}));floor.rotation.x=-Math.PI/2;g.addSurface(floor);
  if(interaction){const wall=new THREE.Mesh(new THREE.BoxGeometry(.5,1.8,.2),new THREE.MeshStandardMaterial());g.addProp(wall,{position:[0,.9,-1.2],collider:true});}
  if(q.has('wall')){const wall=new THREE.Mesh(new THREE.BoxGeometry(10,3,.3),new THREE.MeshStandardMaterial({color:'#ccd8e0'}));g.addProp(wall,{position:[0,1.5,-4],collider:true});}
  if(melee){const wall=new THREE.Mesh(new THREE.BoxGeometry(.55,1.8,.2),new THREE.MeshStandardMaterial({color:'#ccd8e0'}));g.addProp(wall,{position:[-.6,.9,-1.1],collider:true});}
 },
});
