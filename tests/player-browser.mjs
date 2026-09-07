import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base=process.argv[2]??"http://127.0.0.1:8893";
const output=process.argv[3]??"/tmp/roseblox-player-evidence";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??"/usr/local/bin/chromium",headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1000,height:700}});
const errors=[],checks=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
const sample=()=>page.evaluate(()=>window.playerTest.sample());
const simulate=async seconds=>{
  const before=await sample();
  await page.waitForFunction(target=>window.playerTest.sample().simulated>=target,before.simulated+seconds,{timeout:30000});
};
const hold=async(key,seconds)=>{await page.keyboard.down(key);try{await simulate(seconds);}finally{await page.keyboard.up(key);}};
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(()=>window.exampleGame?.game.getDiagnostics().frames>2,{timeout:60000});
  await page.evaluate(async()=>{
    const {createGame,createVoxelKit}=await import("/build/roseblox.js");
    window.exampleGame.game.dispose();
    document.body.innerHTML='<canvas id="game-canvas"></canvas><div style="position:absolute;top:12px;left:12px"><button id="start">Start</button><button id="reset">Reset</button></div>';
    const canvas=document.querySelector("canvas");
    const game=await createGame({canvas});
    const kit=createVoxelKit(game);
    kit.ground({size:[32,.5,32],position:[0,-.75,0]});
    kit.ground({size:[20,1,20],position:[0,-.5,0]});
    const player=kit.avatar(game.addPlayer({position:[0,1,0],radius:.42,height:1.16,speed:4,jumpSpeed:6.2}));
    game.followCamera(player,{offset:[0,5.5,8],lookOffset:[0,.7,0]});
    player.player.enabled=false;
    document.querySelector("#start").onclick=()=>{player.player.enabled=true;canvas.focus();};
    document.querySelector("#reset").onclick=()=>{game.teleport(player,[0,1,0]);game.input.reset();player.player.enabled=true;canvas.focus();};
    window.playerTest={game,player,sample:()=>({position:player.transform.position.toArray(),grounded:player.player.grounded,simulated:game.getDiagnostics().simulatedSeconds,errors:game.getDiagnostics().errorCount})};
  });
  await simulate(3);
  const ready=await sample();
  assert.ok(ready.grounded&&ready.position[1]>1.005&&ready.position[1]<1.05,"disabled ready player sinks into broad floor");
  await page.screenshot({path:`${output}/idle.png`});
  checks.push({name:"three-second idle before Start stays above floor",status:"pass",detail:ready});
  await page.click("#start");
  await hold("a",1);await hold("w",1);
  const moved=await sample();
  assert.ok(moved.position[0]<-3.4&&moved.position[2]<-3.4,"real A/W inputs stall after initial idle");
  checks.push({name:"real A/W movement works after ready idle",status:"pass",detail:moved});
  await page.click("#reset");
  await simulate(1.8);
  const reset=await sample();
  assert.ok(Math.hypot(reset.position[0],reset.position[2])<.05&&reset.position[1]>1.005&&reset.grounded,"reset followed by idle loses floor clearance");
  await hold("a",1);await hold("w",1);
  const again=await sample();
  assert.ok(again.position[0]<-3.4&&again.position[2]<-3.4,"real A/W inputs stall after reset delay");
  await page.screenshot({path:`${output}/after-reset-movement.png`});
  checks.push({name:"real reset and delayed two-axis evasion preserve movement",status:"pass",detail:{reset,again}});
  assert.deepEqual(errors,[]);
} finally {
  await writeFile(`${output}/report.json`,JSON.stringify({checks,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({checks:checks.length,errors:errors.length,output}));
