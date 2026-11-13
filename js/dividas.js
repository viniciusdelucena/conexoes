// Aba Dívidas: só leitura. Mostra o andamento das parcelas que estão dentro das contas parceladas (cartão, empréstimo...).
//
// Ninguém cadastra nem marca nada aqui. O cadastro e o "paguei" ficam em Contas; esta aba lê as contas e os pagamentos
// e mostra se o que falta pagar está caindo. Cada parcela vira uma "dívida" (veja derivarDividas em periodos.js):
//   { id, contaId, nome, grupo, valorCentavos, totalParcelas, mesInicio: "AAAA-MM", diaVencimento, pagas: [1, 2, ...] }
// A parcela k cai no mês (mesInicio + k - 1).

import { estadoVazio } from "./vazio.js";
import { $, h, reais, animarValor, animarLargura, mesAtual, somarMeses, diffMeses, nomeMes, mesCurto } from "./util.js";
import { icone } from "./icones.js";
import { montarEvolucao, saldoPorMes } from "./evolucao.js";
import { diasNoMes } from "./calendario.js";
import { listaPeriodos, derivarDividas } from "./periodos.js";

let ctx = null;          // { aoResumo, abrirConta(idDaConta), irParaContas() }
let contas = [];
let meses = {};
let dividas = [];
let visao = "mes";       // "mes" | "divida" | "evolucao"
let evoSel = new Set();  // parcelas escolhidas no gráfico de evolução (vazio = todas)
let evoTemp = new Set(); // seleção em edição na folha
let evoAnimar = false;   // anima o gráfico só ao abrir a aba ou trocar o filtro
let mesSel = null;       // mês escolhido na visão "Por mês" ("AAAA-MM")
const expandidos = new Set(); // contas abertas na lista do mês ("AAAA-MM|idDaConta")

// ---------- Cálculos (funções puras, fáceis de testar) ----------
// Dia em que a parcela vence naquele mês (null se a conta não tem dia). Dia 31 em fevereiro vira o último dia.
export function diaDaParcela(d, ym) {
  const dia = Number(d.diaVencimento);
  if (!(dia >= 1 && dia <= 31)) return null;
  return Math.min(dia, diasNoMes(ym));
}

export function calcularDivida(d) {
  const pagas = new Set((d.pagas || []).filter((n) => n >= 1 && n <= d.totalParcelas));
  const restantes = d.totalParcelas - pagas.size;
  return {
    pagas,
    pagasN: pagas.size,
    restantes,
    restanteCentavos: restantes * d.valorCentavos,
    fim: somarMeses(d.mesInicio, d.totalParcelas - 1)
  };
}

export function calcularResumo(lista) {
  let restanteCentavos = 0, totalCentavos = 0, parcelasRestantes = 0, fim = null;
  for (const d of lista) {
    const c = calcularDivida(d);
    restanteCentavos += c.restanteCentavos;
    totalCentavos += d.totalParcelas * d.valorCentavos;
    parcelasRestantes += c.restantes;
    if (c.restantes > 0 && (fim === null || diffMeses(fim, c.fim) > 0)) fim = c.fim;
  }
  const quitadoPct = totalCentavos ? Math.round((1 - restanteCentavos / totalCentavos) * 100) : 0;
  return { quantidade: lista.length, restanteCentavos, totalCentavos, parcelasRestantes, fim, quitadoPct };
}

export const rotuloDivida = (d) => (d.grupo ? `${d.grupo} · ${d.nome}` : d.nome);
const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

// Junta as parcelas de uma mesma conta: [{ chave, contaId, nome, composta, itens: [parcela, ...] }]
export function agruparDividas(lista) {
  const mapa = new Map();
  for (const d of lista) {
    if (!mapa.has(d.contaId)) mapa.set(d.contaId, { chave: d.contaId, contaId: d.contaId, nome: d.grupo || d.nome, composta: !!d.grupo, itens: [] });
    mapa.get(d.contaId).itens.push(d);
  }
  return [...mapa.values()].map((g) => ({ ...g, itens: g.itens.sort(porNome) })).sort(porNome);
}

