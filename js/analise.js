// Motor do Assistente: responde perguntas sobre as finanças usando só os dados do app, no próprio aparelho.
// Nada sai daqui: são cálculos, não uma IA externa. Cada análise devolve { titulo, blocos, sugestoes }.
//
// Blocos visuais (a tela os desenha em assistente.js):
//   kpis (números em destaque) · colunas (gráfico de colunas tocável) · anel (progresso) · pilha (divisão em partes)
//   ranking (barras horizontais) · tempo (linha do tempo) · simulador (controle deslizante) · dica (aviso colorido)
//   chips (etiquetas) · detalhes (conteúdo que abre ao tocar) · p (texto curto)

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
      return { id: d.id, nome: rotuloDivida(d), parcela: d.valorCentavos, restantes: c.restantes, restanteCentavos: c.restanteCentavos, fim: c.fim, conta: d.grupo || d.nome, total: d.totalParcelas, pagas: c.pagasN };
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
const kpi = (rotulo, valor, nota, tom) => ({ rotulo, valor, nota, tom });
const dica = (tom, txt) => ({ t: "dica", tom, txt });
const mesesTxt = (n) => `${n} ${n === 1 ? "mês" : "meses"}`;

function semDados(dados) {
  return !(dados.contas || []).length;
}

const VAZIO = {
  titulo: "Ainda não tenho o que analisar",
  blocos: [dica("info", "Cadastre suas contas e crie um período em Contas. Quando houver dados, eu calculo tudo por aqui.")],
  sugestoes: []
};

const SUG = {
  mes: "Como estamos mês a mês?",
  quitar: "Como quitar mais rápido?",
  fim: "Quando fico livre das dívidas?",
  resumo: "Como está este período?",
  imprev: "Como estão os imprevistos?",
  gasta: "Onde vai meu dinheiro?"
};

