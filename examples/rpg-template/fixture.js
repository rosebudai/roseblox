import * as THREE from 'three';
import {createRpgGame} from '../../build/rpgTemplate.js';
import {createUI} from './ui.js';
const interaction = new URLSearchParams(location.search).has('interaction');
const melee = new URLSearchParams(location.search).has('melee');
const combat = interaction || melee || new URLSearchParams(location.search).has('combat');
window.fixture = await createRpgGame({
 createUI, onReady(game){window.fixture=game;},
 title:combat?'Ember watch':'Garden walk', description:'Engineering fixture: approach the guide, F, accept, gather the token, then return.',
 assets:{person:{type:'model',url:new URLSearchParams(location.search).get('model')||'./fixture.gltf'}}, player:{model:'person',feet:[0,.1,0]},
 visuals:combat?{background:'#42201d',ambient:1,sunColor:'#ff9977'}:{background:'#87ceeb',ambient:2},
 characters:[{id:'guide',name:'Guide',model:'person',feet:[-1.6,0,-1],dialogue:{text:'Retrieve the token and return.',choices:[{label:'Test error cleanup',action(){throw new Error('Intentional fixture choice failure')}}]}}, ...(combat?[{id:'enemy',name:'Sentinel',model:'person',feet:[0,0,-2.4],enemy:true,health:40,aggroRange:0}]:[]), ...(melee?[
  {id:'side',name:'Side enemy',feet:[1.2,0,-2.1]}, {id:'blocked',name:'Behind wall',feet:[-1.2,0,-2.2]},
  {id:'behind',name:'Behind player',feet:[0,0,2]}, {id:'far',name:'Far enemy',feet:[0,0,-5]},
 ].map(def=>({...def,model:'person',enemy:true,health:40,aggroRange:0})):[])],
 objects:[{id:'token',name:'Token',model:'person',feet:[1.6,0,-1],height:.7,item:'token'}, ...(interaction?[
  {id:'scenery',name:'Decoration',model:'person',feet:[0,0,-.8],height:.4,width:.25},
  {id:'blocked-token',name:'Hidden token',model:'person',feet:[0,0,-1.6],height:.5,width:.25,item:'hidden'},
  {id:'marker',name:'Quest marker',model:'person',feet:[10,0,0],height:1,width:.5},
 ]:[])],
 quests:[{id:'collect',title:'Recover token',giver:'guide',ordered:true,objectives:[{type:'collect',item:'token',label:'Find token'},{type:'deliver',item:'token',target:'guide',label:'Return token'}],reward:{currency:5}}, ...(interaction?[{id:'visit-marker',autoStart:true,objectives:[{type:'talk',target:'marker'}]}]:[])],
 abilities:combat?[{name:'Strike',damage:10,cooldown:.4,effect(){window.swingEffects=(window.swingEffects??0)+1;}},{name:'Mend',heal:12,cooldown:0},{name:'Heal',heal:28,cooldown:0}]:[],
 async buildWorld(g){const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:combat?'#504340':'#53874b'}));floor.rotation.x=-Math.PI/2;g.addSurface(floor);
  if(interaction){const wall=new THREE.Mesh(new THREE.BoxGeometry(.5,1.8,.2),new THREE.MeshStandardMaterial());g.addProp(wall,{position:[0,.9,-1.2],collider:true});}
  if(melee){const wall=new THREE.Mesh(new THREE.BoxGeometry(.55,1.8,.2),new THREE.MeshStandardMaterial({color:'#ccd8e0'}));g.addProp(wall,{position:[-.6,.9,-1.1],collider:true});}
 },
});
