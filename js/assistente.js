// Tela Assistente: um chat simples que responde com cálculos feitos no aparelho (veja analise.js).

import { $, h } from "./util.js";
import { icone } from "./icones.js";
import { reais, mesCurto, somarMeses } from "./util.js";
import { responder, simularQuitacao, SUGESTOES_INICIAIS } from "./analise.js";

let dados = { contas: [], meses: {}, gastos: [] };
let mensagens = []; // { de: "eu" | "bot", txt?, resp? }
let pensando = false;
let ctx = null;

export function configurar(contexto) {
  ctx = contexto;
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = $("chat-texto");
    const txt = campo.value.trim();
    if (!txt) return;
    campo.value = "";
    perguntar(txt);
  });
  renderizar();
}

export function receberContas(l) { dados = { ...dados, contas: l || [] }; }
export function receberMeses(m) { dados = { ...dados, meses: m || {} }; }
export function receberGastos(l) { dados = { ...dados, gastos: l || [] }; }
export function limpar() { dados = { contas: [], meses: {}, gastos: [] }; mensagens = []; pensando = false; renderizar(); }
export function aoAbrir() { renderizar(); }

export function perguntar(txt) {
  if (pensando) return;
  mensagens.push({ de: "eu", txt });
  pensando = true;
  renderizar(true);
  // Uma pausa curta deixa a conversa mais natural; os cálculos em si são instantâneos.
  setTimeout(() => {
    let resp;
    try { resp = responder(txt, dados); }
    catch (e) { console.error(e); resp = { titulo: "Algo deu errado", blocos: [{ t: "p", txt: "Não consegui calcular isso agora. Tente outra pergunta." }], sugestoes: SUGESTOES_INICIAIS }; }
    mensagens.push({ de: "bot", resp });
    pensando = false;
    renderizar(true);
  }, 450);
}

const COR_CAT = ["var(--cat-2)", "var(--cat-3)", "var(--cat-1)", "var(--cat-4)", "var(--cat-5, var(--cat-2))"];
const mesesTxt = (n) => `${n} ${n === 1 ? "mês" : "meses"}`;
const titulo = (t) => (t ? h("div", { class: "ch-sub" }, t) : null);

function bloco(b) {
  switch (b.t) {
    case "p": return h("p", { class: "ch-p" }, b.txt);
    case "dica": return h("div", { class: `ch-dica ${b.tom || "info"}` }, h("span", { class: "ch-dica-ico", "aria-hidden": "true" }, b.tom === "alerta" ? "!" : b.tom === "ok" ? "✓" : "i"), h("span", {}, b.txt));
    case "kpis": return h("div", { class: "ch-kpis", style: `--n:${b.itens.length}` }, b.itens.map((k) =>
      h("div", { class: `ch-kpi ${k.tom || "neutro"}` }, h("small", {}, k.rotulo), h("strong", {}, k.valor), k.nota ? h("span", {}, k.nota) : null)));
    case "anel": return blocoAnel(b);
    case "pilha": return blocoPilha(b);
    case "ranking": return h("div", { class: "ch-bloco" }, titulo(b.titulo), h("ul", { class: "ch-rank" }, b.itens.map((i, k) =>
      h("li", {}, h("div", { class: "ch-l-topo" }, h("span", { class: "ch-l-nome" }, i.rotulo), h("span", { class: `ch-l-valor ${i.tom || ""}` }, i.texto)),
        h("div", { class: `ch-barra ${i.tom || ""}` }, h("span", { style: `--w:${i.pct}%; --d:${k * 70}ms` }))))));
    case "colunas": return blocoColunas(b);
    case "tempo": return h("div", { class: "ch-bloco" }, titulo(b.titulo), h("ol", { class: "ch-tempo" }, b.itens.map((i) =>
      h("li", {}, h("span", { class: "ch-ponto" }, i.quando),
        h("div", { class: "ch-t-corpo" }, h("strong", {}, i.titulo), h("span", {}, i.nota),
          typeof i.pct === "number" ? h("div", { class: "ch-prog" }, h("div", { class: "ch-barra" }, h("span", { style: `--w:${i.pct}%` })), h("small", {}, i.rotuloPct || `${i.pct}%`)) : null)))));
    case "chips": return h("div", { class: "ch-bloco" }, titulo(b.titulo), h("div", { class: "ch-etiquetas" }, b.itens.map((i) => h("span", { class: `ch-etq ${i.tom || ""}` }, i.txt))));
    case "detalhes": return h("details", { class: "ch-detalhes" }, h("summary", {}, b.titulo), ...b.blocos.map(bloco));
    case "simulador": return blocoSimulador(b);
    default: return null;
  }
}

