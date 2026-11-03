// Módulo de Dívidas: cadastro, cronograma por mês, visão por dívida e checks de parcela paga.
//
// Cada compra/parcelamento: { id, nome, grupo?, valorCentavos, totalParcelas, mesInicio: "AAAA-MM", pagas: [1, 2, ...] }
// A parcela k cai no mês (mesInicio + k - 1).
// Uma "dívida" (ex.: Cartão Carrefour) é o conjunto de compras com o mesmo grupo: o mês dela se paga de uma vez.
// Compra sem grupo é uma dívida de uma compra só.

import {
  $, h, reais, paraCampo, parseReais,
  mesAtual, somarMeses, diffMeses, nomeMes, mesCurto, NOMES_MESES
} from "./util.js";
import { icone } from "./icones.js";
import { montarEvolucao } from "./evolucao.js";
import { diasNoMes } from "./calendario.js";

let ctx = null;          // { obterBackend, obterCasaId, aviso, aoResumo }
let dividas = [];
let visao = "mes";       // "mes" | "divida" | "evolucao"
let evoSel = new Set();  // dívidas escolhidas no gráfico de evolução (vazio = todas)
let evoTemp = new Set(); // seleção em edição na folha
let evoAnimar = false;   // anima o gráfico só ao abrir a aba ou trocar o filtro
let mesSel = null;       // mês escolhido na visão "Por mês" ("AAAA-MM")
let editando = null;     // dívida aberta no formulário (null = nova)
let confirmandoExclusao = false;
const expandidos = new Set(); // dívidas abertas na lista do mês ("AAAA-MM|chave")

// ---------- Cálculos (funções puras, fáceis de testar) ----------
// Dia em que a parcela vence naquele mês (null se a dívida não tem dia). Dia 31 em fevereiro vira o último dia.
// Cada mês pode ter um dia próprio (d.vencimentos["AAAA-MM"]); sem ele, vale o dia padrão da dívida.
export function diaDaParcela(d, ym) {
  const proprio = d.vencimentos && Number(d.vencimentos[ym]);
  const dia = proprio >= 1 && proprio <= 31 ? proprio : Number(d.diaVencimento);
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

export const nomeGrupo = (d) => ((d.grupo || "").trim() || d.nome);
export const rotuloDivida = (d) => ((d.grupo || "").trim() ? `${d.grupo.trim()} · ${d.nome}` : d.nome);
const chaveGrupo = (d) => nomeGrupo(d).toLocaleLowerCase("pt-BR");
const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

// Junta as compras de mesmo grupo: [{ chave, nome, composta, itens: [compra, ...] }]
export function agruparDividas(lista) {
  const mapa = new Map();
  for (const d of lista) {
    const k = chaveGrupo(d);
    if (!mapa.has(k)) mapa.set(k, { chave: k, nome: nomeGrupo(d), itens: [] });
    mapa.get(k).itens.push(d);
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, itens: g.itens.sort(porNome), composta: g.itens.some((d) => (d.grupo || "").trim()) }))
    .sort(porNome);
}

// Um item por mês, do primeiro ao último mês com parcela, já com o que foi pago.
// Cada mês tem as dívidas (grupos) com parcela nele; a dívida está paga quando todas as parcelas do mês estão.
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
  const meses = [];
  for (let m = min; diffMeses(m, max) >= 0; m = somarMeses(m, 1)) {
    const grupos = [];
    for (const g of todos) {
      const itens = [];
      for (const d of g.itens) {
        const k = diffMeses(d.mesInicio, m) + 1;
        if (k >= 1 && k <= d.totalParcelas) itens.push({ d, k, paga: calculos.get(d.id).pagas.has(k), dia: diaDaParcela(d, m) });
      }
      if (!itens.length) continue;
      const dias = itens.map((i) => i.dia).filter((x) => x !== null);
      const feitas = itens.filter((i) => i.paga).length;
      grupos.push({
        chave: g.chave, nome: g.nome, composta: g.composta, itens,
        total: itens.reduce((s, i) => s + i.d.valorCentavos, 0),
        quitado: feitas === itens.length, parcial: feitas > 0 && feitas < itens.length,
        dia: dias.length ? Math.min(...dias) : null
      });
    }
    grupos.sort((a, b) => (a.dia ?? 99) - (b.dia ?? 99) || porNome(a, b));
    const itens = grupos.flatMap((g) => g.itens);
    meses.push({
      m, grupos, itens,
      total: itens.reduce((s, i) => s + i.d.valorCentavos, 0),
      abertos: grupos.filter((g) => !g.quitado).length
    });
  }
  return meses;
}

