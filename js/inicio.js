// Tela Início: lista de próximos vencimentos e o selo de situação de cada um.
// Só lê dados já calculados (calcularPeriodo); não grava nada.

import { h, reais } from "./util.js";
import { hojeIso, diasEntre, dataCurta } from "./periodos.js";
import { mesCurto } from "./util.js";

// Contas ainda não pagas do período, com dia de vencimento, da mais antiga para a mais nova.
export function proximosVencimentos(r, hoje = hojeIso()) {
  return (r.itens || [])
    .filter((i) => !i.paga && !i.automatica && i.conta.dia)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
    .map((i) => ({ nome: i.conta.nome, data: i.data, valor: i.valor, dias: diasEntre(hoje, i.data) }));
}

// Vermelho = atrasada, âmbar = vence logo, verde = ainda longe (em dia).
export function situacaoVencimento(dias) {
  if (dias < 0) return { tom: "atraso", texto: dias === -1 ? "Atrasada 1 dia" : `Atrasada ${-dias} dias` };
  if (dias === 0) return { tom: "atencao", texto: "Hoje" };
  if (dias === 1) return { tom: "atencao", texto: "Amanhã" };
  if (dias <= 3) return { tom: "atencao", texto: `em ${dias} dias` };
  return { tom: "ok", texto: `em ${dias} dias` };
}

// Desenha o cartão. r = resumo do período de hoje (ou null/sem período: o cartão some).
export function montarProximos(cartao, r, aoIr) {
  const ul = cartao.querySelector("#ini-prox-lista");
  if (!r || r.semPeriodo || !r.qtdContas) { cartao.hidden = true; return; }
  cartao.hidden = false;
  const itens = proximosVencimentos(r).slice(0, 4);
  if (!itens.length) {
    ul.replaceChildren(h("li", { class: "ini-prox-ok" }, h("span", { class: "chip ok" }, r.faltaPagar > 0 ? "Sem vencimentos marcados" : "Tudo pago"), r.faltaPagar > 0 ? " As contas que faltam não têm dia de vencimento." : " Nada a vencer neste período."));
    return;
  }
  ul.replaceChildren(...itens.map((i) => {
    const sit = situacaoVencimento(i.dias);
    return h("li", {},
      h("button", { type: "button", class: "ini-prox-item", onclick: aoIr },
        h("span", { class: "ini-prox-info" }, h("span", { class: "ini-prox-nome" }, i.nome), h("span", { class: "ini-prox-data" }, `vence ${dataCurta(i.data)}`)),
        h("span", { class: "ini-prox-dir" }, h("span", { class: "ini-prox-valor" }, reais(i.valor)), h("span", { class: `chip ${sit.tom}` }, sit.texto))));
  }));
}

// ----- Minigráfico do saldo devedor (cartão de Dívidas) -----
// Linha cheia até o mês atual, tracejada dali em diante (cronograma), com um ponto em "agora".
// pontos: saldoPorMes(dividas) = [{ m, saldo, futuro, inicio }]. Devolve true se desenhou.
let sparkJaAnimou = false;
export function montarMinigrafico(caixa, pontos) {
  if (!pontos || pontos.length < 3) { caixa.hidden = true; caixa.replaceChildren(); return false; }
  const W = 100, H = 32, TOPO = 4, BASE = 3;
  const n = pontos.length;
  const max = Math.max(...pontos.map((p) => p.saldo), 1);
  const X = (i) => (i / (n - 1)) * W;
  const Y = (v) => TOPO + (1 - v / max) * (H - TOPO - BASE);
  let agora = -1;
  pontos.forEach((p, i) => { if (!p.futuro) agora = i; });
  const idx = Math.max(agora, 0);
  const trecho = (de, ate) => pontos.slice(de, ate + 1).map((p, k) => `${k ? "L" : "M"}${X(de + k).toFixed(2)},${Y(p.saldo).toFixed(2)}`).join("");
  const area = `${trecho(0, n - 1)}L${W},${H}L0,${H}Z`;
  const cheia = agora >= 1 ? trecho(0, idx) : "";
  const tracejada = idx < n - 1 ? trecho(idx, n - 1) : "";
  const zera = pontos.find((p) => p.saldo === 0 && !p.inicio);
  const rotulo = `Saldo devedor mês a mês: começa em ${reais(pontos[0].saldo)}` +
    (zera ? ` e zera em ${mesCurto(zera.m)}.` : ` e termina em ${reais(pontos[n - 1].saldo)}.`);
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id="ini-spark-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--ok);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--ok);stop-opacity:0"/>
    </linearGradient></defs>
    <path class="area" d="${area}" fill="url(#ini-spark-g)"/>
    ${tracejada ? `<path class="trecho futuro" d="${tracejada}" fill="none" vector-effect="non-scaling-stroke"/>` : ""}
    ${cheia ? `<path class="trecho" d="${cheia}" fill="none" vector-effect="non-scaling-stroke"/>` : ""}
  </svg>`;
  const ponto = h("span", { class: "ini-spark-ponto", style: `left:${X(idx).toFixed(2)}%;top:${((Y(pontos[idx].saldo) / H) * 100).toFixed(2)}%` });
  caixa.hidden = false;
  caixa.setAttribute("role", "img");
  caixa.setAttribute("aria-label", rotulo);
  caixa.classList.toggle("anima", !sparkJaAnimou);
  sparkJaAnimou = true;
  caixa.replaceChildren(h("span", { class: "ini-spark-svg", html: svg }), ponto);
  return true;
}
