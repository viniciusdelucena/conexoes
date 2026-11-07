// Motor do Assistente: responde perguntas sobre as finanças usando só os dados do app, no próprio aparelho.
// Nada sai daqui: são cálculos, não uma IA externa. Cada análise devolve { titulo, blocos, sugestoes }.
//
// Tipos de bloco: { t: "p", txt } | { t: "destaque", rotulo, valor, nota } | { t: "lista", itens: [txt] }
//                | { t: "linhas", linhas: [{ rotulo, valor, extra, pct }] }  (pct 0-100 desenha uma barrinha)

import { reais, mesCurto, somarMeses, diffMeses, mesAtual } from "./util.js";
import { listaPeriodos, periodoDeHoje, calcularPeriodo, derivarDividas, hojeIso, resumoTetoPeriodo, rotuloPeriodo } from "./periodos.js";
import { calcularDivida, calcularResumo, rotuloDivida } from "./dividas.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const p = (txt) => ({ t: "p", txt });
const sinal = (c) => (c > 0 ? "+" : c < 0 ? "−" : "");
const difTxt = (c) => `${sinal(c)}${reais(Math.abs(c))}`;

// ---------- Cálculos puros ----------

// Totais de cada período já existente (o que foi gasto de verdade: imprevistos pelo gasto real).
export function historicoPeriodos(dados, tamanho = 6, hoje = hojeIso()) {
  const lista = listaPeriodos(dados.meses);
  const atual = periodoDeHoje(lista, hoje);
  const ateAgora = lista.filter((x) => x.inicio <= (atual ? atual.inicio : hoje));
  return ateAgora.slice(-tamanho).map((per) => {
    const r = calcularPeriodo(per, { contas: dados.contas, periodos: lista, gastos: dados.gastos });
    return { ...r, rotulo: rotuloPeriodo(per), atual: !!atual && per.id === atual.id };
  });
}

// Parcelas ainda por pagar: [{ nome, parcela, restantes, restanteCentavos, fim }]
export function dividasAtivas(dados) {
  const lista = listaPeriodos(dados.meses);
  return derivarDividas(dados.contas, lista)
    .map((d) => {
      const c = calcularDivida(d);
      return { id: d.id, nome: rotuloDivida(d), parcela: d.valorCentavos, restantes: c.restantes, restanteCentavos: c.restanteCentavos, fim: c.fim, conta: d.grupo || d.nome };
    })
    .filter((d) => d.restantes > 0);
}

// Simula quitar mais rápido: todo mês você paga o mesmo valor total (parcelas de hoje + extra).
// Quando uma dívida acaba, a parcela dela passa a ir para a próxima (bola de neve, menor saldo primeiro).
// Não há juros cadastrados, então o total pago não muda: o ganho é ficar livre das dívidas antes.
export function simularQuitacao(ativas, extraCentavos) {
  const base = ativas.length ? Math.max(...ativas.map((d) => d.restantes)) : 0;
  if (!ativas.length) return { meses: 0, base: 0, ordem: [] };
  const ds = ativas.map((d) => ({ nome: d.nome, parcela: d.parcela, restantes: d.restantes, credito: 0, fimMes: null }));
  const orcamento = ds.reduce((s, d) => s + d.parcela, 0) + Math.max(0, extraCentavos);
  let mes = 0;
  while (ds.some((d) => d.restantes > 0) && mes < 600) {
    mes++;
    let sobra = orcamento;
    for (const d of ds) if (d.restantes > 0) { d.restantes--; sobra -= d.parcela; if (d.restantes === 0) d.fimMes = mes; }
    const fila = ds.filter((d) => d.restantes > 0).sort((a, b) => a.restantes * a.parcela - b.restantes * b.parcela);
    for (const d of fila) {
      if (sobra <= 0) break;
      d.credito += sobra; sobra = 0;
      while (d.credito >= d.parcela && d.restantes > 0) { d.credito -= d.parcela; d.restantes--; if (d.restantes === 0) d.fimMes = mes; }
      sobra = d.restantes === 0 ? d.credito : 0;
      if (d.restantes === 0) d.credito = 0;
    }
  }
  return { meses: mes, base, ordem: ds.filter((d) => d.fimMes).sort((a, b) => a.fimMes - b.fimMes).map((d) => ({ nome: d.nome, fimMes: d.fimMes })) };
}