// ---------- Interface ----------
export function configurar(contexto) {
  ctx = contexto;

  // Anos do formulário: 3 para trás, 12 para frente.
  const ano = new Date().getFullYear();
  $("div-ano").replaceChildren(
    ...Array.from({ length: 16 }, (_, i) => h("option", { value: ano - 3 + i }, ano - 3 + i))
  );
  $("div-mes").replaceChildren(...NOMES_MESES.map((n, i) => h("option", { value: i + 1 }, n)));

  document.querySelectorAll("[data-visao]").forEach((b) =>
    b.addEventListener("click", () => {
      visao = b.dataset.visao;
      evoAnimar = true;
      renderizar();
    })
  );
  $("btn-nova-divida").addEventListener("click", () => abrirFolha(null));

  $("form-divida").addEventListener("submit", (e) => {
    e.preventDefault();
    salvar();
  });
  document.querySelectorAll("#folha [data-fechar]").forEach((b) => b.addEventListener("click", fecharFolha));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("folha").hidden) fecharFolha();
  });
  $("btn-excluir-divida").addEventListener("click", excluir);

  $("form-venc").addEventListener("submit", (e) => { e.preventDefault(); salvarVencimento(false); });
  $("btn-venc-padrao").addEventListener("click", () => salvarVencimento(true));
  document.querySelectorAll("#folha-venc [data-fechar]").forEach((b) => b.addEventListener("click", fecharVencimento));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("folha-venc").hidden) fecharVencimento(); });

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

// ----- Seletor de dívidas do gráfico (folha com busca e caixas de seleção) -----
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

export function receber(lista) {
  dividas = lista;
  $("div-grupos").replaceChildren(...agruparDividas(lista).filter((g) => g.composta).map((g) => h("option", { value: g.nome })));
  renderizar();
  ctx.aoResumo(calcularResumo(dividas));
}

export function irParaMes(ym) {
  visao = "mes";
  mesSel = ym;
  renderizar();
}

export function limpar() {
  receber([]);
}

function falha(e) {
  console.error(e);
  ctx.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore.");
}

function alternar(d, k, pago) {
  Promise.resolve(ctx.obterBackend().marcarParcela(ctx.obterCasaId(), d.id, k, pago)).catch(falha);
}

function renderizar() {
  document.querySelectorAll("[data-visao]").forEach((b) => {
    const ativo = b.dataset.visao === visao;
    b.classList.toggle("ativo", ativo);
    b.setAttribute("aria-selected", String(ativo));
  });
  renderizarResumo();
  const lista = $("div-lista");
  if (!dividas.length) {
    lista.replaceChildren(estadoVazio());
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
    lista.replaceChildren(...agruparDividas(dividas).map((g) => (g.composta ? cartaoGrupo(g) : cartaoDivida(g.itens[0]))));
  }
}