// Um item por mês, do primeiro ao último mês com parcela, já com o que foi pago.
// Cada mês tem as contas com parcela nele; a conta está paga quando todas as parcelas do mês estão.
export function montarMeses(lista) {
  if (!lista.length) return [];
  let min = lista[0].mesInicio;
  let max = somarMeses(lista[0].mesInicio, lista[0].totalParcelas - 1);
  for (const d of lista) {
    const fim = somarMeses(d.mesInicio, d.totalParcelas - 1);
    if (diffMeses(d.mesInicio, min) > 0) min = d.mesInicio;
    if (diffMeses(max, fim) > 0) max = fim;
  }
  const calculos = new Map(lista.map((d) => [d.id, calcularDivida(d)]));
  const todos = agruparDividas(lista);
  const saida = [];
  for (let m = min; diffMeses(m, max) >= 0; m = somarMeses(m, 1)) {
    const grupos = [];
    for (const g of todos) {
      const itens = [];
      for (const d of g.itens) {
        const k = diffMeses(d.mesInicio, m) + 1;
        if (k >= 1 && k <= d.totalParcelas) itens.push({ d, k, paga: calculos.get(d.id).pagas.has(k), dia: diaDaParcela(d, m) });
      }
      if (!itens.length) continue;
      const feitas = itens.filter((i) => i.paga).length;
      grupos.push({
        chave: g.chave, contaId: g.contaId, nome: g.nome, composta: g.composta, itens,
        total: itens.reduce((s, i) => s + i.d.valorCentavos, 0),
        quitado: feitas === itens.length, parcial: feitas > 0 && feitas < itens.length,
        dia: itens[0].dia
      });
    }
    grupos.sort((a, b) => (a.dia ?? 99) - (b.dia ?? 99) || porNome(a, b));
    const itens = grupos.flatMap((g) => g.itens);
    saida.push({
      m, grupos, itens,
      total: itens.reduce((s, i) => s + i.d.valorCentavos, 0),
      abertos: grupos.filter((g) => !g.quitado).length
    });
  }
  return saida;
}

// Para onde vai o total das parcelas: compara este mês com o seguinte.
export function tendenciaDasParcelas(lista, hoje = mesAtual()) {
  const todos = montarMeses(lista);
  const total = (m) => (todos.find((x) => x.m === m) || { total: 0 }).total;
  const agora = total(hoje), depois = total(somarMeses(hoje, 1));
  if (!agora && !depois) return null;
  return { agora, depois, dif: depois - agora };
}

// ---------- Interface ----------
export function configurar(contexto) {
  ctx = contexto;
  document.querySelectorAll("[data-visao]").forEach((b) =>
    b.addEventListener("click", () => {
      visao = b.dataset.visao;
      evoAnimar = true;
      renderizar();
    })
  );
  $("evo-busca").addEventListener("input", desenharListaEvo);
  $("evo-alternar-todas").addEventListener("click", () => {
    evoTemp = evoTemp.size === dividas.length ? new Set() : new Set(dividas.map((d) => d.id));
    desenharListaEvo();
    atualizarContagemEvo();
  });
  $("evo-aplicar").addEventListener("click", () => {
    evoSel = evoTemp.size === dividas.length ? new Set() : new Set(evoTemp);
    fecharSeletorEvo();
    evoAnimar = true;
    renderizar();
  });
  document.querySelectorAll("#folha-evo [data-fechar]").forEach((b) => b.addEventListener("click", fecharSeletorEvo));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("folha-evo").hidden) fecharSeletorEvo(); });
}

// ----- Seletor de parcelas do gráfico (folha com busca e caixas de seleção) -----
function desenharListaEvo() {
  const termo = $("evo-busca").value.trim().toLowerCase();
  const ordenadas = [...dividas].sort((a, b) => rotuloDivida(a).localeCompare(rotuloDivida(b), "pt-BR"));
  const visiveis = ordenadas.filter((d) => rotuloDivida(d).toLowerCase().includes(termo));
  $("evo-lista").replaceChildren(...(visiveis.length ? visiveis.map((d) => {
    const c = calcularDivida(d);
    return h("li", {}, h("label", { class: "evo-opcao" },
      h("input", {
        type: "checkbox", checked: evoTemp.has(d.id),
        onchange: (e) => { if (e.target.checked) evoTemp.add(d.id); else evoTemp.delete(d.id); atualizarContagemEvo(); }
      }),
      h("span", { class: "evo-opcao-txt" },
        h("strong", {}, rotuloDivida(d)),
        h("small", {}, `${reais(d.valorCentavos)} × ${d.totalParcelas} · ${c.restantes ? `termina em ${mesCurto(c.fim)}` : "quitada"}`))));
  }) : [h("li", { class: "evo-vazio" }, "Nenhuma dívida com esse nome.")]));
}

