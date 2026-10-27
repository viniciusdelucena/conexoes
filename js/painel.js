// Painel da tela Início: composição do mês atual e evolução das contas mês a mês.
// Recebe a série de meses já calculada por Contas: [{ ym, parcelas, fixas, variaveis, teto, total, ... }]

import { h, reais, mesAtual, mesCurto, nomeMes, NOMES_MESES } from "./util.js";

const CATEGORIAS = [
  { id: "parcelas", nome: "Dívidas", cor: "var(--cat-1)", valor: (r) => r.parcelas.total },
  { id: "fixas", nome: "Contas fixas", cor: "var(--cat-2)", valor: (r) => r.fixas },
  { id: "variaveis", nome: "Contas variáveis", cor: "var(--cat-3)", valor: (r) => r.variaveis },
  { id: "teto", nome: "Teto de gastos", cor: "var(--cat-4)", valor: (r) => r.teto }
];

function compactoPn(centavos) {
  const v = centavos / 100;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace(".", ",")} mil`;
  return `R$ ${Math.round(v)}`;
}
const abrev = (ym) => NOMES_MESES[Number(ym.slice(5)) - 1].slice(0, 3).toLowerCase();

// Maior queda do total entre dois meses seguidos (explica "por que o mês melhora").
export function maiorQueda(serie) {
  let melhor = null;
  for (let i = 1; i < serie.length; i++) {
    const queda = serie[i - 1].total - serie[i].total;
    if (queda > 0 && (!melhor || queda > melhor.queda)) melhor = { ym: serie[i].ym, queda };
  }
  return melhor;
}

export function configurarPainel() {
  const raiz = document.getElementById("painel");
  let serie = [];
  let jaAnimou = false;
  let animarProximo = true;

  const reduzir = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderizar() {
    if (!raiz) return;
    if (!serie.length) { raiz.replaceChildren(); return; }
    const animar = animarProximo && !reduzir();
    animarProximo = false;
    raiz.replaceChildren(cartaoComposicao(animar), cartaoMeses(animar));
    jaAnimou = true;
  }

  // ----- Composição do mês atual -----
  function cartaoComposicao(animar) {
    const r = serie.find((x) => x.ym === mesAtual()) || serie[0];
    const partes = CATEGORIAS.map((c) => ({ ...c, v: c.valor(r) })).filter((p) => p.v > 0);
    const total = partes.reduce((s, p) => s + p.v, 0) || 1;
    const barra = h("div", { class: "pn-barra", role: "img", "aria-label": `Composição de ${nomeMes(r.ym)}: ${partes.map((p) => `${p.nome} ${Math.round((p.v / total) * 100)}%`).join(", ")}` },
      partes.map((p, i) => h("span", { class: "pn-seg", style: `--w:${(p.v / total) * 100}%;--i:${i};background:${p.cor}`, title: `${p.nome}: ${reais(p.v)}` })));
    if (animar) barra.classList.add("anima");
    return h("article", { class: "cartao pn-cartao" },
      h("header", { class: "pn-topo" }, h("h3", {}, "Para onde vai o mês"), h("span", { class: "pn-total" }, reais(r.total))),
      h("p", { class: "sub pequeno" }, `${nomeMes(r.ym)}, com o teto cheio`),
      barra,
      h("ul", { class: "pn-lista" }, partes.map((p) => h("li", {},
        h("i", { class: "pn-cor", style: `background:${p.cor}` }),
        h("span", { class: "pn-nome" }, p.nome),
        h("span", { class: "pn-pct" }, `${Math.round((p.v / total) * 100)}%`),
        h("strong", {}, reais(p.v))))));
  }

  // ----- Colunas empilhadas mês a mês -----
  function cartaoMeses(animar) {
    const caixa = h("div", { class: "pn-grafico" });
    const dica = h("div", { class: "pn-dica", hidden: true, role: "status" });
    const queda = maiorQueda(serie);
    const legenda = h("div", { class: "pn-legenda" }, CATEGORIAS.map((c) => h("span", {}, h("i", { class: "pn-cor", style: `background:${c.cor}` }), c.nome)));
    const tabela = h("details", { class: "evo-tabela" },
      h("summary", {}, "Ver em tabela"),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Mês"), CATEGORIAS.map((c) => h("th", {}, c.nome)), h("th", {}, "Total"))),
        h("tbody", {}, serie.map((r) => h("tr", {}, h("td", {}, mesCurto(r.ym)), CATEGORIAS.map((c) => h("td", {}, reais(c.valor(r)))), h("td", {}, reais(r.total)))))));
    const cartao = h("article", { class: "cartao pn-cartao" },
      h("header", { class: "pn-topo" }, h("h3", {}, "Mês a mês"), h("span", { class: "sub pequeno" }, "total com o teto")),
      legenda,
      h("div", { class: "pn-area" }, caixa, dica),
      queda ? h("p", { class: "pn-insight" }, `Em ${nomeMes(queda.ym)} o total cai ${reais(queda.queda)} em relação ao mês anterior.`) : null,
      tabela);

    function desenhar(comAnimacao) {
      const W = Math.max(260, caixa.clientWidth || 340), H = 230;
      const ml = 56, mr = 8, mt = 12, mb = 28;
      const iw = W - ml - mr, ih = H - mt - mb;
      const n = serie.length;
      const maxTotal = Math.max(...serie.map((r) => r.total), 1);
      const topo = maxTotal * 1.08;
      const Y = (v) => mt + ih - (v / topo) * ih;
      const banda = iw / n, larg = Math.min(38, banda * 0.62);
      const hoje = mesAtual();

      const grades = [0, 0.5, 1].map((f) => {
        const y = mt + ih - f * ih;
        return `<line class="g" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="eixo" x="${ml - 8}" y="${y + 4}" text-anchor="end">${f === 0 ? "R$ 0" : compactoPn(topo * f)}</text>`;
      }).join("");

      const colunas = serie.map((r, i) => {
        const cx = ml + banda * i + banda / 2;
        let acc = 0;
        const segs = CATEGORIAS.map((c, k) => ({ c, v: c.valor(r) })).filter((s) => s.v > 0);
        const rects = segs.map((s, k) => {
          const y1 = Y(acc + s.v), y0 = Y(acc);
          acc += s.v;
          const alt = Math.max(0, y0 - y1 - 2); // 2px de folga entre blocos
          const topoSeg = k === segs.length - 1;
          const x = cx - larg / 2, y = y1;
          const raio = Math.min(5, alt / 2);
          const d = topoSeg
            ? `M${x},${y + alt}V${y + raio}Q${x},${y} ${x + raio},${y}H${x + larg - raio}Q${x + larg},${y} ${x + larg},${y + raio}V${y + alt}Z`
            : `M${x},${y}H${x + larg}V${y + alt}H${x}Z`;
          return `<path d="${d}" fill="${s.c.cor}"/>`;
        }).join("");
        const atual = r.ym === hoje;
        return `<g class="col${comAnimacao ? " anima" : ""}" data-i="${i}" style="--i:${i}">${rects}</g>