function renderizarResumo() {
  const caixa = $("div-resumo");
  if (!dividas.length) {
    caixa.replaceChildren();
    return;
  }
  const r = calcularResumo(dividas);
  const quitado = r.parcelasRestantes === 0;
  const meta = (rotulo, valor) =>
    h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
  caixa.replaceChildren(
    h("div", { class: "cartao resumo-div" },
      h("div", { class: "rd-rotulo" }, quitado ? "Tudo quitado" : "Falta pagar"),
      h("div", { class: "rd-valor" }, reais(r.restanteCentavos)),
      h("div", { class: "barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.quitadoPct), "aria-label": "Quanto já foi quitado" },
        h("span", { style: `width:${r.quitadoPct}%` })),
      h("div", { class: "rd-meta" },
        meta("Quitado", `${r.quitadoPct}%`),
        meta("Parcelas", quitado ? "nenhuma" : `${r.parcelasRestantes} restantes`),
        meta("Termina em", r.fim ? mesCurto(r.fim) : "—"))
    )
  );
}

function estadoVazio() {
  return h("div", { class: "cartao vazio" },
    h("div", { class: "vazio-ico", html: icone("dividas", 30) }),
    h("h3", {}, "Nenhuma dívida cadastrada"),
    h("p", { class: "sub" }, "Cadastre a primeira para ver o total que falta pagar e o mês em que tudo termina."),
    h("button", { class: "btn primario", type: "button", onclick: () => abrirFolha(null) }, "Cadastrar dívida")
  );
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
  if (n && m.abertos === 0) chip = h("span", { class: "chip ok" }, "Quitado");
  else if (n && m.m === hoje) chip = h("span", { class: "chip atual" }, "Este mês");
  else if (n && diffMeses(m.m, hoje) > 0) chip = h("span", { class: "chip atraso" }, "Em aberto");

  const faltam = m.grupos.filter((g) => !g.quitado).reduce((s, g) => s + g.itens.filter((i) => !i.paga).reduce((x, i) => x + i.d.valorCentavos, 0), 0);
  const quitado = n > 0 && m.abertos === 0;

  return h("article", { class: "mes" + (m.m === hoje ? " atual" : "") + (quitado ? " quitado" : "") },
    h("header", { class: "mes-topo" },
      h("div", {}, h("h3", {}, "Dívidas do mês"), chip),
      h("div", { class: "mes-total" }, reais(m.total),
        h("small", {}, `${n - m.abertos} de ${n} ${n === 1 ? "paga" : "pagas"}`))),
    n
      ? h("ul", { class: "parcelas" }, m.grupos.map((g) => linhaGrupo(g, m.m)))
      : h("p", { class: "sub mes-vazio" }, "Nenhuma parcela neste mês."),
    m.abertos > 0
      ? h("p", { class: "mes-falta" }, "Falta pagar neste mês: ", h("strong", {}, reais(faltam)))
      : null
  );
}

// Paga (ou desmarca) o mês inteiro de uma dívida: todas as compras dela naquele mês.
function marcarGrupoMes(g, pago) {
  for (const it of g.itens) if (it.paga !== pago) alternar(it.d, it.k, pago);
}

function linhaGrupo(g, ym) {
  if (!g.composta) return linhaParcela(g.itens[0], ym);
  const chave = `${ym}|${g.chave}`;
  const aberto = expandidos.has(chave);
  const sit = situacaoParcela(ym, g.dia, g.quitado);
  const nCompras = g.itens.length;
  return h("li", { class: "parcela grupo" + (g.quitado ? " paga" : "") },
    h("button", {
      type: "button",
      class: "chk" + (g.quitado ? " on" : "") + (g.parcial ? " parcial" : ""),
      role: "checkbox",
      "aria-checked": g.quitado ? "true" : g.parcial ? "mixed" : "false",
      "aria-label": `${g.nome}: marcar o mês inteiro como pago`,
      html: icone("check", 16),
      onclick: () => marcarGrupoMes(g, !g.quitado)
    }),
    h("div", { class: "p-info" },
      h("span", { class: "p-nome" }, g.nome),
      h("span", { class: "p-sub" },
        `${nCompras} ${nCompras === 1 ? "compra" : "compras"} · `,
        h("button", {
          type: "button", class: "p-venc" + (g.dia ? "" : " vazio"),
          "aria-label": `Vencimento de ${g.nome} em ${nomeMes(ym)}`,
          onclick: () => abrirVencimento(g.itens.map((i) => i.d), ym, g.dia ?? null, g.nome)
        }, g.dia ? `vence dia ${g.dia}` : "definir vencimento"),
        g.parcial ? h("span", { class: "chip atraso p-chip" }, "pago em parte") : null,
        sit ? h("span", { class: `chip ${sit.tom} p-chip` }, sit.texto) : null)),
    h("span", { class: "p-valor" }, reais(g.total)),
    h("button", {
      type: "button", class: "p-exp" + (aberto ? " aberto" : ""),
      "aria-expanded": String(aberto),
      "aria-label": `${aberto ? "Esconder" : "Ver"} as compras de ${g.nome}`,
      html: icone("dir", 16),
      onclick: () => { if (aberto) expandidos.delete(chave); else expandidos.add(chave); renderizar(); }
    }),
    aberto
      ? h("ul", { class: "p-itens" }, g.itens.map((i) => h("li", {},
          h("span", { class: "pi-nome" }, i.d.nome),
          h("span", { class: "pi-sub" }, `parcela ${i.k} de ${i.d.totalParcelas}`),
          h("span", { class: "pi-valor" }, reais(i.d.valorCentavos)))))
      : null
  );
}

// Situação da parcela em aberto: "vence hoje", "vence amanhã", "venceu dia 10" ou "atrasada".
function situacaoParcela(ym, dia, paga) {
  if (paga) return null;
  const hoje = mesAtual();
  if (diffMeses(ym, hoje) > 0) return { texto: "atrasada", tom: "atraso" };
  if (ym !== hoje || dia === null) return null;
  const hojeDia = new Date().getDate();
  if (dia < hojeDia) return { texto: `venceu dia ${dia}`, tom: "atraso" };
  if (dia === hojeDia) return { texto: "vence hoje", tom: "atual" };
  if (dia === hojeDia + 1) return { texto: "vence amanhã", tom: "atual" };
  return null;
}

function linhaParcela({ d, k, paga, dia }, ym) {
  const sit = situacaoParcela(ym, dia ?? null, paga);
  return h("li", { class: "parcela" + (paga ? " paga" : "") },
    h("button", {
      type: "button",
      class: "chk" + (paga ? " on" : ""),
      role: "checkbox",
      "aria-checked": String(paga),
      "aria-label": `${d.nome}, parcela ${k} de ${d.totalParcelas}`,
      html: icone("check", 16),
      onclick: () => alternar(d, k, !paga)
    }),
    h("div", { class: "p-info" },
      h("span", { class: "p-nome" }, d.nome),
      h("span", { class: "p-sub" },
        `Parcela ${k} de ${d.totalParcelas} · `,
        h("button", {
          type: "button", class: "p-venc" + (dia ? "" : " vazio"),
          "aria-label": `Vencimento de ${d.nome} em ${nomeMes(ym)}`,
          onclick: () => abrirVencimento([d], ym, dia ?? null, d.nome)
        }, dia ? `vence dia ${dia}` : "definir vencimento"),
        sit ? h("span", { class: `chip ${sit.tom} p-chip` }, sit.texto) : null)),
    h("span", { class: "p-valor" }, reais(d.valorCentavos))
  );
}

function cartaoDivida(d) {
  const c = calcularDivida(d);
  const pct = Math.round((c.pagasN / d.totalParcelas) * 100);
  return h("article", {
    class: "divida", tabindex: "0", role: "button",
    "aria-label": `Editar ${d.nome}`,
    onclick: () => abrirFolha(d),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirFolha(d); } }
  },
    h("div", { class: "dv-topo" },
      h("h3", {}, d.nome),
      h("span", { class: "dv-editar", html: icone("editar", 16) })),
    h("div", { class: "dv-valor" }, reais(d.valorCentavos), h("small", {}, ` × ${d.totalParcelas}` + (d.diaVencimento ? ` · vence dia ${d.diaVencimento}` : ""))),
    h("div", { class: "barra" }, h("span", { style: `width:${pct}%` })),
    h("div", { class: "dv-meta" },
      h("span", {}, `${c.pagasN} de ${d.totalParcelas} pagas`),
      h("span", {}, c.restantes > 0 ? `Falta ${reais(c.restanteCentavos)} · até ${mesCurto(c.fim)}` : "Quitada"))
  );
}

