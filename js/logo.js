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