// Primeiro número em reais dentro do texto: "200", "R$ 150,50", "1.200".
export function extrairValor(txt) {
  const m = String(txt || "").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const inteiro = Number(m[1].replace(/\./g, ""));
  const cent = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return inteiro * 100 + cent;
}

// ---------- Análises ----------
function semDados(dados) {
  return !(dados.contas || []).length;
}

const VAZIO = {
  titulo: "Ainda não tenho o que analisar",
  blocos: [p("Cadastre suas contas e crie um período em Contas. Assim que houver dados, eu calculo tudo por aqui.")],
  sugestoes: []
};

const SUG = {
  mes: "Como estamos mês a mês?",
  quitar: "Como quitar mais rápido?",
  fim: "Quando fico livre das dívidas?",
  resumo: "Como está este período?",
  imprev: "Como estão os imprevistos?",
  gasta: "Onde vai meu dinheiro?",
  extra: "E se eu pagar R$ 200 a mais por mês?"
};

export function analisarMesAMes(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const hist = historicoPeriodos(dados, 6, hoje);
  if (hist.length < 2) {
    return { titulo: "Mês a mês", blocos: [p("Só existe um período cadastrado, então ainda não dá para comparar. Crie o próximo período em Contas e eu mostro a evolução.")], sugestoes: [SUG.resumo, SUG.quitar] };
  }
  const maior = Math.max(...hist.map((x) => x.totalReal), 1);
  const linhas = hist.map((x, i) => {
    const ant = i ? hist[i - 1].totalReal : null;
    const dif = ant === null ? null : x.totalReal - ant;
    return { rotulo: x.rotulo + (x.atual ? " (atual)" : ""), valor: reais(x.totalReal), extra: dif === null ? "" : difTxt(dif), pct: Math.round((x.totalReal / maior) * 100), sobe: dif > 0 };
  });
  const ultimo = hist[hist.length - 1], penultimo = hist[hist.length - 2];
  const dif = ultimo.totalReal - penultimo.totalReal;
  const pct = penultimo.totalReal ? Math.round((Math.abs(dif) / penultimo.totalReal) * 100) : 0;
  const blocos = [
    { t: "destaque", rotulo: dif <= 0 ? "Gasto do período atual caiu" : "Gasto do período atual subiu", valor: `${reais(Math.abs(dif))} (${pct}%)`, nota: `em relação a ${penultimo.rotulo}` },
    { t: "linhas", linhas }
  ];
  // O que mais mexeu entre os dois últimos períodos
  const partes = [["Contas fixas", "fixas"], ["Contas variáveis", "variaveis"], ["Parcelas", "parceladas"], ["Imprevistos (gasto real)", "gastoTeto"]]
    .map(([nome, k]) => ({ nome, d: ultimo[k] - penultimo[k] })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (partes.length) blocos.push({ t: "lista", itens: partes.slice(0, 3).map((x) => `${x.nome}: ${difTxt(x.d)}`) });
  const media = Math.round(hist.reduce((s, x) => s + x.totalReal, 0) / hist.length);
  blocos.push(p(`A média dos últimos ${hist.length} períodos é ${reais(media)}.`));
  return { titulo: "Mês a mês", blocos, sugestoes: [SUG.gasta, SUG.imprev, SUG.quitar] };
}

export function analisarQuitar(dados, extra = 0) {
  const ativas = dividasAtivas(dados);
  if (!ativas.length) {
    return { titulo: "Quitar mais rápido", blocos: [p("Não há parcelas em aberto. Quando você cadastrar uma conta parcelada (cartão, empréstimo), eu sugiro a melhor ordem para quitar.")], sugestoes: [SUG.mes, SUG.resumo] };
  }
  const porSaldo = [...ativas].sort((a, b) => a.restanteCentavos - b.restanteCentavos);
  const blocos = [];
  const primeira = porSaldo[0];
  blocos.push(p(`Sem juros cadastrados, a ordem mais eficiente é terminar primeiro o que tem menor saldo: cada dívida que acaba libera a parcela dela para a próxima.`));
  blocos.push({ t: "linhas", linhas: porSaldo.map((d, i) => ({ rotulo: `${i + 1}º ${d.nome}`, valor: reais(d.restanteCentavos), extra: `${d.restantes}× ${reais(d.parcela)}` })) });
  blocos.push(p(`Foque em ${primeira.nome}: faltam ${primeira.restantes} parcelas e, quando acabar, libera ${reais(primeira.parcela)} por mês.`));
  const rolando = simularQuitacao(ativas, 0); // mesmo valor por mês, redirecionando as parcelas que vão acabando
  const mesesTxt = (n) => `${n} ${n === 1 ? "mês" : "meses"}`;
  blocos.push(p(`No calendário atual você fica livre em ${mesesTxt(rolando.base)}. Se continuar pagando o mesmo valor total por mês e passar a parcela de cada dívida que acaba para a próxima, fica livre em ${mesesTxt(rolando.meses)}.`));
  if (extra > 0) {
    const com = simularQuitacao(ativas, extra);
    const ganho = com.base - com.meses;
    blocos.push({ t: "destaque", rotulo: `Com ${reais(extra)} a mais por mês`, valor: ganho > 0 ? `${mesesTxt(ganho)} antes` : "sem ganho", nota: `livre em ${mesesTxt(com.meses)} em vez de ${mesesTxt(com.base)} (até ${mesCurto(somarMeses(mesAtual(), com.meses - 1))})` });
    blocos.push(p("O total pago continua igual porque não há juros cadastrados. Se o banco der desconto na antecipação, o ganho é maior."));
  } else {
    blocos.push(p("Quer ver quanto adiantaria pagando um valor a mais por mês?"));
  }
  return { titulo: "Quitar mais rápido", blocos, sugestoes: extra > 0 ? [SUG.fim, SUG.mes] : ["E se eu pagar R$ 100 a mais por mês?", SUG.extra, SUG.fim] };
}

export function analisarFim(dados) {
  const ativas = dividasAtivas(dados);
  if (!ativas.length) return { titulo: "Fim das dívidas", blocos: [p("Nenhuma parcela em aberto no momento. 🎉")], sugestoes: [SUG.mes, SUG.resumo] };
  const resumo = calcularResumo(derivarDividas(dados.contas, listaPeriodos(dados.meses)));
  const porFim = [...ativas].sort((a, b) => diffMeses(b.fim, a.fim));
  const blocos = [
    { t: "destaque", rotulo: "Livre das parcelas em", valor: resumo.fim ? mesCurto(resumo.fim) : "—", nota: `faltam ${reais(resumo.restanteCentavos)} (${resumo.quitadoPct}% já quitado)` },
    { t: "linhas", linhas: porFim.map((d) => ({ rotulo: d.nome, valor: mesCurto(d.fim), extra: `${d.restantes} restantes` })) }
  ];
  // Quando o total das parcelas cai
  const quedas = [];
  for (const d of porFim) { quedas.push(`${mesCurto(somarMeses(d.fim, 1))}: libera ${reais(d.parcela)} por mês (${d.nome})`); }
  blocos.push({ t: "lista", itens: quedas.slice(0, 4) });
  return { titulo: "Fim das dívidas", blocos, sugestoes: [SUG.quitar, SUG.mes] };
}

export function analisarResumo(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const lista = listaPeriodos(dados.meses);
  const per = periodoDeHoje(lista, hoje);
  if (!per) return { titulo: "Período atual", blocos: [p("Hoje não cai em nenhum período. Crie o período atual em Contas.")], sugestoes: [SUG.mes] };
  const r = calcularPeriodo(per, { contas: dados.contas, periodos: lista, gastos: dados.gastos });
  const t = resumoTetoPeriodo(per, lista, dados.gastos, hoje);
  const blocos = [
    { t: "destaque", rotulo: `${rotuloPeriodo(per)}: contas pagas`, valor: `${r.qtdPagas} de ${r.qtdContas}`, nota: `${r.pagoPct}% pago · falta pagar ${reais(r.faltaPagar)}` },
    { t: "linhas", linhas: [
      { rotulo: "Contas fixas", valor: reais(r.fixas) }, { rotulo: "Contas variáveis", valor: reais(r.variaveis) }, { rotulo: "Parcelas", valor: reais(r.parceladas) },
      { rotulo: "Imprevistos", valor: `${reais(t.gasto)} de ${reais(t.teto)}`, pct: t.teto ? Math.min(100, Math.round((t.gasto / t.teto) * 100)) : 0 }] }
  ];
  const abertas = r.itens.filter((i) => !i.paga).map((i) => i.conta.nome);
  if (abertas.length) blocos.push(p(`Ainda não marcadas como pagas: ${abertas.slice(0, 6).join(", ")}${abertas.length > 6 ? "…" : ""}.`));
  if (t.estourou) blocos.push(p(`Atenção: os imprevistos passaram do limite em ${reais(-t.restante)}.`));
  else if (t.porDia !== null) blocos.push(p(`Dá para gastar ${reais(t.porDia)} por dia em imprevistos até o fim do período.`));
  return { titulo: "Período atual", blocos, sugestoes: [SUG.mes, SUG.imprev, SUG.quitar] };
}

export function analisarImprevistos(dados, hoje) {
  const lista = listaPeriodos(dados.meses);
  if (!lista.length) return VAZIO;
  const hist = lista.filter((x) => x.inicio <= hoje).slice(-6).map((per) => resumoTetoPeriodo(per, lista, dados.gastos, hoje));
  const comGasto = hist.filter((x) => x.gasto > 0);
  if (!comGasto.length) return { titulo: "Imprevistos", blocos: [p("Ainda não há gastos lançados em Imprevistos.")], sugestoes: [SUG.resumo, SUG.mes] };
  const media = Math.round(comGasto.reduce((s, x) => s + x.gasto, 0) / comGasto.length);
  const estouros = hist.filter((x) => x.estourou).length;
  const ult = hist[hist.length - 1];
  const gastos = (dados.gastos || []).filter((g) => g.data >= lista[Math.max(0, lista.length - 6)].inicio);
  const maior = [...gastos].sort((a, b) => b.valorCentavos - a.valorCentavos)[0];
  const blocos = [
    { t: "destaque", rotulo: "Média de imprevistos por período", valor: reais(media), nota: `limite atual: ${reais(ult.teto)}` },
    { t: "linhas", linhas: hist.map((x) => ({ rotulo: rotuloPeriodo(x.p), valor: reais(x.gasto), extra: x.estourou ? "passou" : "", pct: x.teto ? Math.min(100, Math.round((x.gasto / x.teto) * 100)) : 0 })) }
  ];
  blocos.push(p(estouros ? `O limite foi ultrapassado em ${estouros} dos últimos ${hist.length} períodos.` : `O limite foi respeitado em todos os últimos ${hist.length} períodos.`));
  if (maior) blocos.push(p(`Maior gasto: ${maior.descricao || "Gasto"} (${reais(maior.valorCentavos)}).`));
  if (media > ult.teto && ult.teto > 0) blocos.push(p(`A média está acima do limite. Vale considerar subir o limite para ${reais(Math.ceil(media / 5000) * 5000)} ou segurar os gastos.`));
  return { titulo: "Imprevistos", blocos, sugestoes: [SUG.gasta, SUG.mes] };
}

export function analisarOndeVai(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const lista = listaPeriodos(dados.meses);
  const per = periodoDeHoje(lista, hoje);
  if (!per) return { titulo: "Onde vai o dinheiro", blocos: [p("Hoje não cai em nenhum período. Crie o período atual em Contas.")], sugestoes: [SUG.mes] };
  const r = calcularPeriodo(per, { contas: dados.contas, periodos: lista, gastos: dados.gastos });
  const cats = [["Contas fixas", r.fixas], ["Contas variáveis", r.variaveis], ["Parcelas", r.parceladas], ["Imprevistos", r.gastoTeto]].filter((x) => x[1] > 0);
  const total = cats.reduce((s, x) => s + x[1], 0) || 1;
  const maiores = [...r.itens].sort((a, b) => b.valor - a.valor).slice(0, 3);
  const blocos = [
    { t: "linhas", linhas: cats.sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ rotulo: n, valor: reais(v), extra: `${Math.round((v / total) * 100)}%`, pct: Math.round((v / total) * 100) })) },
    { t: "lista", itens: maiores.map((i, k) => `${k + 1}º maior conta: ${i.conta.nome} (${reais(i.valor)})`) }
  ];
  const par = r.parceladas / total;
  if (par >= 0.3) blocos.push(p(`As parcelas pesam ${Math.round(par * 100)}% do período. Quitá-las é o caminho que mais alivia o orçamento.`));
  return { titulo: "Onde vai o dinheiro", blocos, sugestoes: [SUG.quitar, SUG.imprev, SUG.mes] };
}