// Dívida com várias compras (ex.: Cartão Carrefour): total que falta, andamento e cada compra dentro.
function cartaoGrupo(g) {
  const cs = g.itens.map((d) => ({ d, c: calcularDivida(d) }));
  const restante = cs.reduce((s, x) => s + x.c.restanteCentavos, 0);
  const total = cs.reduce((s, x) => s + x.d.totalParcelas * x.d.valorCentavos, 0);
  const pct = total ? Math.round((1 - restante / total) * 100) : 0;
  const ativas = cs.filter((x) => x.c.restantes > 0);
  const fim = ativas.reduce((mx, x) => (mx === null || diffMeses(mx, x.c.fim) > 0 ? x.c.fim : mx), null);
  const n = g.itens.length;
  return h("article", { class: "divida grupo", style: "cursor:default" },
    h("div", { class: "dv-topo" },
      h("h3", {}, g.nome),
      h("span", { class: "chip atual" }, `${n} ${n === 1 ? "compra" : "compras"}`)),
    h("div", { class: "dv-valor" }, reais(restante), h("small", {}, restante > 0 ? " falta pagar" : " quitada")),
    h("div", { class: "barra" }, h("span", { style: `width:${pct}%` })),
    h("div", { class: "dv-meta" },
      h("span", {}, `${pct}% quitado`),
      h("span", {}, fim ? `termina em ${mesCurto(fim)}` : "Quitada")),
    h("ul", { class: "dv-itens" }, cs.map(({ d, c }) => h("li", {},
      h("button", { type: "button", class: "dv-item", "aria-label": `Editar ${d.nome}`, onclick: () => abrirFolha(d) },
        h("span", { class: "pi-nome" }, d.nome),
        h("span", { class: "pi-sub" }, `${reais(d.valorCentavos)} × ${d.totalParcelas} · ${c.pagasN} ${c.pagasN === 1 ? "paga" : "pagas"}` + (c.restantes ? ` · até ${mesCurto(c.fim)}` : " · quitada")),
        h("span", { class: "dv-editar", html: icone("editar", 16) }))))),
    h("button", { type: "button", class: "btn-sutil dv-add", onclick: () => abrirFolha(null, g.nome) }, "+ Adicionar compra a esta dívida"));
}

