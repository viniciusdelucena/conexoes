// Abertura: reinicia a animação dos pontos de luz sempre que a tela de entrada aparece.
// (O movimento dos pontos usa animateMotion, que precisa ser disparado quando a tela fica visível.)
export function configurarLogo() {
  const tela = document.getElementById("tela-login");
  const svg = document.getElementById("elos-logo");
  if (!tela || !svg || typeof svg.setCurrentTime !== "function") return;
  const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const iniciar = () => {
    if (reduzir) return;
    try {
      svg.setCurrentTime(0);
      for (const id of ["mov-e", "mov-d"]) {
        const el = document.getElementById(id);
        if (el && el.beginElementAt) el.beginElementAt(0.1);
      }
    } catch (e) { /* sem animação, o logo aparece parado */ }
  };
  new MutationObserver(() => { if (!tela.hidden) iniciar(); }).observe(tela, { attributes: true, attributeFilter: ["hidden"] });
  if (!tela.hidden) iniciar();
}

// Conexão feita: tela cheia com o infinito se formando, mostrada nos dois aparelhos quando o parceiro entra na casa.
let fecharTimer = null;
export function mostrarConexao() {
  const caixa = document.getElementById("conexao");
  const modelo = document.getElementById("elos-logo");
  if (!caixa || !modelo) return;
  // Copia o logo trocando os ids para não repetir os da tela de entrada.
  const svgHtml = modelo.outerHTML.replace(/elos-/g, "cx-").replace(/id="mov-e"/, 'id="cmov-e"').replace(/id="mov-d"/, 'id="cmov-d"');
  caixa.innerHTML = `
    <span class="conexao-orb a"></span><span class="conexao-orb b"></span>
    <div class="conexao-miolo">
      <div class="palco">${svgHtml.replace('class="elos"', 'class="elos"')}</div>
      <h2 class="conexao-titulo">Conectados!</h2>
      <p class="conexao-sub">Agora vocês dois acompanham as mesmas contas, em tempo real.</p>
      <button type="button" class="btn conexao-ok">Continuar</button>
    </div>`;
  const svg = caixa.querySelector("svg");
  caixa.hidden = false;
  caixa.classList.remove("saindo");
  const fechar = () => {
    clearTimeout(fecharTimer);
    caixa.classList.add("saindo");
    setTimeout(() => { caixa.hidden = true; caixa.innerHTML = ""; }, 350);
  };
  caixa.querySelector(".conexao-ok").addEventListener("click", fechar);
  caixa.addEventListener("click", (e) => { if (e.target === caixa) fechar(); }, { once: true });
  const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduzir && svg && svg.setCurrentTime) {
    try {
      svg.setCurrentTime(0);
      for (const id of ["cmov-e", "cmov-d"]) { const el = caixa.querySelector("#" + id); if (el && el.beginElementAt) el.beginElementAt(0.1); }
    } catch (e) { /* o logo aparece pronto */ }
  }
  if (navigator.vibrate) { try { navigator.vibrate([20, 60, 40]); } catch (e) { /* sem vibração */ } }
  clearTimeout(fecharTimer);
  fecharTimer = setTimeout(fechar, 9000);
}
