import * as THREE from 'three';
import {createRpgGame} from '../../build/rpgTemplate.js';
const combat = new URLSearchParams(location.search).has('combat');
window.fixture = await createRpgGame({
 title:combat?'Ember watch':'Garden walk', description:'Engineering fixture: click the guide, F, accept, gather the token, then return.',
 assets:{person:{type:'model',url:'./fixture.gltf'}}, player:{model:'person',feet:[0,.1,0]},
 visuals:combat?{background:'#42201d',ambient:1,sunColor:'#ff9977'}:{background:'#87ceeb',ambient:2},
 characters:[{id:'guide',name:'Guide',model:'person',feet:[-1.6,0,-1],dialogue:{text:'Retrieve the token and return.',choices:[{label:'Test error cleanup',action(){throw new Error('Intentional fixture choice failure')}}]}}, ...(combat?[{id:'enemy',name:'Sentinel',model:'person',feet:[2.2,0,-1.5],enemy:true,health:10,damage:10}]:[])],
 objects:[{id:'token',name:'Token',model:'person',feet:[1.6,0,-1],height:.7,item:'token'}],
 quests:[{id:'collect',title:'Recover token',giver:'guide',ordered:true,objectives:[{type:'collect',item:'token',label:'Find token'},{type:'deliver',item:'token',target:'guide',label:'Return token'}],reward:{currency:5}}],
 abilities:combat?[{name:'Strike',damage:12}]:[],
 async buildWorld(g){const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:combat?'#504340':'#53874b'}));floor.rotation.x=-Math.PI/2;g.addSurface(floor);},
});
