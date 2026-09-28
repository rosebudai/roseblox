// Design the markup and theme for this adventure; bindings supply the shared updates.
export function createUI({ root, bindUI }) {
  root.innerHTML = `
    <header><span data-rpg-text="healthText"></span> HP · <span data-rpg-text="currency"></span></header>
    <aside data-rpg-list="questLog"><template><article>
      <h3 data-rpg-text="title"></h3>
      <ul data-rpg-list="objectives"><template><li data-rpg-text="text"></li></template></ul>
    </article></template></aside>
    <section data-rpg-list="combatTargets"><template><label>
      <span data-rpg-text="name"></span><meter data-rpg-max="maxHealth" data-rpg-value="health"></meter>
    </label></template></section>
    <p data-rpg-text="notice"></p><p data-rpg-text="interactionText"></p>
    <nav data-rpg-show="playing" data-rpg-list="abilities"><template>
      <button data-rpg-action="action" data-rpg-disabled="disabled"><kbd data-rpg-text="key"></kbd>
        <span data-rpg-text="name"></span><small data-rpg-text="cooldownText"></small></button>
    </template></nav>
    <section data-rpg-show="panel"><h1 data-rpg-text="panel.title"></h1><p data-rpg-text="panel.body"></p>
      <nav data-rpg-list="panel.actions"><template>
        <button data-rpg-text="label" data-rpg-action="action" data-rpg-disabled="disabled"></button>
      </template></nav>
      <div data-rpg-show="menu" data-rpg-controls></div>
    </section>`;
  return bindUI();
}