function atualizarContagemEvo() {
  const n = evoTemp.size, total = dividas.length;
  $("evo-contagem").textContent = n === 0 ? "Nenhuma marcada: mostra todas" : `${n} de ${total} marcadas`;
  $("evo-alternar-todas").textContent = n === total ? "Limpar" : "Marcar todas";
}

function abrirSeletorEvo() {
  evoTemp = new Set(evoSel);
  $("evo-busca").value = "";
  desenharListaEvo();
  atualizarContagemEvo();
  $("folha-evo").hidden = false;
}

function fecharSeletorEvo() { $("folha-evo").hidden = true; }

// As dívidas dependem das contas e dos períodos (onde ficam os pagamentos): recalcula quando qualquer um muda.
function recalcular() {
  dividas = derivarDividas(contas, listaPeriodos(meses));
  renderizar();
  ctx.aoResumo({ ...calcularResumo(dividas), serie: saldoPorMes(dividas) });
}

export function receberContas(lista) { contas = lista || []; recalcular(); }
export function receberMeses(mapa) { meses = mapa || {}; recalcular(); }
export function limpar() { contas = []; meses = {}; recalcular(); }

function renderizar() {
  document.querySelectorAll("[data-visao]").forEach((b) => {
    const ativo = b.dataset.visao === visao;
    b.classList.toggle("ativo", ativo);
    b.setAttribute("aria-selected", String(ativo));
  });
  renderizarResumo();
  const lista = $("div-lista");
  if (!dividas.length) {
    lista.replaceChildren(estadoVazioDividas());
  } else if (visao === "evolucao") {
    evoSel = new Set([...evoSel].filter((id) => dividas.some((d) => d.id === id)));
    const animar = evoAnimar;
    evoAnimar = false;
    const filtradas = evoSel.size ? dividas.filter((d) => evoSel.has(d.id)) : dividas;
    lista.replaceChildren(montarEvolucao(filtradas, {
      filtro: dividas.length > 1 ? {
        filtrado: evoSel.size > 0 && evoSel.size < dividas.length,
        texto: evoSel.size === 0 || evoSel.size === dividas.length
          ? `Todas as dívidas (${dividas.length})`
          : evoSel.size === 1 ? rotuloDivida(filtradas[0]) : `${evoSel.size} de ${dividas.length} dívidas`,
        aoAbrir: abrirSeletorEvo
      } : null,
      animar
    }));
  } else if (visao === "mes") {
    lista.replaceChildren(...listaMeses());
  } else {
    lista.replaceChildren(...agruparDividas(dividas).map(cartaoConta));
  }
}