function blocoAnel(b) {
  const R = 38, C = 2 * Math.PI * R;
  return h("div", { class: "ch-anel-caixa" },
    h("div", { class: "ch-anel", html:
      `<svg viewBox="0 0 100 100" role="img" aria-label="${b.centro} ${b.sub}"><circle cx="50" cy="50" r="${R}" class="ch-anel-fundo"/><circle cx="50" cy="50" r="${R}" class="ch-anel-valor" stroke-dasharray="${C.toFixed(1)}" style="--c:${C.toFixed(1)}; --f:${(C * (1 - Math.min(100, b.pct) / 100)).toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
       <div class="ch-anel-txt"><strong>${b.centro}</strong><small>${b.sub}</small></div>` }),
    b.titulo ? h("div", { class: "ch-anel-leg" }, h("small", {}, "Período"), h("strong", {}, b.titulo)) : null);
}

function blocoPilha(b) {
  const total = b.itens.reduce((s, i) => s + i.valor, 0) || 1;
  const info = h("div", { class: "ch-pilha-info" }, "Toque numa parte para ver o valor");
  const segs = b.itens.map((i, k) => {
    const pct = Math.round((i.valor / total) * 100);
    const seg = h("button", {
      type: "button", class: "ch-seg", style: `flex:${i.valor}; --cor:${COR_CAT[k % COR_CAT.length]}; --d:${k * 90}ms`, "aria-label": `${i.nome} ${i.texto}`,
      onclick: () => { info.textContent = `${i.nome}: ${i.texto} (${pct}%)`; segs.forEach((x) => x.classList.toggle("on", x === seg)); }
    });
    return seg;
  });
  return h("div", { class: "ch-bloco" }, titulo(b.titulo),
    h("div", { class: "ch-pilha" }, ...segs),
    h("ul", { class: "ch-legenda" }, b.itens.map((i, k) =>
      h("li", {}, h("i", { style: `background:${COR_CAT[k % COR_CAT.length]}` }), h("span", {}, i.nome), h("b", {}, `${Math.round((i.valor / total) * 100)}%`)))),
    info);
}

function blocoColunas(b) {
  const max = Math.max(...b.itens.map((i) => i.valor), b.limite ? b.limite.valor : 0, 1);
  const info = h("div", { class: "ch-colunas-info" }, "");
  const cols = b.itens.map((i, k) => {
    const col = h("button", {
      type: "button", class: `ch-col ${i.tom || ""}${i.atual ? " atual" : ""}`, "aria-label": `${i.rotulo}: ${i.texto}`,
      onclick: () => { info.textContent = `${i.detalhe || i.rotulo} · ${i.texto}${i.extra ? ` (${i.extra})` : ""}`; cols.forEach((x) => x.classList.toggle("on", x === col)); }
    }, h("span", { class: "ch-col-valor" }, i.texto.replace("R$ ", "").replace(/,00$/, "")),
      h("span", { class: "ch-col-barra", style: `--h:${Math.max(3, Math.round((i.valor / max) * 100))}%; --d:${k * 60}ms` }),
      h("span", { class: "ch-col-rot" }, i.rotulo));
    return col;
  });
  const ultima = cols[cols.length - 1];
  const ult = b.itens[b.itens.length - 1];
  info.textContent = `${ult.detalhe || ult.rotulo} · ${ult.texto}${ult.extra ? ` (${ult.extra})` : ""}`;
  if (ultima) ultima.classList.add("on");
  return h("div", { class: "ch-bloco" }, titulo(b.titulo),
    h("div", { class: "ch-colunas" },
      b.limite ? h("div", { class: "ch-limite", style: `bottom:calc(var(--rot-h) + (100% - var(--rot-h) - var(--val-h)) * ${(b.limite.valor / max).toFixed(3)})` }, h("span", {}, `${b.limite.rotulo} ${reais(b.limite.valor)}`)) : null,
      ...cols),
    info);
}