// ---------- Vencimento de uma dívida (pode variar de um mês para o outro) ----------
let vencAlvo = null; // { ds: [compras], ym }

function abrirVencimento(ds, ym, dia, titulo) {
  vencAlvo = { ds, ym };
  $("erro-venc").hidden = true;
  $("venc-titulo").textContent = `Vencimento · ${nomeMes(ym)}`;
  $("venc-quem").textContent = ds.length > 1 ? `${titulo} · vale para as ${ds.length} compras` : `${ds[0].nome} · parcela ${diffMeses(ds[0].mesInicio, ym) + 1} de ${ds[0].totalParcelas}`;
  $("venc-dia").value = dia ? String(dia) : "";
  $("venc-repetir").checked = false;
  const tem = ds.some((d) => d.vencimentos && d.vencimentos[ym]);
  $("btn-venc-padrao").hidden = !tem;
  $("btn-venc-padrao").textContent = ds.length === 1 && ds[0].diaVencimento ? `Voltar ao dia padrão (${ds[0].diaVencimento})` : "Voltar ao dia padrão";
  $("folha-venc").hidden = false;
  requestAnimationFrame(() => $("venc-dia").select());
}

function fecharVencimento() { $("folha-venc").hidden = true; vencAlvo = null; }

function salvarVencimento(voltarPadrao) {
  if (!vencAlvo) return;
  const { ds, ym } = vencAlvo;
  const texto = $("venc-dia").value.trim();
  const dia = voltarPadrao || texto === "" ? null : parseInt(texto, 10);
  if (dia !== null && !(dia >= 1 && dia <= 31)) {
    $("erro-venc").textContent = "Informe um dia entre 1 e 31.";
    $("erro-venc").hidden = false;
    return;
  }
  const repetir = $("venc-repetir").checked && !voltarPadrao;
  fecharVencimento();
  ctx.aviso(dia === null ? "Voltou ao dia padrão" : repetir ? "Vencimento salvo para este e os próximos meses" : "Vencimento salvo");
  for (const d of ds) {
    const mapa = { ...(d.vencimentos || {}) };
    const ultimo = somarMeses(d.mesInicio, d.totalParcelas - 1);
    for (let m = ym; diffMeses(m, ultimo) >= 0; m = somarMeses(m, 1)) {
      if (dia === null) delete mapa[m]; else mapa[m] = dia;
      if (!repetir) break;
    }
    Promise.resolve(ctx.obterBackend().salvarDivida(ctx.obterCasaId(), d.id, { vencimentos: mapa })).catch(falha);
  }
}

