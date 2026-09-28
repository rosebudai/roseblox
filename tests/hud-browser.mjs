import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.argv[2]??'http://127.0.0.1:8893';
const output=process.argv[3]??'/tmp/roseblox-hud-evidence';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/local/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1100,height:740}});
const errors=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try {
  await page.goto(`${base}/tests/fixtures/hud.html`);
  await page.waitForFunction(()=>window.hudFixture?.hud);
  for(const style of ['scifi','horror','voxel']) {
    await page.evaluate(style=>window.hudFixture.configure(style),style);
    await page.screenshot({path:`${output}/${style}-ready.png`});
    await page.locator('#start').click();
    assert.equal(await page.evaluate(()=>window.hudFixture.hud.elements.root.dataset.state),'playing');
    assert.equal(await page.evaluate(()=>document.activeElement===window.hudFixture.game.renderer.domElement),true);
    assert.equal(await page.locator('#start').isVisible(),false);
    assert.equal(await page.locator('#restart').isVisible(),true);
    if(style!=='voxel') {
      await page.evaluate(()=>{const hud=window.hudFixture.hud;hud.setStat('health',0);hud.setStat('ammo','0 / 24');hud.setState('playing','Hit');});
      assert.equal(await page.locator('#health').textContent(),'Hull: 0');
      assert.equal(await page.locator('#ammo').textContent(),'Ammo: 0 / 24');
      assert.equal(await page.locator('.rb-crosshair').isVisible(),true);
    } else {
      await page.evaluate(()=>window.hudFixture.hud.setScore(2,3));
      assert.equal(await page.locator('#score').textContent(),'Score: 2 / 3');
      const legacy=await page.locator('#start').evaluate(node=>{const s=getComputedStyle(node);return{font:s.fontFamily,border:s.borderTopWidth,shadow:s.boxShadow};});
      assert.match(legacy.font,/monospace/);assert.equal(legacy.border,'3px');assert.match(legacy.shadow,/4px 4px/);
    }
    for(const viewport of [{width:1100,height:740},{width:360,height:640}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>window.hudFixture.hud.setState('playing','You survived'));
      const layout=await page.evaluate(()=>{
        const root=window.hudFixture.hud.elements.root,bar=root.querySelector('.rb-bar').getBoundingClientRect(),feedback=root.querySelector('.rb-feedback').getBoundingClientRect();
        const cross=root.querySelector('.rb-crosshair')?.getBoundingClientRect();
        return{separate:bar.right<=feedback.left,overflow:document.documentElement.scrollWidth>innerWidth,cross:cross&&[cross.x+cross.width/2,cross.y+cross.height/2]};
      });
      assert.equal(layout.separate,true);assert.equal(layout.overflow,false);
      assert.equal(await page.locator('#status').isVisible(),true);
      if(layout.cross)assert.deepEqual(layout.cross,[viewport.width/2,viewport.height/2]);
      await page.screenshot({path:`${output}/${style}-playing-${viewport.width}.png`});
    }
    await page.evaluate(()=>window.hudFixture.hud.setState('won','You won'));
    assert.equal(await page.locator('#status').textContent(),'You won');
    if(style!=='voxel')assert.equal(await page.locator('.rb-crosshair').isVisible(),false);
    const before=await page.evaluate(()=>window.hudFixture.restarts);
    await page.locator('#restart').click();
    assert.equal(await page.evaluate(()=>window.hudFixture.restarts),before+1);
    await page.evaluate(()=>window.hudFixture.game.dispose());
    assert.equal(await page.locator('.rb-hud').count(),0);
    await page.setViewportSize({width:1100,height:740});
    results.push({name:`${style}: real Start/Restart, focus, readouts, state visibility, responsive layout and game disposal`,status:'pass'});
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/result.json`,JSON.stringify({status:'pass',results,errors},null,2));
} catch(error) {
  await writeFile(`${output}/result.json`,JSON.stringify({status:'fail',message:error.message,results,errors},null,2));
  throw error;
} finally {await browser.close();}
