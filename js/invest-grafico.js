// Gráfico da evolução dos investimentos: o total mês a mês (linha cheia) e o quanto foi aportado (tracejada).
// A distância entre as duas linhas é o rendimento. Usa as mesmas classes do gráfico de Dívidas (evolucao.css).

import { h, reais, nomeMes } from "./util.js";
import { compacto, rotuloCurto } from "./evolucao.js";

// Teto "redondo" do eixo vertical (12.410 -> 15.000), para os rótulos não ficarem quebrados.
export function tetoRedondo(centavos) {
  const v = Math.max(centavos, 100) / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const passo = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * mag >= v * 1.04) || 10;
  return Math.round(passo * mag * 100);
}

export const comSinal = (centavos) => (centavos > 0 ? "+" : "") + reais(centavos);

// pontos: [{ m, total, aportado, rendimento, aporteMes }]; opcoes: { animar }
export function montarGraficoInvest(pontos, { animar = false } = {}) {
  const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animado = animar && !reduzir;
  const n = pontos.length;
  const primeiro = pontos[0], ultimo = pontos[n - 1];
  const topo = tetoRedondo(Math.max(...pontos.map((p) => Math.max(p.total, p.aportado))));

  const caixa = h("div", { class: "evo-grafico" });
  const dica = h("div", { class: "evo-dica", hidden: true, role: "status" });
  const area = h("div", { class: "evo-area" }, caixa, dica);
  const stat = (rot, val) => h("div", { class: "evo-stat" }, h("small", {}, rot), h("strong", {}, val));

  const tabela = h("details", { class: "evo-tabela" },
    h("summary", {}, "Ver em tabela"),
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Mês"), h("th", {}, "Aportes"), h("th", {}, "Total"))),
      h("tbody", {}, [...pontos].reverse().map((p) => h("tr", {},
        h("td", {}, rotuloCurto(p.m)), h("td", {}, p.aporteMes ? reais(p.aporteMes) : "—"), h("td", {}, reais(p.total)))))));

  const raiz = h("article", { class: "cartao evo inv-evo" },
    h("header", { class: "evo-topo" },
      h("div", {}, h("h3", { class: "inv-h3" }, "Evolução")),
      h("span", { class: "evo-legenda" }, h("i", { class: "l-real" }), "total", h("i", { class: "l-aport" }), "aportado")),
    area,
    n === 1 ? h("p", { class: "inv-nota" }, "O gráfico ganha forma a partir do segundo mês. Atualize o valor ou faça aportes e a linha começa a crescer.") : null,
    h("div", { class: "evo-stats" },
      stat(`Em ${rotuloCurto(primeiro.m)}`, reais(primeiro.total)),
      n > 1 ? stat("Crescimento", comSinal(ultimo.total - primeiro.total)) : null),
    tabela);

  let ativo = null;
  function desenhar(comAnimacao) {
    const W = Math.max(260, caixa.clientWidth || 340);
    const H = 230, ml = 62, mr = 14, mt = 18, mb = 28;
    const iw = W - ml - mr, ih = H - mt - mb;
    const X = (i) => ml + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => mt + ih - (v / topo) * ih;
    const xs = pontos.map((_, i) => X(i));
    const caminho = (campo) => pontos.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${Y(p[campo]).toFixed(1)}`).join("");
    const linhaTotal = caminho("total");
    const areaPath = `${linhaTotal}L${xs[n - 1].toFixed(1)},${mt + ih}L${xs[0].toFixed(1)},${mt + ih}Z`;

    const grades = [0, 0.5, 1].map((f) => {
      const y = mt + ih - f * ih;
      return `<line class="g" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="eixo" x="${ml - 8}" y="${y + 4}" text-anchor="end">${f === 0 ? "R$ 0" : compacto(topo * f)}</text>`;
    }).join("");
    // Rótulos de mês em passo fixo (sem encostar um no outro), contando do mês atual para trás: ele sempre aparece.
    const maxMarcas = Math.max(2, Math.min(5, Math.floor(iw / 76)));
    const passo = Math.max(1, Math.ceil(n / maxMarcas));
    const marcas = [];
    for (let i = n - 1; i >= 0; i -= passo) marcas.unshift(i);
    const eixoX = marcas.map((i) => `<text class="eixo" x="${xs[i]}" y="${H - 8}" text-anchor="${n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${rotuloCurto(pontos[i].m)}</text>`).join("");
    const yh = Y(ultimo.total);
    const pontoHoje = `<g class="hoje"><circle class="pulso" cx="${xs[n - 1]}" cy="${yh}" r="6"/><circle class="miolo" cx="${xs[n - 1]}" cy="${yh}" r="5.5"/><text class="rot-hoje" x="${xs[n - 1]}" y="${Math.max(12, yh - 12)}" text-anchor="${n > 1 ? "end" : "middle"}">hoje</text></g>`;

    caixa.innerHTML = `
<svg class="evo-svg inv-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0"
  aria-label="Total investido: de ${reais(primeiro.total)} em ${rotuloCurto(primeiro.m)} para ${reais(ultimo.total)} hoje. Use as setas para ver cada mês.">
  <defs><linearGradient id="inv-grad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--ok)" stop-opacity=".30"/><stop offset="1" stop-color="var(--ok)" stop-opacity="0"/></linearGradient></defs>
  ${grades}${eixoX}
  <g class="plot${comAnimacao ? " anima" : ""}">
    <path class="area" d="${areaPath}" fill="url(#inv-grad)"/>
    ${n > 1 ? `<path class="linha aport" d="${caminho("aportado")}"/><path class="linha real" d="${linhaTotal}"/>` : ""}
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
      ponto.setAttribute("cx", xs[i]); ponto.setAttribute("cy", Y(p.total));
      const pct = p.aportado > 0 ? (p.rendimento / p.aportado) * 100 : 0;
      dica.replaceChildren(
        h("strong", {}, nomeMes(p.m)),
        h("span", {}, `Total: ${reais(p.total)}`),
        h("span", { class: "suave" }, `Aportado: ${reais(p.aportado)}`),
        h("span", { class: p.rendimento < 0 ? "atraso" : "suave" }, `Rendimento: ${comSinal(p.rendimento)}${p.aportado > 0 ? ` (${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : ""}`));
      dica.hidden = false;
      const largura = dica.offsetWidth || 150;
      dica.style.left = `${Math.min(Math.max(xs[i] - largura / 2, 0), W - largura)}px`;
      dica.style.top = `${Math.max(0, Y(p.total) - dica.offsetHeight - 14)}px`;
    }
    function esconder() { ativo = null; cursor.setAttribute("hidden", ""); dica.hidden = true; }
    const maisPerto = (ev) => {
      const x = ev.clientX - svg.getBoundingClientRect().left;
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

  // O gráfico precisa estar na tela para medir a largura.
  requestAnimationFrame(() => {
    desenhar(animado);
    if ("ResizeObserver" in window) {
      let largura = caixa.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(caixa.clientWidth - largura) > 2) { largura = caixa.clientWidth; desenhar(false); }
      }).observe(caixa);
    }
  });
  return raiz;
}
