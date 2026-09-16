export function createUI({root, actions, bindAction, createControlsLegend}) {
  const journal = new URLSearchParams(location.search).get('ui') !== 'ribbon';
  root.className = journal ? 'journal' : 'ribbon';
  const el = (tag, parent, cls) => { const n=document.createElement(tag); if(cls)n.className=cls; parent.append(n); return n; };
  const frame = el(journal?'aside':'footer', root, 'hud');
  const title = el('h1', frame), health = el('meter', frame), stats = el('output', frame);
  const quests = el('div', journal?frame:root, 'quests'), target = el('p', frame), notice = el('output', root, 'notice');
  const toolbar = el('nav', frame), sheet = el(journal?'article':'section',root,'sheet');
  const help = el('details', frame, 'controls'); el('summary',help).textContent='Controls'; help.append(createControlsLegend());
  const targetHealth = el('meter', frame); targetHealth.setAttribute('aria-label','Target health');
  sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-label','Adventure');
  const heading = el('h2',sheet), body=el('p',sheet), choices=el('div',sheet,'choices');
  let key='', initialized=false;
  function button(parent,label,callback,disabled=false){const b=el('button',parent); b.type='button'; b.textContent=label; b.disabled=disabled; return bindAction(b,callback);}
  return {
    update(s){
      window.fixtureState=s;
      title.textContent=s.title; health.max=s.maxHealth; health.value=s.health;
      stats.textContent=`${Math.ceil(s.health)} HP · ${s.currency} coins`;
      target.textContent=s.target?`${s.target.name} · F interact`:'Click to select'; notice.textContent=s.notice;
      targetHealth.hidden=!s.target?.enemy; targetHealth.max=1; targetHealth.value=s.target?.healthFraction??0;
      quests.textContent=s.quests.map(q=>`${q.title} · ${q.state}\n${q.progress.join(' / ')}`).join('\n');
      if(!initialized){
        initialized=true; button(toolbar,'Interact',actions.interact);
        for(const a of s.abilities)button(toolbar,a.name,a.activate);
        button(toolbar,'Pause',actions.pause);
      }
      const next=JSON.stringify([s.phase,s.dialogue,s.error]); if(next===key)return; key=next;
      sheet.hidden=s.phase==='playing'; toolbar.hidden=s.phase!=='playing'; choices.replaceChildren();
      heading.textContent=s.phase==='dialogue'?s.dialogue.title:s.phase==='ready'?s.title:s.phase;
      body.textContent=s.phase==='dialogue'?s.dialogue.text:s.error||s.description;
      if(s.phase==='dialogue'){
        for(const c of s.dialogue.choices)button(choices,c.label,()=>actions.chooseDialogue(c.id),s.dialogue.busy);
        button(choices,'Close',actions.closeDialogue);
      }else if(['ready','paused'].includes(s.phase)){
        button(choices,s.phase==='ready'?'Play':'Resume',actions.play); if(s.phase==='paused')button(choices,'Restart',actions.restart);
      }else if(s.phase==='dead'){button(choices,'Respawn',actions.respawn);button(choices,'Restart',actions.restart);}
      else if(s.phase==='error')button(choices,'Retry',actions.restart);
    },
    focus(){const button=choices.querySelector('button:not(:disabled)'); if(journal)return button; button?.focus();},
    dispose(){root.replaceChildren();},
  };
}
