// Períodos: Contas e Teto de gastos funcionam por período, não por mês do calendário.
//
// Período: { id, inicio: "AAAA-MM-DD", fim: "AAAA-MM-DD", valores: { [idDaConta]: centavos }, pagas: { [idDaConta]: true }, teto: centavos | null }
//   - o período é criado na mão (ex.: 20/10 a 19/11) e fica guardado em households/{casa}/months/{id};
//   - documentos antigos "AAAA-MM" (sem inicio/fim) valem como o mês inteiro do calendário;
//   - valores: valor real de uma conta variável (ou reajuste) só neste período;
//   - pagas: contas que já foram pagas neste período (o checklist da tela Contas);
//   - teto: vale para este período e para os seguintes, até alguém mudar de novo.
// Conta: { id, nome, tipo: "fixa" | "variavel" | "parcelada", valorCentavos, inicio: "AAAA-MM", fim: "AAAA-MM" | null, dia: 1..31 | null }
//   - a conta entra no período em que o dia dela cai (sem dia, entra no começo do período);
//   - conta "parcelada" (cartão, empréstimo...) guarda parcelas: [{ id, nome, valorCentavos, total, mesInicio: "AAAA-MM", pagasAntes }].
//     O valor dela no período é a soma das parcelas que vencem naquele mês. Marcar a conta como paga num período
//     paga as parcelas daquele mês. É daí que a aba Dívidas tira o andamento (derivarDividas).

import { h, somarMeses, diffMeses } from "./util.js";
import { icone } from "./icones.js";
import { diasNoMes, diaDaSemana, diasUteisEntre } from "./calendario.js";

export const TETO_PADRAO_CENTAVOS = 50000;

const dois = (n) => String(n).padStart(2, "0");

// ---------- Datas "AAAA-MM-DD" ----------
export const paraIso = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
export const hojeIso = () => paraIso(new Date());
const utc = (iso) => { const [a, m, d] = iso.split("-").map(Number); return Date.UTC(a, m - 1, d); };

export function somarDias(iso, n) {
  const t = new Date(utc(iso) + n * 86400000);
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

export const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

// Mesmo dia no mês seguinte (31/01 + 1 mês = 28/02 ou 29/02).
export function somarMesesData(iso, n) {
  const ym = somarMeses(iso.slice(0, 7), n);
  return `${ym}-${dois(Math.min(Number(iso.slice(8)), diasNoMes(ym)))}`;
}

// Meses "AAAA-MM" que o intervalo toca.
export function mesesEntre(inicio, fim) {
  const lista = [];
  for (let ym = inicio.slice(0, 7); ym <= fim.slice(0, 7); ym = somarMeses(ym, 1)) lista.push(ym);
  return lista;
}

const dm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
export const dataCurta = dm;

// "20/10 a 19/11" (com o ano quando não é o ano atual ou quando cruza o ano).
export function rotuloPeriodo(p) {
  const ano = String(new Date().getFullYear());
  const comAno = p.inicio.slice(0, 4) !== ano || p.fim.slice(0, 4) !== ano;
  const f = (iso) => (comAno ? `${dm(iso)}/${iso.slice(2, 4)}` : dm(iso));
  return `${f(p.inicio)} a ${f(p.fim)}`;
}
export const rotuloCurto = (p) => dm(p.inicio);

// ---------- Lista de períodos ----------
export function listaPeriodos(meses) {
  const lista = [];
  for (const [id, d] of Object.entries(meses || {})) {
    if (!d) continue;
    let inicio = d.inicio, fim = d.fim;
    if (!inicio && /^\d{4}-\d{2}$/.test(id)) { inicio = `${id}-01`; fim = `${id}-${dois(diasNoMes(id))}`; }
    if (!inicio || !fim) continue;
    lista.push({ id, inicio, fim, valores: d.valores || {}, pagas: d.pagas || {}, teto: Number.isFinite(d.teto) ? d.teto : null, legado: !d.inicio });
  }
  return lista.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
}

export const periodoContem = (p, data) => data >= p.inicio && data <= p.fim;
export const periodoDeHoje = (lista, hoje = hojeIso()) => lista.find((p) => periodoContem(p, hoje)) || null;

// Período logo depois deste (sugestão para criar o próximo): mesmo tamanho de "um mês".
export function periodoSeguinte(p) {
  const inicio = somarDias(p.fim, 1);
  return { inicio, fim: somarDias(somarMesesData(inicio, 1), -1) };
}

// Escolha atual, compartilhada por Contas e Teto de gastos.
export const selecao = { id: null };
export function resolverSelecionado(lista, hoje = hojeIso()) {
  let p = lista.find((x) => x.id === selecao.id);
  if (!p) {
    p = periodoDeHoje(lista, hoje) || lista.find((x) => x.fim >= hoje) || lista[lista.length - 1] || null;
    selecao.id = p ? p.id : null;
  }
  return p;
}

// ---------- Cálculos (funções puras) ----------
export function tetoDoPeriodo(p, lista) {
  if (Number.isFinite(p.teto)) return p.teto;
  let achado = null;
  for (const q of lista || []) {
    if (Number.isFinite(q.teto) && q.inicio < p.inicio && (!achado || q.inicio > achado.inicio)) achado = q;
  }
  return achado ? achado.teto : TETO_PADRAO_CENTAVOS;
}

export const gastosDoPeriodo = (p, gastos) => (gastos || []).filter((g) => g.data && periodoContem(p, g.data));
export const totalGastosDoPeriodo = (p, gastos) => gastosDoPeriodo(p, gastos).reduce((s, g) => s + g.valorCentavos, 0);

// Data em que a conta cai neste período (null se ela não entra nele).
export function dataDaConta(c, p) {
  const dia = Number(c.dia);
  const temDia = dia >= 1 && dia <= 31;
  const parcelada = c.tipo === "parcelada";
  for (const ym of mesesEntre(p.inicio, p.fim)) {
    const data = temDia ? `${ym}-${dois(Math.min(dia, diasNoMes(ym)))}` : p.inicio;
    const dentroDaVigencia = parcelada || (c.inicio <= data.slice(0, 7) && (!c.fim || data.slice(0, 7) <= c.fim));
    if (periodoContem(p, data) && dentroDaVigencia) return data;
    if (!temDia) break;
  }
  return null;
}

// Parcelas de uma conta parcelada que vencem no mês ym: [{ it, k }]
export function parcelasDoMes(c, ym) {
  const lista = [];
  for (const it of c.parcelas || []) {
    const k = diffMeses(it.mesInicio, ym) + 1;
    if (k >= 1 && k <= it.total) lista.push({ it, k });
  }
  return lista;
}

export function contasDoPeriodo(p, contas) {
  const valores = p.valores || {};
  const pagas = p.pagas || {};
  const itens = [];
  for (const c of contas || []) {
    const data = dataDaConta(c, p);
    if (!data) continue;
    const paga = pagas[c.id] === true;
    if (c.tipo === "parcelada") {
      const parcelas = parcelasDoMes(c, data.slice(0, 7));
      if (!parcelas.length) continue;
      // Se todas as parcelas do mês já estavam pagas quando a conta foi cadastrada, a conta já nasce paga.
      const antiga = parcelas.every((x) => x.k <= (x.it.pagasAntes || 0));
      itens.push({ conta: c, data, parcelas, valor: parcelas.reduce((s, x) => s + x.it.valorCentavos, 0), alterada: false, estimada: false, paga: paga || antiga, automatica: antiga });
      continue;
    }
    const alterada = Number.isFinite(valores[c.id]);
    itens.push({ conta: c, data, valor: alterada ? valores[c.id] : c.valorCentavos, alterada, estimada: c.tipo === "variavel" && !alterada, paga });
  }
  return itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.conta.nome.localeCompare(b.conta.nome, "pt-BR")));
}