function blocoSimulador(b) {
  let extra = b.extra;
  const saida = h("div", { class: "ch-sim-saida" });
  const rotulo = h("strong", { class: "ch-sim-valor" });
  const faixa = h("input", { type: "range", min: "0", max: String(b.max), step: String(b.passo), value: String(extra), "aria-label": "Valor a mais por mês" });
  function calcular() {
    extra = Number(faixa.value);
    rotulo.textContent = extra ? `+ ${reais(extra)} por mês` : "Sem valor extra";
    const sem = simularQuitacao(b.ativas, 0), com = simularQuitacao(b.ativas, extra);
    const base = com.base || 1;
    const cen = [
      { r: "Calendário atual", m: com.base, tom: "base", n: "paga cada parcela até o fim" },
      { r: "Reaproveitando parcelas", m: sem.meses, tom: "meio", n: "passa a parcela que acaba para a próxima" },
      ...(extra ? [{ r: `Com ${reais(extra)} a mais`, m: com.meses, tom: "bom", n: "valor extra na dívida de menor saldo" }] : [])
    ];
    const ganho = com.base - com.meses;
    saida.replaceChildren(
      h("ul", { class: "ch-cen" }, cen.map((c) => h("li", { class: c.tom },
        h("div", { class: "ch-l-topo" }, h("span", { class: "ch-l-nome" }, c.r), h("span", { class: "ch-l-valor" }, mesesTxt(c.m))),
        h("div", { class: "ch-barra" }, h("span", { style: `--w:${Math.round((c.m / base) * 100)}%` })),
        h("small", {}, c.n)))),
      h("div", { class: `ch-dica ${ganho > 0 ? "ok" : "info"}` }, h("span", { class: "ch-dica-ico", "aria-hidden": "true" }, ganho > 0 ? "✓" : "i"),
        h("span", {}, ganho > 0
          ? `Você fica livre ${mesesTxt(ganho)} antes, em ${mesCurto(somarMeses(b.hoje, com.meses - 1))}.`
          : `Livre em ${mesCurto(somarMeses(b.hoje, com.meses - 1))}. Arraste para ver o efeito de pagar mais.`)));
  }
  faixa.addEventListener("input", calcular);
  calcular();
  return h("div", { class: "ch-bloco ch-sim" }, titulo(b.titulo), rotulo, faixa,
    h("div", { class: "ch-faixa-lim" }, h("span", {}, "R$ 0"), h("span", {}, reais(b.max))), saida,
    h("p", { class: "ch-nota" }, "Sem juros cadastrados, o total pago não muda: o ganho é ficar livre antes."));
}

function chips(lista) {
  return h("div", { class: "ch-chips" }, lista.map((t) =>
    h("button", { type: "button", class: "ch-chip", disabled: pensando, onclick: () => perguntar(t) }, t)));
}

function mensagem(m, ehUltima) {
  if (m.de === "eu") return h("div", { class: "ch-msg eu" }, h("div", { class: "ch-balao" }, m.txt));
  return h("div", { class: "ch-msg bot" },
    h("div", { class: "ch-avatar", html: icone("infinito", 18) }),
    h("div", { class: "ch-corpo" },
      h("div", { class: "ch-balao" }, h("strong", { class: "ch-titulo" }, m.resp.titulo), ...m.resp.blocos.map(bloco)),
      ehUltima && m.resp.sugestoes && m.resp.sugestoes.length ? chips(m.resp.sugestoes) : null));
}

function renderizar(rolar) {
  const caixa = $("chat-msgs");
  if (!caixa) return;
  const ultimaBot = mensagens.map((m) => m.de).lastIndexOf("bot");
  const nos = [];
  if (!mensagens.length) {
    nos.push(h("div", { class: "ch-msg bot" },
      h("div", { class: "ch-avatar", html: icone("infinito", 18) }),
      h("div", { class: "ch-corpo" },
        h("div", { class: "ch-balao" },
          h("strong", { class: "ch-titulo" }, "Oi! Eu sou o assistente do Conexões"),
          h("p", { class: "ch-p" }, "Analiso as contas, as parcelas e os imprevistos de vocês e sugiro como quitar mais rápido. Escolha um assunto ou escreva sua pergunta."),
          h("p", { class: "ch-p ch-nota" }, "Tudo é calculado aqui no aparelho. Nenhum dado seu sai do app.")),
        chips(SUGESTOES_INICIAIS))));
  } else {
    mensagens.forEach((m, i) => nos.push(mensagem(m, i === ultimaBot && !pensando)));
  }
  if (pensando) {
    nos.push(h("div", { class: "ch-msg bot" },
      h("div", { class: "ch-avatar", html: icone("infinito", 18) }),
      h("div", { class: "ch-corpo" }, h("div", { class: "ch-balao digitando", "aria-label": "Digitando" }, h("i", {}), h("i", {}), h("i", {})))));
  }
  caixa.replaceChildren(...nos);
  $("chat-enviar").disabled = pensando;
  if (rolar) {
    const ultimo = caixa.lastElementChild;
    if (ultimo) requestAnimationFrame(() => ultimo.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
}
