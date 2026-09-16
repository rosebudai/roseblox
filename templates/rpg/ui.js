// Replace this editable starter with a presentation designed for your adventure.
export function createUI({ root, actions, bindAction, createControlsLegend }) {
  const summary = document.createElement('output');
  const view = document.createElement('section');
  const controls = createControlsLegend();
  root.append(summary, view, controls);
  let screen = '';
  function button(label, action, disabled = false) {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label; el.disabled = disabled;
    view.append(bindAction(el, action));
  }
  return {
    update(state) {
      summary.textContent = `${state.title} · ${Math.ceil(state.health)}/${state.maxHealth} HP · ${state.currency} coins\n${state.notice}`;
      controls.hidden = !['ready', 'paused'].includes(state.phase);
      // Preserve interactive elements between updates so focus and clicks survive.
      const key = JSON.stringify([state.phase, state.dialogue, state.error, state.quests, state.target]);
      if (key === screen) return;
      screen = key; view.replaceChildren();
      const text = document.createElement('p'); view.append(text);
      if (state.phase === 'playing') {
        text.textContent = state.quests.filter(q => ['active','completed'].includes(q.state)).map(q => `${q.title}: ${q.state}`).join('\n');
        button('Interact', actions.interact);
        for (const a of state.abilities) button(`${a.key} · ${a.name}`, a.activate);
        button('Pause', actions.pause);
      } else if (state.phase === 'dialogue') {
        text.textContent = `${state.dialogue.title}\n${state.dialogue.text}`;
        for (const c of state.dialogue.choices) button(c.label, () => actions.chooseDialogue(c.id), state.dialogue.busy);
        button('Close', actions.closeDialogue);
      } else if (state.phase === 'loading') text.textContent = 'Loading…';
      else if (state.phase === 'error') { text.textContent = state.error; button('Retry', actions.restart); }
      else if (state.phase === 'dead') { text.textContent = state.deathText || 'Defeated'; button('Respawn', actions.respawn); button('Restart', actions.restart); }
      else {
        text.textContent = state.description;
        button(state.phase === 'ready' ? 'Play' : 'Resume', actions.play);
        if (state.phase === 'paused') button('Restart', actions.restart);
      }
    },
    focus() { return view.querySelector('button:not(:disabled)'); },
    dispose() { root.replaceChildren(); },
  };
}