export function calcularPeriodo(p, { contas, periodos, gastos = [], feriados = [] }) {
  const itens = contasDoPeriodo(p, contas);
  const somar = (tipo) => itens.filter((i) => i.conta.tipo === tipo).reduce((s, i) => s + i.valor, 0);
  const fixas = somar("fixa");
  const variaveis = somar("variavel");
  const parceladas = somar("parcelada");
  const teto = tetoDoPeriodo(p, periodos);
  const gastoTeto = totalGastosDoPeriodo(p, gastos);
  const total = fixas + variaveis + parceladas + teto;
  const dias = diasUteisEntre(p.inicio, p.fim, feriados);
  const contasTotal = fixas + variaveis + parceladas;
  const pago = itens.filter((i) => i.paga).reduce((s, i) => s + i.valor, 0);
  return {
    p, itens, fixas, variaveis, parceladas, teto, gastoTeto, total,
    totalReal: total - teto + gastoTeto,
    contasTotal, pago, faltaPagar: contasTotal - pago,
    qtdContas: itens.length, qtdPagas: itens.filter((i) => i.paga).length,
    pagoPct: contasTotal > 0 ? Math.round((pago / contasTotal) * 100) : 0,
    dias,
    feriados: feriados.filter((d) => diaDaSemana(d) !== 0).length,
    porDia: dias ? Math.round(total / dias) : 0
  };
}

// ---------- Dívidas: derivadas das contas parceladas ----------
// Cada parcela de uma conta parcelada vira uma "dívida" para a aba Dívidas (que só acompanha o andamento).
// Parcelas até pagasAntes já estavam pagas; as seguintes estão pagas quando a conta foi marcada como paga no período em que vencem.
export function derivarDividas(contas, periodos) {
  const saida = [];
  for (const c of contas || []) {
    if (c.tipo !== "parcelada") continue;
    const lista = c.parcelas || [];
    for (const it of lista) {
      const pagas = [];
      for (let k = 1; k <= it.total; k++) {
        if (k <= (it.pagasAntes || 0)) { pagas.push(k); continue; }
        const ym = somarMeses(it.mesInicio, k - 1);
        if ((periodos || []).some((p) => p.pagas && p.pagas[c.id] === true && (dataDaConta(c, p) || "").slice(0, 7) === ym)) pagas.push(k);
      }
      saida.push({
        id: `${c.id}:${it.id}`, contaId: c.id,
        nome: lista.length > 1 ? it.nome : c.nome, grupo: lista.length > 1 ? c.nome : null,
        valorCentavos: it.valorCentavos, totalParcelas: it.total, mesInicio: it.mesInicio, pagas,
        diaVencimento: c.dia || null
      });
    }
  }
  return saida;
}

