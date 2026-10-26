// Evolução da dívida: gráfico animado do saldo devedor mês a mês.
//
// O saldo cai conforme as parcelas vencem. Parcela já vencida e não marcada como paga
// continua no saldo (fica "atrasada"); da parcela deste mês em diante o saldo segue o cronograma (linha tracejada).

import { h, reais, mesAtual, somarMeses, diffMeses, mesCurto, nomeMes } from "./util.js";

export function saldoPorMes(lista, hoje = mesAtual()) {
  if (!lista.length) return [];
  const parcelas = [];
  for (const d of lista) {
    const pagas = new Set(d.pagas || []);
    for (let k = 1; k <= d.totalParcelas; k++) {
      parcelas.push({ mes: somarMeses(d.mesInicio, k - 1), valor: d.valorCentavos, paga: pagas.has(k) });
    }
  }
  const total = parcelas.reduce((s, p) => s + p.valor, 0);
  let min = parcelas[0].mes, max = parcelas[0].mes;
  for (const p of parcelas) {
    if (diffMeses(p.mes, min) > 0) min = p.mes;
    if (diffMeses(max, p.mes) > 0) max = p.mes;
  }
  const pontos = [{ m: somarMeses(min, -1), saldo: total, parcelaMes: 0, inicio: true, futuro: somarMeses(min, -1) > hoje }];
  for (let m = min; diffMeses(m, max) >= 0; m = somarMeses(m, 1)) {
    let abatido = 0, doMes = 0, atrasado = 0;
    for (const p of parcelas) {
      if (p.mes <= m && (p.paga || (m > hoje && p.mes >= hoje))) abatido += p.valor;
      if (p.mes === m) doMes += p.valor;
      if (!p.paga && p.mes <= m && p.mes <= hoje) atrasado += p.valor;
    }
    pontos.push({ m, saldo: total - abatido, parcelaMes: doMes, atrasado, futuro: m > hoje });
  }
  return pontos;
}