// ---------- Interpretação da pergunta ----------
const REGRAS = [
  { id: "quitar", re: /quit|antecip|adiant|pagar mais|a mais|rapido|sobrar|extra|bola de neve|acabar/ },
  { id: "fim", re: /livre|terminar|termina|acaba|quando|fim das|previsao/ },
  { id: "imprev", re: /imprevist|limite|teto/ },
  { id: "onde", re: /onde|gast|categoria|maior|pesa|composicao|divid.*(gasto|conta)/ },
  { id: "mes", re: /mes a mes|evolu|compar|historic|anterior|subiu|caiu|variac|tendenc|metric|desempenho|melhor|piorou/ },
  { id: "resumo", re: /resumo|periodo|situacao|como estamos|como esta|pagas|falta pagar|atual|hoje/ }
];

export function responder(pergunta, dados, hoje = hojeIso()) {
  const q = norm(pergunta);
  const extra = extrairValor(q);
  const acha = REGRAS.find((r) => r.re.test(q));
  let id = acha ? acha.id : null;
  // "pagar R$ 200 a mais": o número com a ideia de pagar mais vira simulação
  if (extra && /mais|extra|sobr|adiant|antecip/.test(q)) id = "quitar";
  switch (id) {
    case "quitar": return analisarQuitar(dados, extra && /mais|extra|sobr|adiant|antecip/.test(q) ? extra : 0);
    case "fim": return analisarFim(dados);
    case "imprev": return analisarImprevistos(dados, hoje);
    case "onde": return analisarOndeVai(dados, hoje);
    case "mes": return analisarMesAMes(dados, hoje);
    case "resumo": return analisarResumo(dados, hoje);
    default: return {
      titulo: "Não entendi bem",
      blocos: [p("Ainda sou um assistente simples e entendo estes assuntos. Toque em um deles ou escreva algo parecido:")],
      sugestoes: [SUG.mes, SUG.quitar, SUG.fim, SUG.resumo, SUG.imprev, SUG.gasta]
    };
  }
}

export const SUGESTOES_INICIAIS = [SUG.resumo, SUG.mes, SUG.quitar, SUG.fim, SUG.imprev, SUG.gasta];