// Resumo do teto: saldo, uso e quanto dá por dia até o fim do período.
export function resumoTetoPeriodo(p, lista, gastos, hoje = hojeIso()) {
  const teto = tetoDoPeriodo(p, lista);
  const gasto = totalGastosDoPeriodo(p, gastos);
  const restante = teto - gasto;
  const pct = teto > 0 ? Math.min(100, Math.round((gasto / teto) * 100)) : (gasto > 0 ? 100 : 0);
  let porDia = null;
  if (periodoContem(p, hoje) && restante > 0) porDia = Math.floor(restante / (diasEntre(hoje, p.fim) + 1));
  return { p, teto, gasto, restante, pct, estourou: restante < 0, porDia };
}

// Série do gráfico do Início: do período anterior ao atual em diante, completando com períodos previstos.
export function serieDePeriodos(lista, dados, tamanho = 8, hoje = hojeIso()) {
  if (!lista.length) return [];
  let i = lista.findIndex((p) => p.fim >= hoje);
  if (i === -1) i = lista.length;
  const saida = lista.slice(Math.max(0, i - 1), Math.max(0, i - 1) + tamanho);
  while (saida.length < tamanho) {
    const ult = saida.length ? saida[saida.length - 1] : lista[lista.length - 1];
    saida.push({ id: null, ...periodoSeguinte(ult), valores: {}, teto: null });
  }
  return saida.map((p) => ({
    ...calcularPeriodo(p, { ...dados, periodos: lista }),
    rotulo: rotuloPeriodo(p), curto: rotuloCurto(p), atual: periodoContem(p, hoje), previsto: !p.id
  }));
}

// ---------- Navegação entre períodos (usada em Contas e no Teto) ----------
// opcoes: { periodos, sel (período escolhido), aoEscolher(id), aoNovo(), aoEditar(p) }
export function navegacaoPeriodos({ periodos, sel, aoEscolher, aoNovo, aoEditar }) {
  if (!periodos.length || !sel) {
    return h("div", { class: "ct-nav" },
      h("div", { class: "cartao vazio" },
        h("div", { class: "vazio-ico", html: icone("calendario", 30) }),
        h("h3", {}, "Crie o primeiro período"),
        h("p", { class: "sub" }, "As contas e os imprevistos são organizados por período, por exemplo de 20/10 a 19/11. Você escolhe o início e o fim."),
        h("button", { class: "btn primario", type: "button", onclick: () => aoNovo() }, "Criar período")));
  }
  const hoje = hojeIso();
  const idx = periodos.findIndex((p) => p.id === sel.id);
  const ultimo = idx === periodos.length - 1;
  const hojeEm = periodoDeHoje(periodos, hoje);
  const dica = periodoContem(sel, hoje) ? "Este período" : hoje < sel.inicio ? "Período futuro" : "Período encerrado";

  const nos = [
    h("div", { class: "mes-nav" },
      h("button", {
        class: "mes-seta", type: "button", "aria-label": "Período anterior",
        disabled: idx <= 0, onclick: () => aoEscolher(periodos[idx - 1].id), html: icone("esq", 20)
      }),
      h("label", { class: "mes-escolha" },
        h("span", { class: "mes-nome" }, rotuloPeriodo(sel)),
        h("span", { class: "mes-dica" }, dica),
        h("select", {
          class: "mes-select", "aria-label": "Escolher o período",
          onchange: (e) => aoEscolher(e.target.value)
        }, periodos.map((p) => h("option", { value: p.id, selected: p.id === sel.id }, rotuloPeriodo(p))))),
      h("button", {
        class: "mes-seta", type: "button",
        "aria-label": ultimo ? "Criar o próximo período" : "Próximo período",
        onclick: () => (ultimo ? aoNovo() : aoEscolher(periodos[idx + 1].id)),
        html: icone(ultimo ? "plus" : "dir", 20)
      }))
  ];
  const acoes = [];
  if (hojeEm && hojeEm.id !== sel.id) acoes.push(h("button", { class: "btn-sutil", type: "button", onclick: () => aoEscolher(hojeEm.id) }, "Ir para hoje"));
  if (!hojeEm) acoes.push(h("button", { class: "btn-sutil", type: "button", onclick: () => aoNovo() }, "Criar o período de hoje"));
  acoes.push(h("button", { class: "btn-sutil", type: "button", onclick: () => aoEditar(sel) }, "Editar datas"));
  nos.push(h("div", { class: "per-acoes" }, acoes));
  return h("div", { class: "ct-nav" }, nos);
}
