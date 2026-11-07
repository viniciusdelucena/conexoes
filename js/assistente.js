// Tela Assistente: um chat simples que responde com cálculos feitos no aparelho (veja analise.js).

import { $, h } from "./util.js";
import { icone } from "./icones.js";
import { responder, SUGESTOES_INICIAIS } from "./analise.js";

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

function bloco(b) {
  if (b.t === "p") return h("p", { class: "ch-p" }, b.txt);
  if (b.t === "destaque") {
    return h("div", { class: "ch-destaque" },
      h("small", {}, b.rotulo), h("strong", {}, b.valor), b.nota ? h("span", {}, b.nota) : null);
  }
  if (b.t === "lista") return h("ul", { class: "ch-lista" }, b.itens.map((i) => h("li", {}, i)));
  if (b.t === "linhas") {
    return h("ul", { class: "ch-linhas" }, b.linhas.map((l) =>
      h("li", {},
        h("div", { class: "ch-l-topo" },
          h("span", { class: "ch-l-nome" }, l.rotulo),
          h("span", { class: "ch-l-valor" }, l.valor,
            l.extra ? h("small", { class: l.sobe ? "sobe" : "" }, l.extra) : null)),
        typeof l.pct === "number" ? h("div", { class: "barra fina" }, h("span", { style: `width:${l.pct}%` })) : null)));
  }
  return null;
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