<text class="eixo${atual ? " atual" : ""}" x="${cx}" y="${H - 8}" text-anchor="middle">${abrev(r.ym)}</text>
<rect class="captura" data-i="${i}" x="${cx - banda / 2}" y="${mt}" width="${banda}" height="${ih + 8}" fill="transparent"/>`;
      }).join("");

      caixa.innerHTML = `<svg class="pn-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0"
  aria-label="Total das contas de ${mesCurto(serie[0].ym)} a ${mesCurto(serie[n - 1].ym)}, empilhado por dívidas, contas fixas, variáveis e teto. Use as setas para ver cada mês.">${grades}${colunas}</svg>`;

      const svg = caixa.firstElementChild;
      let ativo = null;
      const cols = [...svg.querySelectorAll(".col")];
      function mostrar(i) {
        ativo = i;
        cols.forEach((g, k) => g.classList.toggle("apagada", k !== i));
        const r = serie[i];
        dica.replaceChildren(...[
          h("strong", {}, nomeMes(r.ym) + (r.ym === hoje ? " (este mês)" : "")),
          ...CATEGORIAS.map((c) => c.valor(r) > 0 ? h("span", { class: "pn-linha" }, h("i", { class: "pn-cor", style: `background:${c.cor}` }), c.nome, h("b", {}, reais(c.valor(r)))) : null),
          h("span", { class: "pn-linha total" }, "Total", h("b", {}, reais(r.total)))
        ].filter(Boolean));
        dica.hidden = false;
        const cx = ml + banda * i + banda / 2;
        const lw = dica.offsetWidth || 170;
        dica.style.left = `${Math.min(Math.max(cx - lw / 2, 0), W - lw)}px`;
        dica.style.top = `${Math.max(0, Y(r.total) - dica.offsetHeight - 8)}px`;
      }
      function esconder() { ativo = null; cols.forEach((g) => g.classList.remove("apagada")); dica.hidden = true; }
      svg.querySelectorAll(".captura").forEach((el) => {
        el.addEventListener("pointermove", () => mostrar(Number(el.dataset.i)));
        el.addEventListener("pointerdown", () => mostrar(Number(el.dataset.i)));
      });
      svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") esconder(); });
      svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); mostrar(Math.min(n - 1, (ativo ?? -1) + 1)); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); mostrar(Math.max(0, (ativo ?? 1) - 1)); }
        else if (e.key === "Escape") esconder();
      });
      svg.addEventListener("blur", esconder);
    }

    requestAnimationFrame(() => {
      desenhar(animar);
      if ("ResizeObserver" in window) {
        let largura = caixa.clientWidth;
        new ResizeObserver(() => {
          if (Math.abs(caixa.clientWidth - largura) > 2) { largura = caixa.clientWidth; desenhar(false); }
        }).observe(caixa);
      }
    });
    return cartao;
  }

  return {
    // Chamado sempre que os dados mudam: não repete a animação.
    atualizar(nova) {
      serie = nova || [];
      if (!jaAnimou) animarProximo = true;
      renderizar();
    },
    // Chamado ao abrir a tela Início: anima de novo.
    animar() { animarProximo = true; renderizar(); },
    limpar() { serie = []; jaAnimou = false; renderizar(); }
  };
}
