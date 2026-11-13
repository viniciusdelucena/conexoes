// Módulo Teto de gastos: lançamentos de gastos imprevistos e saldo do teto do período.
//
// Gasto: { id, valorCentavos, descricao, data: "AAAA-MM-DD" }
// O período (por exemplo 20/10 a 19/11) é o mesmo de Contas. O teto vem do período (periodos.js);
// o gasto do período é a soma dos lançamentos com data dentro dele.

import { estadoVazio } from "./vazio.js";
import { $, h, reais, animarValor, animarLargura, paraCampo, parseReais } from "./util.js";
import { icone } from "./icones.js";
import { diaDaSemana, DIAS_SEMANA } from "./calendario.js";
import {
  hojeIso, somarDias, somarMesesData, dataCurta, rotuloPeriodo, listaPeriodos, periodoContem,
  periodoSeguinte, selecao, resolverSelecionado, resumoTetoPeriodo, gastosDoPeriodo,
  totalGastosDoPeriodo, navegacaoPeriodos
} from "./periodos.js";

export const resumoTeto = resumoTetoPeriodo;

// contexto: { obterBackend, obterCasaId, aviso, editarTeto(), novoPeriodo(), editarPeriodo(p), aoPeriodo(), aoResumo(resumo | null) }
export function configurarGastos(contexto) {
  let meses = {};
  let gastos = [];
  const pronto = { meses: false, gastos: false };
  let alvo = null; // gasto aberto na folha (null = novo)

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const periodos = () => listaPeriodos(meses);

  const falha = (e) => { console.error(e); contexto.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore."); };
  const executar = (fn) => Promise.resolve().then(fn).catch(falha);

  function escolher(id) {
    selecao.id = id;
    renderizar();
    if (contexto.aoPeriodo) contexto.aoPeriodo();
  }

  function renderizar() {
    const caixa = $("gt-conteudo");
    if (!caixa) return;
    if (!pronto.meses || !pronto.gastos) {
      caixa.replaceChildren(h("div", { class: "cartao ct-carregando" }, h("div", { class: "spinner", "aria-label": "Carregando" })));
      contexto.aoResumo(null);
      return;
    }
    const lista = periodos();
    const p = resolverSelecionado(lista);
    const hoje = lista.find((x) => periodoContem(x, hojeIso()));
    contexto.aoResumo(hoje ? resumoTetoPeriodo(hoje, lista, gastos) : { semPeriodo: true });
    const nav = navegacaoPeriodos({
      periodos: lista, sel: p, aoEscolher: escolher,
      aoNovo: () => contexto.novoPeriodo(), aoEditar: (x) => contexto.editarPeriodo(x)
    });
    if (!p) { caixa.replaceChildren(nav); return; }
    const r = resumoTetoPeriodo(p, lista, gastos);
    caixa.replaceChildren(nav, resumo(r), acoes(), ...excesso(r, lista), lista_(p));
  }

  function resumo(r) {
    const meta = (rotulo, valor) => h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
    const valor = h("div", { class: "rd-valor" });
    animarValor(valor, "teto-hero", Math.abs(r.restante));
    const preenchido = h("span", {});
    animarLargura(preenchido, "teto-hero", r.pct);
    return h("div", { class: "cartao resumo-div" + (r.estourou ? " estourou" : "") },
      h("div", { class: "rd-rotulo" }, r.estourou ? "Passou do limite em" : "Ainda dá para gastar"),
      valor,
      h("div", { class: "barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.pct), "aria-label": "Quanto do limite já foi usado" },
        preenchido),
      h("div", { class: "rd-meta" },
        meta("Limite", reais(r.teto)),
        meta(`Gasto · ${r.teto > 0 ? Math.round((r.gasto / r.teto) * 100) : 0}%`, reais(r.gasto)),
        r.porDia !== null ? meta("Por dia até o fim do período", reais(r.porDia)) : null));
  }

  function acoes() {
    return h("div", { class: "gt-acoes" },
      h("button", { class: "btn primario", type: "button", onclick: () => abrirGasto(null) }, "+ Lançar gasto"),
      h("button", { class: "btn", type: "button", onclick: () => contexto.editarTeto() }, "Alterar limite"));
  }

  // Período logo depois do atual: o que já existe ou, se não existir, o que seria criado.
  function proximoDe(p, lista) {
    const real = lista.find((q) => q.inicio > p.fim);
    return real || { id: null, ...periodoSeguinte(p) };
  }

  // Excesso do teto: leva o que passou do teto para o período seguinte (vira um gasto lá, no primeiro dia).
  function excesso(r, lista) {
    const p = r.p;
    const prox = proximoDe(p, lista);
    const nomeProx = rotuloPeriodo(prox);
    const levado = gastos.find((g) => g.excessoDe === p.id);
    if (r.estourou) {
      return [h("button", { class: "btn-sutil gt-excesso", type: "button", onclick: () => levarExcesso(p, prox, r.gasto - r.teto, levado) },
        levado ? `Atualizar o excesso levado para ${nomeProx} (${reais(r.gasto - r.teto)})` : `Levar o excesso de ${reais(r.gasto - r.teto)} para ${nomeProx}`)];
    }
    if (levado) {
      return [h("button", { class: "btn-sutil gt-excesso", type: "button", onclick: () => desfazerExcesso(levado) },
        `Desfazer o excesso levado para ${nomeProx}`)];
    }
    return [];
  }

  function levarExcesso(p, prox, valor, levado) {
    const dados = { valorCentavos: valor, descricao: `Excesso de ${rotuloPeriodo(p)}`, data: prox.inicio, excessoDe: p.id };
    contexto.aviso(`Excesso levado para ${rotuloPeriodo(prox)}`);
    executar(() => backend().salvarGasto(casa(), levado ? levado.id : null, dados));
  }

  function desfazerExcesso(levado) {
    contexto.aviso("Excesso desfeito");
    executar(() => backend().excluirGasto(casa(), levado.id));
  }

  // Move um gasto para o período seguinte, no mesmo dia do mês seguinte (ou no primeiro dia do período, se não couber).
  function destinoDoGasto(g) {
    const lista = periodos();
    const atual = lista.find((q) => periodoContem(q, g.data));
    const prox = atual ? proximoDe(atual, lista) : null;
    let data = somarMesesData(g.data, 1);
    if (prox && !periodoContem(prox, data)) data = data < prox.inicio ? prox.inicio : prox.fim;
    return { data, prox };
  }

  function moverParaProximoPeriodo() {
    if (!alvo) return;
    const g = alvo;
    const { data, prox } = destinoDoGasto(g);
    fechar();
    contexto.aviso(prox ? `Gasto movido para ${rotuloPeriodo(prox)}` : `Gasto movido para ${dataCurta(data)}`);
    executar(() => backend().salvarGasto(casa(), g.id, { data }));
  }

  function lista_(p) {
    const doPeriodo = gastosDoPeriodo(p, gastos)
      .sort((a, b) => (a.data === b.data ? 0 : a.data < b.data ? 1 : -1));
    if (!doPeriodo.length) {
      return estadoVazio({
        ilustracao: "teto",
        titulo: "Nenhum gasto neste período",
        texto: "Use o botão acima para lançar gastos imprevistos, como farmácia, lanche e conserto. Eles saem do limite de imprevistos."
      });
    }
    return h("article", { class: "cartao ct-secao" },
      h("header", { class: "ct-topo" }, h("h3", {}, "Gastos do período"), h("span", { class: "ct-subtotal" }, reais(totalGastosDoPeriodo(p, gastos)))),
      h("ul", { class: "ct-lista" }, doPeriodo.map((g) => h("li", {},
        h("button", { class: "ct-linha", type: "button", onclick: () => abrirGasto(g) },
          h("span", { class: "ct-ico", html: icone("teto", 20) }),
          h("span", { class: "ct-info" },
            h("span", { class: "ct-nome" }, g.descricao || "Gasto"),
            h("span", { class: "ct-sub" }, `${DIAS_SEMANA[diaDaSemana(g.data)]}, ${dataCurta(g.data)}` + (g.excessoDe ? " · levado do período anterior" : ""))),
          h("span", { class: "ct-valor" }, reais(g.valorCentavos)),
          h("span", { class: "ct-seta", html: icone("dir", 16) }))))));
  }

  // ----- Folha de lançamento -----
  function erro(msg) { const el = $("erro-gasto"); el.textContent = msg || ""; el.hidden = !msg; }
  function fechar() { $("folha-gasto").hidden = true; alvo = null; }

  function abrirGasto(g) {
    alvo = g;
    erro("");
    $("gasto-titulo").textContent = g ? "Editar gasto" : "Novo gasto";
    $("gt-valor").value = g ? paraCampo(g.valorCentavos) : "";
    $("gt-desc").value = g ? g.descricao || "" : "";
    const p = resolverSelecionado(periodos());
    $("gt-data").value = g ? g.data : (p && periodoContem(p, hojeIso()) ? hojeIso() : p ? p.inicio : hojeIso());
    const botao = $("btn-excluir-gasto");
    botao.hidden = !g;
    $("btn-gasto-proximo").hidden = !g;
    if (g) { const { data, prox } = destinoDoGasto(g); $("gt-prox-txt").textContent = prox ? `Vai para ${dataCurta(data)}, no período de ${rotuloPeriodo(prox)}` : `Vai para ${dataCurta(data)}`; }
    $("folha-gasto").hidden = false;
    requestAnimationFrame(() => $("gt-valor").focus());
  }

  function salvar() {
    const valorCentavos = parseReais($("gt-valor").value);
    const data = $("gt-data").value;
    const descricao = $("gt-desc").value.trim();
    if (!(valorCentavos > 0)) return erro("Informe o valor, por exemplo 25,90.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erro("Escolha a data do gasto.");
    const per = resolverSelecionado(periodos());
    if (per && !periodoContem(per, data) && !alvo) return erro(`A data precisa ficar dentro do período (${rotuloPeriodo(per)}).`);
    const id = alvo ? alvo.id : null;
    fechar();
    contexto.aviso(id ? "Gasto atualizado" : "Gasto lançado");
    executar(() => backend().salvarGasto(casa(), id, { valorCentavos, descricao, data }));
  }

  function excluir() {
    if (!alvo) return;
    const id = alvo.id;
    fechar();
    contexto.aviso("Gasto excluído");
    executar(() => backend().excluirGasto(casa(), id));
  }

  $("folha-gasto").addEventListener("click", (e) => { if (e.target.closest("[data-fechar]")) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("folha-gasto").hidden) fechar(); });
  $("form-gasto").addEventListener("submit", (e) => { e.preventDefault(); salvar(); });
  $("btn-excluir-gasto").addEventListener("click", excluir);
  $("btn-gasto-proximo").addEventListener("click", moverParaProximoPeriodo);

  renderizar();

  return {
    receberMeses(m) { meses = m; pronto.meses = true; renderizar(); },
    receberGastos(l) { gastos = l; pronto.gastos = true; renderizar(); },
    atualizar() { renderizar(); },
    abrirNovo() { abrirGasto(null); },
    limpar() { meses = {}; gastos = []; pronto.meses = pronto.gastos = false; selecao.id = null; fechar(); renderizar(); }
  };
}
