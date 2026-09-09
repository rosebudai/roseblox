import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base=process.argv[2]??"http://127.0.0.1:35923";
const output=process.argv[3]??"/tmp/roseblox-ground-depth";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??"/usr/local/bin/chromium",headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1000,height:700}});
const checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(()=>window.exampleGame?.game.getDiagnostics().frames>2);
  await page.evaluate(async()=>{
    const {createGame,createVoxelKit}=await import("/build/roseblox.js");
    const THREE=await import("three");
    window.exampleGame.game.dispose();document.querySelector("aside").remove();
    const game=await createGame({canvas:document.querySelector("canvas"),shadows:false});
    const kit=createVoxelKit(game,{seed:17,lighting:false});
    for(const light of game.scene.children)if(light.isLight)light.visible=false;
    game.scene.add(new THREE.AmbientLight("#ffffff",3));
    game.scene.background=new THREE.Color("#192a40");
    const target=new THREE.WebGLRenderTarget(1000,700);
    let apron,floor,raised;
    const visual=e=>e.mesh.children[0];
    const setup=reverse=>{
      for(const entity of [apron,floor,raised])if(entity)game.remove(entity);
      raised=null;
      const addApron=()=>apron=kit.ground({size:[46,1,46],position:[0,-.5,0],body:"none",color:"#e02030"});
      const addFloor=()=>floor=kit.ground({size:[20,1,20],position:[0,-.5,0],color:"#30b850"});
      if(reverse){addFloor();addApron();}else{addApron();addFloor();}
      game.engine.update(0);
    };
    const render=()=>{
      game.renderer.setRenderTarget(target);game.renderer.render(game.scene,game.camera);
      const pixels=new Uint8Array(1000*700*4);
      game.renderer.readRenderTargetPixels(target,0,0,1000,700,pixels);
      game.renderer.setRenderTarget(null);
      return pixels;
    };
    const pixel=(pixels,point)=>{
      const p=new THREE.Vector3(...point).project(game.camera);
      const x=Math.floor((p.x+1)*500),y=Math.floor((p.y+1)*350);
      if(x<0||x>=1000||y<0||y>=700||p.z>1||p.z< -1)return null;
      const index=(y*1000+x)*4;return [...pixels.slice(index,index+3)];
    };
    const compare=()=>{
      apron.mesh.visible=true;const together=render();
      apron.mesh.visible=false;const reference=render();apron.mesh.visible=true;
      let samples=0,mismatches=0,maxDifference=0;
      for(let x=-8;x<=8;x+=1.25)for(let z=-8;z<=8;z+=1.25){
        if(raised&&Math.abs(x)<3&&Math.abs(z)<3)continue;
        const actual=pixel(together,[x,0,z]),expected=pixel(reference,[x,0,z]);
        if(!actual||!expected)continue;
        samples++;const difference=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));
        maxDifference=Math.max(maxDifference,difference);if(difference>2)mismatches++;
      }
      const apronSamples=[[15,0,0],[-15,0,0],[0,0,-15],[0,0,15]].map(p=>pixel(together,p)).filter(Boolean);
      game.renderer.render(game.scene,game.camera);
      return {samples,mismatches,maxDifference,apronVisible:apronSamples.some(c=>c[0]>c[1]*1.5),camera:game.camera.position.toArray()};
    };
    window.groundDepth={game,kit,setup,compare,pose:async position=>{await game.controls.setLookAt(...position,0,0,0,false);game.engine.update(1/60);},
      bias:enabled=>{visual(apron).material.polygonOffset=enabled;},
      raised:()=>{raised=kit.ground({size:[4,1,4],position:[0,1.5,0],body:"none",color:"#204cf0"});game.engine.update(0);},
      sampleRaised:()=>{const both=render(),actual=pixel(both,[0,2,0]);floor.mesh.visible=false;apron.mesh.visible=false;const alone=pixel(render(),[0,2,0]);floor.mesh.visible=true;apron.mesh.visible=true;game.renderer.render(game.scene,game.camera);return {actual,alone,top:new THREE.Box3().setFromObject(visual(raised)).max.y};},
      dispose:()=>{target.dispose();game.dispose();}};
  });
  for(const reverse of [false,true]){
    await page.evaluate(reverse=>window.groundDepth.setup(reverse),reverse);
    let unbiasedMismatches=0;
    for(const [name,position] of [["elevated",[13,15,19]],["grazing",[16,2,22]],["overhead",[1,27,3]]]){
      await page.evaluate(position=>window.groundDepth.pose(position),position);
      await page.evaluate(()=>window.groundDepth.bias(false));
      const unbiased=await page.evaluate(()=>window.groundDepth.compare());
      unbiasedMismatches+=unbiased.mismatches;
      await page.evaluate(()=>window.groundDepth.bias(true));
      const result=await page.evaluate(()=>window.groundDepth.compare());
      assert.ok(result.samples>=30,JSON.stringify(result));
      assert.equal(result.mismatches,0,`solid pixels differ with decorative apron: ${JSON.stringify(result)}`);
      assert.equal(result.apronVisible,true,`apron outside solid disappeared: ${JSON.stringify(result)}`);
      checks.push({name:`${reverse?"solid-first":"apron-first"} ${name} coplanar precedence`,status:"pass",unbiasedMismatches:unbiased.mismatches,...result});
      if(name==="grazing")await page.screenshot({path:`${output}/${reverse?"solid-first":"apron-first"}-grazing.png`});
    }
    assert.ok(unbiasedMismatches>0,"unbiased control must reproduce visible depth competition");
  }
  await page.evaluate(()=>window.groundDepth.pose([13,6,19]));
  const before=await page.evaluate(()=>window.groundDepth.compare());
  await page.mouse.move(500,350);await page.mouse.down();await page.mouse.move(735,375,{steps:16});await page.mouse.up();
  await page.waitForTimeout(350);
  const after=await page.evaluate(()=>window.groundDepth.compare());
  assert.ok(Math.hypot(...after.camera.map((v,i)=>v-before.camera[i]))>3,"real drag must orbit the camera");
  assert.ok(after.samples>=30);assert.equal(after.mismatches,0);assert.equal(after.apronVisible,true);
  checks.push({name:"real orbit preserves solid-over-apron precedence",status:"pass",before,after});
  await page.screenshot({path:`${output}/orbit.png`});
  await page.evaluate(async()=>{await window.groundDepth.pose([13,15,19]);window.groundDepth.raised();});
  const raised=await page.evaluate(()=>window.groundDepth.sampleRaised());
  assert.deepEqual(raised.actual,raised.alone);assert.ok(raised.actual[2]>raised.actual[0]*1.5);assert.ok(Math.abs(raised.top-2)<1e-6,"instance Float32 geometry preserves the requested top within numeric precision");
  checks.push({name:"separate-height decorative ground remains in front at its exact top",status:"pass",...raised});
  await page.screenshot({path:`${output}/raised.png`});
  await page.evaluate(()=>window.groundDepth.dispose());
  assert.deepEqual(errors,[]);
}catch(error){checks.push({name:"browser contract",status:"fail",error:error.stack});process.exitCode=1;}
finally{const result={status:process.exitCode?"fail":"pass",evidenceKind:"Assistant-authored current-engine material regression, not a Rosie generation",checks,errors};await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();}