// ---------- Formulário (folha que sobe de baixo) ----------
function mostrarErroForm(msg) {
  const el = $("erro-divida");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function abrirFolha(d, grupoPre = "") {
  editando = d;
  confirmandoExclusao = false;
  mostrarErroForm("");
  $("folha-titulo").textContent = d ? "Editar compra" : grupoPre ? "Nova compra" : "Nova dívida";
  $("div-grupo").value = d ? (d.grupo || "") : grupoPre;
  $("div-nome").value = d ? d.nome : "";
  $("div-valor").value = d ? paraCampo(d.valorCentavos) : "";
  $("div-total").value = d ? String(d.totalParcelas) : "";
  const [a, m] = (d ? d.mesInicio : mesAtual()).split("-").map(Number);
  $("div-mes").value = String(m);
  $("div-ano").value = String(a);
  const qtdPagas = d ? calcularDivida(d).pagasN : 0;
  $("div-dia").value = d && d.diaVencimento ? String(d.diaVencimento) : "";
  $("div-pagas").value = d ? String(qtdPagas) : "";
  $("dica-pagas").textContent = d
    ? "Se mudar este número, as marcações atuais são substituídas: as primeiras parcelas, na ordem, ficam como pagas. Se não mexer, nada muda."
    : "Se algumas já foram pagas, informe aqui. As demais você marca no cronograma conforme for pagando.";
  const botao = $("btn-excluir-divida");
  botao.hidden = !d;
  botao.textContent = "Excluir";
  botao.classList.remove("confirmar");
  $("folha").hidden = false;
  requestAnimationFrame(() => $("div-nome").focus());
}

function fecharFolha() {
  $("folha").hidden = true;
  editando = null;
}

function salvar() {
  const nome = $("div-nome").value.trim();
  const grupo = $("div-grupo").value.trim() || null;
  const valorCentavos = parseReais($("div-valor").value);
  const totalParcelas = parseInt($("div-total").value, 10);
  const mesInicio = `${$("div-ano").value}-${String($("div-mes").value).padStart(2, "0")}`;
  const jaPagas = parseInt($("div-pagas").value || "0", 10);
  const diaTexto = $("div-dia").value.trim();
  const diaVencimento = diaTexto === "" ? null : parseInt(diaTexto, 10);

  if (!nome) return mostrarErroForm("Diga o que é, por exemplo Celular ou Empréstimo.");
  if (!(valorCentavos > 0)) return mostrarErroForm("Informe o valor da parcela, por exemplo 289,90.");
  if (!(totalParcelas >= 1 && totalParcelas <= 600)) return mostrarErroForm("Informe o número de parcelas (de 1 a 600).");
  if (!(jaPagas >= 0 && jaPagas <= totalParcelas)) return mostrarErroForm("As parcelas já pagas não podem passar do total.");

  if (diaVencimento !== null && !(diaVencimento >= 1 && diaVencimento <= 31)) return mostrarErroForm("O dia do vencimento deve ficar entre 1 e 31, ou em branco.");

  const dados = { nome, grupo, valorCentavos, totalParcelas, mesInicio, diaVencimento };
  if (editando) {
    const atuais = (editando.pagas || []).filter((n) => n <= totalParcelas);
    if (jaPagas !== calcularDivida(editando).pagasN) {
      // O número foi alterado: as primeiras N parcelas passam a ser as pagas.
      dados.pagas = Array.from({ length: jaPagas }, (_, i) => i + 1);
    } else if (atuais.length !== (editando.pagas || []).length) {
      // Só o novo total deixou parcelas de fora.
      dados.pagas = atuais;
    }
  } else {
    dados.pagas = Array.from({ length: jaPagas }, (_, i) => i + 1);
  }

  const id = editando ? editando.id : null;
  Promise.resolve(ctx.obterBackend().salvarDivida(ctx.obterCasaId(), id, dados)).catch(falha);
  fecharFolha();
  ctx.aviso(id ? "Atualizado" : "Dívida cadastrada");
}

function excluir() {
  if (!editando) return;
  const botao = $("btn-excluir-divida");
  if (!confirmandoExclusao) {
    confirmandoExclusao = true;
    botao.textContent = "Confirmar exclusão";
    botao.classList.add("confirmar");
    return;
  }
  const id = editando.id;
  Promise.resolve(ctx.obterBackend().excluirDivida(ctx.obterCasaId(), id)).catch(falha);
  fecharFolha();
  ctx.aviso("Dívida excluída");
}
