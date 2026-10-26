// Módulo Teto de gastos: lançamentos de gastos imprevistos e saldo do teto do mês.
//
// Gasto: { id, valorCentavos, descricao, data: "AAAA-MM-DD" }
// O teto do mês vem de Contas (tetoDoMes). O gasto do mês é a soma dos lançamentos com data no mês.

import { $, h, reais, paraCampo, parseReais, mesAtual, somarMeses, nomeMes } from "./util.js";
import { icone } from "./icones.js";
import { tetoDoMes, totalGastosDoMes } from "./contas.js";
import { diasNoMes, diaDaSemana, DIAS_SEMANA } from "./calendario.js";

export function resumoTeto(ym, meses, gastos, hoje = mesAtual(), diaHoje = new Date().getDate()) {
  const teto = tetoDoMes(ym, meses);
  const gasto = totalGastosDoMes(ym, gastos);
  const restante = teto - gasto;
  const pct = teto > 0 ? Math.min(100, Math.round((gasto / teto) * 100)) : (gasto > 0 ? 100 : 0);
  let porDia = null;
  if (ym === hoje && restante > 0) {
    const diasRestantes = diasNoMes(ym) - diaHoje + 1;
    porDia = Math.floor(restante / diasRestantes);
  }
  return { ym, teto, gasto, restante, pct, estourou: restante < 0, porDia };
}

// contexto: { obterBackend, obterCasaId, aviso, editarTeto(ym), aoResumo(resumo | null) }
export function configurarGastos(contexto) {
  let meses = {};
  let gastos = [];
  const pronto = { meses: false, gastos: false };
  let mesSel = mesAtual();
  let alvo = null; // gasto aberto na folha (null = novo)

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const dois = (n) => String(n).padStart(2, "0");
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`; };

  const falha = (e) => { console.error(e); contexto.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore."); };
  const executar = (fn) => Promise.resolve().then(fn).catch(falha);

  function renderizar() {
    const caixa = $("gt-conteudo");
    if (!caixa) return;
    if (!pronto.meses || !pronto.gastos) {
      caixa.replaceChildren(navegacao(), h("div", { class: "cartao ct-carregando" }, h("div", { class: "spinner", "aria-label": "Carregando" })));
      contexto.aoResumo(null);
      return;
    }
    const r = resumoTeto(mesSel, meses, gastos);
    caixa.replaceChildren(navegacao(), resumo(r), acoes(), lista());
    contexto.aoResumo(resumoTeto(mesAtual(), meses, gastos));
  }

  function navegacao() {
    const hoje = mesAtual();
    const ir = (n) => () => { mesSel = somarMeses(mesSel, n); renderizar(); };
    const opcoes = [];
    for (let n = -12; n <= 12; n++) {
      const ym = somarMeses(mesSel, n);
      opcoes.push(h("option", { value: ym, selected: n === 0 }, nomeMes(ym)));
    }
    return h("div", { class: "ct-nav" },
      h("div", { class: "mes-nav" },
        h("button", { class: "mes-seta", type: "button", "aria-label": "Mês anterior", onclick: ir(-1), html: icone("esq", 20) }),
        h("label", { class: "mes-escolha" },
          h("span", { class: "mes-nome" }, nomeMes(mesSel)),
          h("span", { class: "mes-dica" }, mesSel === hoje ? "Este mês" : "Toque para escolher o mês"),
          h("select", { class: "mes-select", "aria-label": "Escolher o mês", onchange: (e) => { mesSel = e.target.value; renderizar(); } }, opcoes)),
        h("button", { class: "mes-seta", type: "button", "aria-label": "Próximo mês", onclick: ir(1), html: icone("dir", 20) })),
      mesSel !== hoje ? h("button", { class: "btn-sutil", type: "button", onclick: () => { mesSel = hoje; renderizar(); } }, "Voltar para este mês") : null);
  }

  function resumo(r) {
    const meta = (rotulo, valor) => h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
    return h("div", { class: "cartao resumo-div" + (r.estourou ? " estourou" : "") },
      h("div", { class: "rd-rotulo" }, r.estourou ? "Passou do teto em" : "Ainda dá para gastar"),
      h("div", { class: "rd-valor" }, reais(Math.abs(r.restante))),
      h("div", { class: "barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.pct), "aria-label": "Quanto do teto já foi usado" },
        h("span", { style: `width:${r.pct}%` })),
      h("div", { class: "rd-meta" },
        meta("Teto", reais(r.teto)),
        meta("Gasto", `${reais(r.gasto)} (${r.teto > 0 ? Math.round((r.gasto / r.teto) * 100) : 0}%)`),
        r.porDia !== null ? meta("Por dia até o fim do mês", reais(r.porDia)) : null));
  }

  function acoes() {
    return h("div", { class: "gt-acoes" },
      h("button", { class: "btn primario", type: "button", onclick: () => abrirGasto(null) }, "+ Lançar gasto"),
      h("button", { class: "btn", type: "button", onclick: () => contexto.editarTeto(mesSel) }, "Alterar teto"));
  }

  function lista() {
    const doMes = gastos.filter((g) => g.data.startsWith(mesSel + "-"))
      .sort((a, b) => (a.data === b.data ? 0 : a.data < b.data ? 1 : -1));
    if (!doMes.length) {
      return h("div", { class: "cartao vazio" },
        h("div", { class: "vazio-ico", html: icone("teto", 30) }),
        h("h3", {}, "Nenhum gasto neste mês"),
        h("p", { class: "sub" }, "Lance os gastos imprevistos, como farmácia, lanche e conserto. Eles saem do teto."));
    }
    return h("article", { class: "cartao ct-secao" },
      h("header", { class: "ct-topo" }, h("h3", {}, "Gastos do mês"), h("span", { class: "ct-subtotal" }, reais(totalGastosDoMes(mesSel, gastos)))),
      h("ul", { class: "ct-lista" }, doMes.map((g) => h("li", {},
        h("button", { class: "ct-linha", type: "button", onclick: () => abrirGasto(g) },
          h("span", { class: "ct-ico", html: icone("teto", 20) }),
          h("span", { class: "ct-info" },
            h("span", { class: "ct-nome" }, g.descricao || "Gasto"),
            h("span", { class: "ct-sub" }, `${DIAS_SEMANA[diaDaSemana(g.data)]}, ${Number(g.data.slice(8))}`)),
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
    $("gt-data").value = g ? g.data : (mesSel === mesAtual() ? hojeIso() : `${mesSel}-01`);
    const botao = $("btn-excluir-gasto");
    botao.hidden = !g;
    $("folha-gasto").hidden = false;
    requestAnimationFrame(() => $("gt-valor").focus());
  }

  function salvar() {
    const valorCentavos = parseReais($("gt-valor").value);
    const data = $("gt-data").value;
    const descricao = $("gt-desc").value.trim();
    if (!(valorCentavos > 0)) return erro("Informe o valor, por exemplo 25,90.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erro("Escolha a data do gasto.");
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

  renderizar();

  return {
    receberMeses(m) { meses = m; pronto.meses = true; renderizar(); },
    receberGastos(l) { gastos = l; pronto.gastos = true; renderizar(); },
    limpar() { meses = {}; gastos = []; pronto.meses = pronto.gastos = false; mesSel = mesAtual(); fechar(); renderizar(); }
  };
}