export function analisarMesAMes(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const hist = historicoPeriodos(dados, 6, hoje);
  if (hist.length < 2) {
    return { titulo: "Mês a mês", blocos: [dica("info", "Só existe um período cadastrado, então ainda não dá para comparar. Crie o próximo em Contas.")], sugestoes: [SUG.resumo, SUG.quitar] };
  }
  const ultimo = hist[hist.length - 1], penultimo = hist[hist.length - 2];
  const dif = ultimo.totalReal - penultimo.totalReal;
  const pct = penultimo.totalReal ? Math.round((Math.abs(dif) / penultimo.totalReal) * 100) : 0;
  const media = Math.round(hist.reduce((s, x) => s + x.totalReal, 0) / hist.length);
  const partes = [["Contas fixas", "fixas"], ["Contas variáveis", "variaveis"], ["Parcelas", "parceladas"], ["Imprevistos", "gastoTeto"]]
    .map(([nome, k]) => ({ nome, d: ultimo[k] - penultimo[k] })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const blocos = [
    { t: "kpis", itens: [
      kpi("Este período", reais(ultimo.totalReal), ultimo.rotulo, "neutro"),
      kpi(dif <= 0 ? "Caiu" : "Subiu", `${dif <= 0 ? "↓" : "↑"} ${reais(Math.abs(dif))}`, `${pct}% vs período anterior`, dif <= 0 ? "ok" : "alerta"),
      kpi("Média", reais(media), `últimos ${hist.length} períodos`, "neutro")] },
    { t: "colunas", titulo: "Total de cada período (toque numa coluna)", itens: hist.map((x, i) => ({
      rotulo: x.rotulo.split(" a ")[0], valor: x.totalReal, texto: reais(x.totalReal),
      detalhe: x.rotulo, extra: i ? `${difTxt(x.totalReal - hist[i - 1].totalReal)} vs anterior` : "", atual: x.atual })) }
  ];
  if (partes.length) {
    const top = partes[0];
    blocos.push(dica(top.d > 0 ? "alerta" : "ok", `O que mais mexeu: ${top.nome} (${difTxt(top.d)}).`));
    if (partes.length > 1) blocos.push({ t: "detalhes", titulo: "Ver todas as variações", blocos: [{ t: "ranking", itens: partes.map((x) => ({ rotulo: x.nome, texto: difTxt(x.d), pct: Math.min(100, Math.round((Math.abs(x.d) / Math.abs(top.d)) * 100)), tom: x.d > 0 ? "alerta" : "ok" })) }] });
  }
  return { titulo: "Mês a mês", blocos, sugestoes: [SUG.gasta, SUG.imprev, SUG.quitar] };
}

export function analisarQuitar(dados, extra = 0) {
  const ativas = dividasAtivas(dados);
  if (!ativas.length) {
    return { titulo: "Quitar mais rápido", blocos: [dica("info", "Não há parcelas em aberto. Quando você cadastrar uma conta parcelada (cartão, empréstimo), eu sugiro a melhor ordem para quitar.")], sugestoes: [SUG.mes, SUG.resumo] };
  }
  const porSaldo = [...ativas].sort((a, b) => a.restanteCentavos - b.restanteCentavos);
  const primeira = porSaldo[0];
  const blocos = [
    dica("ok", `Comece por ${primeira.nome}: faltam só ${primeira.restantes} ${primeira.restantes === 1 ? "parcela" : "parcelas"}. Ao acabar, libera ${reais(primeira.parcela)} por mês.`),
    { t: "tempo", titulo: "Ordem sugerida (menor saldo primeiro)", itens: porSaldo.map((d, i) => ({
      quando: `${i + 1}º`, titulo: d.nome, nota: `falta ${reais(d.restanteCentavos)} · ${d.restantes}× ${reais(d.parcela)}`,
      pct: d.total ? Math.round((d.pagas / d.total) * 100) : 0, rotuloPct: `${d.pagas} de ${d.total} pagas` })) },
    { t: "simulador", titulo: "E se sobrar um valor a mais por mês?", ativas: ativas.map((d) => ({ nome: d.nome, parcela: d.parcela, restantes: d.restantes })), extra: extra > 0 ? extra : 10000, max: 100000, passo: 5000, hoje: mesAtual() }
  ];
  return { titulo: "Quitar mais rápido", blocos, sugestoes: [SUG.fim, SUG.mes] };
}

export function analisarFim(dados) {
  const ativas = dividasAtivas(dados);
  if (!ativas.length) return { titulo: "Fim das dívidas", blocos: [dica("ok", "Nenhuma parcela em aberto no momento. 🎉")], sugestoes: [SUG.mes, SUG.resumo] };
  const resumo = calcularResumo(derivarDividas(dados.contas, listaPeriodos(dados.meses)));
  const porFim = [...ativas].sort((a, b) => diffMeses(b.fim, a.fim));
  const blocos = [
    { t: "kpis", itens: [
      kpi("Livre em", resumo.fim ? mesCurto(resumo.fim) : "—", `${mesesTxt(Math.max(...ativas.map((d) => d.restantes)))} restantes`, "neutro"),
      kpi("Falta pagar", reais(resumo.restanteCentavos), `${ativas.length} ${ativas.length === 1 ? "dívida" : "dívidas"}`, "alerta"),
      kpi("Já quitado", `${resumo.quitadoPct}%`, "do total parcelado", "ok")] },
    { t: "anel", pct: resumo.quitadoPct, centro: `${resumo.quitadoPct}%`, sub: "quitado" },
    { t: "tempo", titulo: "Quando cada uma termina", itens: porFim.map((d) => ({
      quando: mesCurto(d.fim), titulo: d.nome, nota: `${d.restantes} restantes · libera ${reais(d.parcela)}/mês depois`,
      pct: d.total ? Math.round((d.pagas / d.total) * 100) : 0, rotuloPct: `${d.pagas} de ${d.total} pagas` })) }
  ];
  return { titulo: "Fim das dívidas", blocos, sugestoes: [SUG.quitar, SUG.mes] };
}

export function analisarResumo(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const lista = listaPeriodos(dados.meses);
  const per = periodoDeHoje(lista, hoje);
  if (!per) return { titulo: "Período atual", blocos: [dica("info", "Hoje não cai em nenhum período. Crie o período atual em Contas.")], sugestoes: [SUG.mes] };
  const r = calcularPeriodo(per, { contas: dados.contas, periodos: lista, gastos: dados.gastos });
  const t = resumoTetoPeriodo(per, lista, dados.gastos, hoje);
  const abertas = r.itens.filter((i) => !i.paga).map((i) => i.conta.nome);
  const cats = [["Fixas", r.fixas], ["Variáveis", r.variaveis], ["Parcelas", r.parceladas], ["Imprevistos", r.gastoTeto]].filter((x) => x[1] > 0);
  const blocos = [
    { t: "anel", pct: r.pagoPct, centro: `${r.qtdPagas}/${r.qtdContas}`, sub: "contas pagas", titulo: rotuloPeriodo(per) },
    { t: "kpis", itens: [
      kpi("Falta pagar", reais(r.faltaPagar), `${r.qtdContas - r.qtdPagas} ${r.qtdContas - r.qtdPagas === 1 ? "conta" : "contas"}`, r.faltaPagar > 0 ? "alerta" : "ok"),
      kpi("Imprevistos", reais(t.gasto), `de ${reais(t.teto)} · ${t.pct}%`, t.estourou ? "alerta" : "neutro")] },
    { t: "pilha", titulo: "Para onde vai este período", itens: cats.map(([nome, valor]) => ({ nome, valor, texto: reais(valor) })) }
  ];
  if (abertas.length) blocos.push({ t: "chips", titulo: "Ainda sem marcar como paga", itens: abertas.slice(0, 8).map((n) => ({ txt: n, tom: "alerta" })) });
  if (t.estourou) blocos.push(dica("alerta", `Os imprevistos passaram do limite em ${reais(-t.restante)}.`));
  else if (t.porDia !== null) blocos.push(dica("info", `Dá para gastar ${reais(t.porDia)} por dia em imprevistos até o fim do período.`));
  return { titulo: "Período atual", blocos, sugestoes: [SUG.mes, SUG.imprev, SUG.quitar] };
}

export function analisarImprevistos(dados, hoje) {
  const lista = listaPeriodos(dados.meses);
  if (!lista.length) return VAZIO;
  const hist = lista.filter((x) => x.inicio <= hoje).slice(-6).map((per) => resumoTetoPeriodo(per, lista, dados.gastos, hoje));
  const comGasto = hist.filter((x) => x.gasto > 0);
  if (!comGasto.length) return { titulo: "Imprevistos", blocos: [dica("info", "Ainda não há gastos lançados em Imprevistos.")], sugestoes: [SUG.resumo, SUG.mes] };
  const media = Math.round(comGasto.reduce((s, x) => s + x.gasto, 0) / comGasto.length);
  const estouros = hist.filter((x) => x.estourou).length;
  const ult = hist[hist.length - 1];
  const gastos = (dados.gastos || []).filter((g) => g.data >= lista[Math.max(0, lista.length - 6)].inicio);
  const maior = [...gastos].sort((a, b) => b.valorCentavos - a.valorCentavos)[0];
  const blocos = [
    { t: "kpis", itens: [
      kpi("Média", reais(media), "por período", "neutro"),
      kpi("Limite", reais(ult.teto), "atual", "neutro"),
      kpi("Estouros", `${estouros}`, `em ${hist.length} períodos`, estouros ? "alerta" : "ok")] },
    { t: "colunas", titulo: "Gasto em cada período (toque numa coluna)", limite: { valor: ult.teto, rotulo: "limite" },
      itens: hist.map((x) => ({ rotulo: rotuloPeriodo(x.p).split(" a ")[0], valor: x.gasto, texto: reais(x.gasto), detalhe: `${rotuloPeriodo(x.p)} · ${x.teto ? Math.round((x.gasto / x.teto) * 100) : 0}% do limite`, tom: x.estourou ? "alerta" : "ok", atual: periodoContem2(x.p, hoje) })) }
  ];
  blocos.push(dica(estouros ? "alerta" : "ok", estouros ? `O limite foi ultrapassado em ${estouros} dos últimos ${hist.length} períodos.` : `O limite foi respeitado em todos os últimos ${hist.length} períodos.`));
  if (media > ult.teto && ult.teto > 0) blocos.push(dica("info", `A média está acima do limite. Considere subir para ${reais(Math.ceil(media / 5000) * 5000)} ou segurar os gastos.`));
  if (maior) blocos.push({ t: "chips", titulo: "Maior gasto", itens: [{ txt: `${maior.descricao || "Gasto"} · ${reais(maior.valorCentavos)}`, tom: "info" }] });
  return { titulo: "Imprevistos", blocos, sugestoes: [SUG.gasta, SUG.mes] };
}
const periodoContem2 = (p, hoje) => hoje >= p.inicio && hoje <= p.fim;

export function analisarOndeVai(dados, hoje) {
  if (semDados(dados)) return VAZIO;
  const lista = listaPeriodos(dados.meses);
  const per = periodoDeHoje(lista, hoje);
  if (!per) return { titulo: "Onde vai o dinheiro", blocos: [dica("info", "Hoje não cai em nenhum período. Crie o período atual em Contas.")], sugestoes: [SUG.mes] };
  const r = calcularPeriodo(per, { contas: dados.contas, periodos: lista, gastos: dados.gastos });
  const cats = [["Fixas", r.fixas], ["Variáveis", r.variaveis], ["Parcelas", r.parceladas], ["Imprevistos", r.gastoTeto]].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((s, x) => s + x[1], 0) || 1;
  const maiores = [...r.itens].sort((a, b) => b.valor - a.valor).slice(0, 5);
  const topo = maiores[0] ? maiores[0].valor : 1;
  const blocos = [
    { t: "kpis", itens: [kpi("Total do período", reais(total), rotuloPeriodo(per), "neutro")] },
    { t: "pilha", titulo: "Por categoria", itens: cats.map(([nome, valor]) => ({ nome, valor, texto: reais(valor) })) },
    { t: "ranking", titulo: "Maiores contas", itens: maiores.map((i) => ({ rotulo: i.conta.nome, texto: reais(i.valor), pct: Math.round((i.valor / topo) * 100) })) }
  ];
  const par = r.parceladas / total;
  if (par >= 0.3) blocos.push(dica("alerta", `As parcelas pesam ${Math.round(par * 100)}% do período. Quitá-las é o que mais alivia o orçamento.`));
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
      blocos: [dica("info", "Ainda sou um assistente simples e entendo estes assuntos. Toque em um deles ou escreva algo parecido.")],
      sugestoes: [SUG.mes, SUG.quitar, SUG.fim, SUG.resumo, SUG.imprev, SUG.gasta]
    };
  }
}

export const SUGESTOES_INICIAIS = [SUG.resumo, SUG.mes, SUG.quitar, SUG.fim, SUG.imprev, SUG.gasta];