function compacto(centavos) {
  const v = centavos / 100;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace(".", ",")} mil`;
  return `R$ ${Math.round(v)}`;
}
const rotuloCurto = (ym) => mesCurto(ym).replace(/\/\d{2}(\d{2})$/, "/$1");

// filtro: null (poucas dívidas) ou { texto, filtrado, aoAbrir() }; animar: desenha com animação
export function montarEvolucao(lista, { filtro, animar }) {
  const hoje = mesAtual();
  const pontos = saldoPorMes(lista, hoje);
  const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animado = animar && !reduzir;

  const idxHoje = pontos.findIndex((p) => p.m === hoje);
  const idxAgora = idxHoje >= 0 ? idxHoje : (pontos[pontos.length - 1].m < hoje ? pontos.length - 1 : -1);
  const saldoHoje = idxAgora >= 0 ? pontos[idxAgora].saldo : pontos[0].saldo;
  const total = pontos[0].saldo;
  const zera = pontos.find((p) => p.saldo === 0 && !p.inicio);

  const num = h("strong", { class: "evo-num" }, reais(saldoHoje));
  const caixa = h("div", { class: "evo-grafico" });
  const dica = h("div", { class: "evo-dica", hidden: true, role: "status" });
  const area = h("div", { class: "evo-area" }, caixa, dica);

  const seletor = filtro && h("button", {
    class: "evo-filtro" + (filtro.filtrado ? " ativo" : ""), type: "button", onclick: filtro.aoAbrir,
    "aria-haspopup": "dialog"
  }, h("span", {}, filtro.texto), h("span", { class: "evo-filtro-seta", "aria-hidden": "true" }, "▾"));

  const stat = (rot, val) => h("div", { class: "evo-stat" }, h("small", {}, rot), h("strong", {}, val));
  const tabela = h("details", { class: "evo-tabela" },
    h("summary", {}, "Ver em tabela"),
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Mês"), h("th", {}, "Parcelas"), h("th", {}, "Saldo"))),
      h("tbody", {}, pontos.map((p) => h("tr", {}, h("td", {}, p.inicio ? `${mesCurto(p.m)} (início)` : mesCurto(p.m)), h("td", {}, p.inicio ? "—" : reais(p.parcelaMes)), h("td", {}, reais(p.saldo)))))));

  const raiz = h("article", { class: "cartao evo" },
    h("header", { class: "evo-topo" },
      h("div", {}, h("small", {}, "Saldo devedor hoje"), num),
      h("span", { class: "evo-legenda" }, h("i", { class: "l-real" }), "até hoje", h("i", { class: "l-proj" }), "previsto")),
    seletor,
    area,
    h("div", { class: "evo-stats" },
      stat("No início", reais(total)),
      stat("Já abatido", reais(total - saldoHoje)),
      zera ? stat("Zera em", mesCurto(zera.m)) : stat("Em atraso", reais(pontos[pontos.length - 1].saldo))),
    tabela);

  // ----- Desenho -----
  let ativo = null;
  function desenhar(comAnimacao) {
    const W = Math.max(260, caixa.clientWidth || 340);
    const H = 230, ml = 62, mr = 14, mt = 18, mb = 28;
    const iw = W - ml - mr, ih = H - mt - mb;
    const n = pontos.length;
    const X = (i) => ml + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => mt + ih - (total ? (v / total) * ih : 0);
    const xs = pontos.map((_, i) => X(i)), ys = pontos.map((p) => Y(p.saldo));
    const trecho = (de, ate) => {
      let d = "";
      for (let i = de; i <= ate; i++) d += `${d ? "L" : "M"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
      return d;
    };
    const fimReal = idxAgora >= 0 ? idxAgora : -1;
    const real = fimReal >= 1 ? trecho(0, fimReal) : "";
    const proj = fimReal < n - 1 ? trecho(Math.max(fimReal, 0), n - 1) : "";
    const linhaTodos = trecho(0, n - 1);
    const areaPath = `${linhaTodos}L${xs[n - 1].toFixed(1)},${mt + ih}L${xs[0].toFixed(1)},${mt + ih}Z`;

    const grades = [0, 0.5, 1].map((f) => {
      const y = mt + ih - f * ih;
      return `<line class="g" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="eixo" x="${ml - 8}" y="${y + 4}" text-anchor="end">${f === 0 ? "R$ 0" : compacto(total * f)}</text>`;
    }).join("");
    const passo = Math.max(1, Math.ceil((n - 1) / 4));
    const marcas = [];
    for (let i = 0; i < n; i += passo) marcas.push(i);
    if (marcas[marcas.length - 1] !== n - 1 && n - 1 - marcas[marcas.length - 1] >= passo / 2) marcas.push(n - 1);
    const eixoX = marcas.map((i) => `<text class="eixo" x="${xs[i]}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${rotuloCurto(pontos[i].m)}</text>`).join("");

    const pontoHoje = idxAgora >= 0
      ? `<g class="hoje"><circle class="pulso" cx="${xs[idxAgora]}" cy="${ys[idxAgora]}" r="6"/><circle class="miolo" cx="${xs[idxAgora]}" cy="${ys[idxAgora]}" r="5.5"/><text class="rot-hoje" x="${xs[idxAgora]}" y="${Math.max(12, ys[idxAgora] - 12)}" text-anchor="middle">hoje</text></g>`
      : "";

    caixa.innerHTML = `
<svg class="evo-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0"
  aria-label="Saldo devedor de ${reais(total)} no início até ${zera ? mesCurto(zera.m) : "o fim do cronograma, com parcelas em atraso"}. Use as setas para ver cada mês.">
  <defs><linearGradient id="evo-grad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--primaria)" stop-opacity=".34"/><stop offset="1" stop-color="var(--primaria)" stop-opacity="0"/></linearGradient></defs>
  ${grades}${eixoX}
  <g class="plot${comAnimacao ? " anima" : ""}">
    <path class="area" d="${areaPath}" fill="url(#evo-grad)"/>
    ${real ? `<path class="linha real" d="${real}"/>` : ""}
    ${proj ? `<path class="linha proj" d="${proj}"/>` : ""}
  </g>
  ${pontoHoje}
  <g class="cursor" hidden><line class="mira" y1="${mt}" y2="${mt + ih}"/><circle class="ponto" r="5"/></g>
  <rect class="captura" x="${ml}" y="${mt}" width="${iw}" height="${ih + 6}" fill="transparent"/>
</svg>`;

    const svg = caixa.firstElementChild;
    const cursor = svg.querySelector(".cursor");
    const mira = svg.querySelector(".mira");
    const ponto = svg.querySelector(".ponto");

    function mostrar(i) {
      ativo = i;
      const p = pontos[i];
      cursor.removeAttribute("hidden");
      mira.setAttribute("x1", xs[i]); mira.setAttribute("x2", xs[i]);
      ponto.setAttribute("cx", xs[i]); ponto.setAttribute("cy", ys[i]);
      dica.replaceChildren(
        h("strong", {}, p.inicio ? "Antes da 1ª parcela" : nomeMes(p.m)),
        h("span", {}, `Saldo: ${reais(p.saldo)}`),
        p.inicio ? null : h("span", { class: "suave" }, `Parcelas do mês: ${reais(p.parcelaMes)}`),
        p.atrasado ? h("span", { class: "atraso" }, `Em atraso: ${reais(p.atrasado)}`) : null,
        p.futuro ? h("span", { class: "suave" }, "previsão") : null);
      dica.hidden = false;
      const largura = dica.offsetWidth || 150;
      const esq = Math.min(Math.max(xs[i] - largura / 2, 0), W - largura);
      dica.style.left = `${esq}px`;
      dica.style.top = `${Math.max(0, ys[i] - dica.offsetHeight - 14)}px`;
    }
    function esconder() { ativo = null; cursor.setAttribute("hidden", ""); dica.hidden = true; }
    const maisPerto = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ev.clientX - r.left;
      let melhor = 0;
      for (let i = 1; i < n; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[melhor] - x)) melhor = i;
      return melhor;
    };
    svg.addEventListener("pointermove", (ev) => mostrar(maisPerto(ev)));
    svg.addEventListener("pointerdown", (ev) => mostrar(maisPerto(ev)));
    svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") esconder(); });
    svg.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight") { ev.preventDefault(); mostrar(Math.min(n - 1, (ativo ?? -1) + 1)); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); mostrar(Math.max(0, (ativo ?? 1) - 1)); }
      else if (ev.key === "Escape") esconder();
    });
    svg.addEventListener("blur", esconder);
  }

  // Número que sobe até o valor atual
  function contar() {
    if (!animado) return;
    const t0 = performance.now(), dur = 1100;
    const passo = (t) => {
      const f = Math.min(1, (t - t0) / dur);
      num.textContent = reais(Math.round(saldoHoje * (1 - Math.pow(1 - f, 3))));
      if (f < 1 && num.isConnected !== false) requestAnimationFrame(passo);
    };
    num.textContent = reais(0);
    requestAnimationFrame(passo);
  }

  // O gráfico precisa estar na tela para medir a largura.
  requestAnimationFrame(() => {
    desenhar(animado);
    contar();
    if ("ResizeObserver" in window) {
      let largura = caixa.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(caixa.clientWidth - largura) > 2) { largura = caixa.clientWidth; desenhar(false); }
      }).observe(caixa);
    }
  });
  return raiz;
}