function renderizarResumo() {
  const caixa = $("div-resumo");
  if (!dividas.length) {
    caixa.replaceChildren();
    return;
  }
  const r = calcularResumo(dividas);
  const t = tendenciaDasParcelas(dividas);
  const quitado = r.parcelasRestantes === 0;
  const meta = (rotulo, valor) =>
    h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
  let tend = null;
  if (t && !quitado) {
    const texto = t.dif < 0 ? `As parcelas caem ${reais(-t.dif)} no mês que vem`
      : t.dif > 0 ? `As parcelas sobem ${reais(t.dif)} no mês que vem`
      : "As parcelas ficam iguais no mês que vem";
    tend = h("div", { class: "rd-tend " + (t.dif < 0 ? "cai" : t.dif > 0 ? "sobe" : "igual") },
      h("span", {}, (t.dif < 0 ? "↓ " : t.dif > 0 ? "↑ " : "→ ") + texto),
      h("small", {}, `${reais(t.agora)} este mês · ${reais(t.depois)} no próximo`));
  }
  const valorHero = h("div", { class: "rd-valor" });
  animarValor(valorHero, "dividas-hero", r.restanteCentavos);
  const barraHero = h("span", {});
  animarLargura(barraHero, "dividas-hero", r.quitadoPct);
  caixa.replaceChildren(
    h("div", { class: "cartao resumo-div" },
      h("div", { class: "rd-rotulo" }, quitado ? "Tudo quitado" : "Falta pagar"),
      valorHero,
      h("div", { class: "barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.quitadoPct), "aria-label": "Quanto já foi quitado" },
        barraHero),
      h("div", { class: "rd-meta" },
        meta("Quitado", `${r.quitadoPct}%`),
        meta("Parcelas", quitado ? "nenhuma" : `${r.parcelasRestantes} restantes`),
        meta("Termina em", r.fim ? mesCurto(r.fim) : "—")),
      tend
    )
  );
}

function estadoVazioDividas() {
  // Dívidas nascem das contas parceladas: aqui não há botão de cadastrar, só o caminho até Contas.
  return estadoVazio({
    ilustracao: "dividas",
    titulo: "Nenhuma dívida por aqui ainda",
    texto: "Elas aparecem sozinhas quando você cria uma conta parcelada, como cartão, empréstimo ou financiamento.",
    passos: ["Abra Contas", "Crie uma conta do tipo Parcelada", "Acompanhe as parcelas aqui"],
    botao: { texto: "Ir para Contas", aoClicar: () => ctx.irParaContas() }
  });
}

function listaMeses() {
  const hoje = mesAtual();
  const todos = montarMeses(dividas);
  if (!todos.length) return [];
  const primeiro = todos[0].m;
  const ultimo = todos[todos.length - 1].m;

  // O mês escolhido começa no atual e sempre fica dentro do período em que há parcelas.
  if (!mesSel) mesSel = hoje;
  if (diffMeses(primeiro, mesSel) < 0) mesSel = primeiro;
  if (diffMeses(mesSel, ultimo) < 0) mesSel = ultimo;

  const ir = (n) => () => { mesSel = somarMeses(mesSel, n); renderizar(); };
  const opcoes = todos.map((x) => h("option", { value: x.m, selected: x.m === mesSel }, nomeMes(x.m)));

  const nos = [
    h("div", { class: "mes-nav" },
      h("button", {
        class: "mes-seta", type: "button", "aria-label": "Mês anterior",
        disabled: mesSel === primeiro, onclick: ir(-1), html: icone("esq", 20)
      }),
      h("label", { class: "mes-escolha" },
        h("span", { class: "mes-nome" }, nomeMes(mesSel)),
        h("span", { class: "mes-dica" }, mesSel === hoje ? "Este mês" : "Toque para escolher o mês"),
        h("select", {
          class: "mes-select", "aria-label": "Escolher o mês",
          onchange: (e) => { mesSel = e.target.value; renderizar(); }
        }, opcoes)),
      h("button", {
        class: "mes-seta", type: "button", "aria-label": "Próximo mês",
        disabled: mesSel === ultimo, onclick: ir(1), html: icone("dir", 20)
      }))
  ];

  const hojeNoPeriodo = diffMeses(primeiro, hoje) >= 0 && diffMeses(hoje, ultimo) >= 0;
  if (mesSel !== hoje && hojeNoPeriodo) {
    nos.push(h("button", {
      class: "btn-sutil", type: "button",
      onclick: () => { mesSel = hoje; renderizar(); }
    }, "Voltar para este mês"));
  }

  nos.push(cartaoMes(todos.find((x) => x.m === mesSel), hoje));
  return nos;
}

function cartaoMes(m, hoje) {
  const n = m.grupos.length;
  let chip = null;
  if (n && m.abertos === 0) chip = h("span", { class: "chip ok" }, "Tudo pago");
  else if (n && m.m === hoje) chip = h("span", { class: "chip atual" }, "Este mês");
  else if (n && diffMeses(m.m, hoje) > 0) chip = h("span", { class: "chip atraso" }, "Em aberto");

  const faltam = m.itens.filter((i) => !i.paga).reduce((s, i) => s + i.d.valorCentavos, 0);
  return h("article", { class: "mes" + (m.m === hoje ? " atual" : "") + (n > 0 && m.abertos === 0 ? " quitado" : "") },
    h("header", { class: "mes-topo" },
      h("div", {}, h("h3", {}, "Parcelas do mês"), chip),
      h("div", { class: "mes-total" }, reais(m.total),
        h("small", {}, `${n - m.abertos} de ${n} ${n === 1 ? "conta paga" : "contas pagas"}`))),
    n
      ? h("ul", { class: "parcelas" }, m.grupos.map((g) => linhaConta(g, m.m)))
      : h("p", { class: "sub mes-vazio" }, "Nenhuma parcela neste mês."),
    h("p", { class: "mes-falta" },
      m.abertos > 0 ? ["Falta pagar neste mês: ", h("strong", {}, reais(faltam))] : "Nada pendente neste mês.",
      h("button", { class: "link-ir", type: "button", onclick: () => ctx.irParaContas() }, "Marcar em Contas"))
  );
}

// Situação da parcela do mês: só vale a pena avisar do mês atual e dos passados.
function situacao(ym, dia, paga) {
  if (paga) return { tom: "ok", texto: "Paga" };
  const hoje = mesAtual();
  if (diffMeses(ym, hoje) > 0) return { tom: "atraso", texto: "Em aberto" };
  if (ym === hoje && dia) {
    const d = new Date().getDate();
    if (dia < d) return { tom: "atraso", texto: `Venceu dia ${dia}` };
    if (dia === d) return { tom: "atencao", texto: "Vence hoje" };
  }
  return null;
}

// Uma conta no mês: nome, parcelas, valor e se já foi paga (só mostra, não marca).
function linhaConta(g, ym) {
  const sit = situacao(ym, g.dia, g.quitado);
  const chave = `${ym}|${g.chave}`;
  const aberto = expandidos.has(chave);
  const nomes = g.itens.map((i) => `${g.composta ? i.d.nome + " " : ""}${i.k}/${i.d.totalParcelas}`).join(" · ");
  return h("li", { class: "parcela somente" + (g.quitado ? " paga" : "") + (g.composta ? " grupo" : "") },
    h("span", { class: "p-marca" + (g.quitado ? " on" : ""), "aria-hidden": "true", html: g.quitado ? icone("check", 14) : "" }),
    h("div", { class: "p-info" },
      h("span", { class: "p-nome" }, g.nome),
      h("span", { class: "p-sub" },
        `${nomes}${g.dia ? ` · vence dia ${g.dia}` : ""}`,
        g.parcial ? h("span", { class: "chip atencao p-chip" }, "pago em parte") : null,
        sit ? h("span", { class: `chip ${sit.tom} p-chip` }, sit.texto) : null)),
    h("span", { class: "p-valor" }, reais(g.total)),
    g.composta
      ? h("button", {
        type: "button", class: "p-exp" + (aberto ? " aberto" : ""), "aria-expanded": String(aberto),
        "aria-label": `${aberto ? "Esconder" : "Ver"} as parcelas de ${g.nome}`, html: icone("dir", 16),
        onclick: () => { if (aberto) expandidos.delete(chave); else expandidos.add(chave); renderizar(); }
      })
      : null,
    aberto
      ? h("ul", { class: "p-itens" }, g.itens.map((i) => h("li", {},
          h("span", { class: "pi-nome" }, i.d.nome),
          h("span", { class: "pi-sub" }, `parcela ${i.k} de ${i.d.totalParcelas}`),
          h("span", { class: "pi-valor" }, reais(i.d.valorCentavos)))))
      : null
  );
}

// "Por dívida": uma conta com suas parcelas, quanto falta e quando termina.
function cartaoConta(g) {
  const cs = g.itens.map((d) => ({ d, c: calcularDivida(d) }));
  const restante = cs.reduce((s, x) => s + x.c.restanteCentavos, 0);
  const total = cs.reduce((s, x) => s + x.d.totalParcelas * x.d.valorCentavos, 0);
  const pct = total ? Math.round((1 - restante / total) * 100) : 0;
  const ativas = cs.filter((x) => x.c.restantes > 0);
  const fim = ativas.reduce((mx, x) => (mx === null || diffMeses(mx, x.c.fim) > 0 ? x.c.fim : mx), null);
  const n = g.itens.length;
  const unica = cs[0];
  return h("article", { class: "divida grupo", style: "cursor:default" },
    h("div", { class: "dv-topo" },
      h("h3", {}, g.nome),
      g.composta ? h("span", { class: "chip atual" }, `${n} parcelas`) : null),
    h("div", { class: "dv-valor" }, reais(restante), h("small", {}, restante > 0 ? " falta pagar" : " quitada")),
    h("div", { class: "barra" }, h("span", { style: `width:${pct}%` })),
    h("div", { class: "dv-meta" },
      h("span", {}, `${pct}% quitado`),
      h("span", {}, fim ? `termina em ${mesCurto(fim)}` : "Quitada")),
    g.composta
      ? h("ul", { class: "dv-itens" }, cs.map(({ d, c }) => h("li", { class: "dv-item" },
          h("span", { class: "pi-nome" }, d.nome),
          h("span", { class: "pi-sub" }, `${reais(d.valorCentavos)} × ${d.totalParcelas} · ${c.pagasN} ${c.pagasN === 1 ? "paga" : "pagas"}` + (c.restantes ? ` · até ${mesCurto(c.fim)}` : " · quitada")))))
      : h("p", { class: "sub dv-uma" }, `${reais(unica.d.valorCentavos)} × ${unica.d.totalParcelas} · ${unica.c.pagasN} ${unica.c.pagasN === 1 ? "paga" : "pagas"}`),
    h("button", { type: "button", class: "btn-sutil dv-add", onclick: () => ctx.abrirConta(g.contaId) }, "Editar em Contas"));
}
