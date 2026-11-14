// Investimentos: cálculos puros (sem tela), para poderem ser testados em Node.
//
// Movimento: { id, tipo: "saldo" | "aporte", valorCentavos, data: "AAAA-MM-DD", ordem }
//   saldo  = quanto a pessoa tem no total naquela data (já com rendimentos); substitui o total.
//   aporte = dinheiro novo colocado; soma ao total.
//   "ordem" desempata movimentos do mesmo dia (aporte e depois saldo no mesmo dia = o saldo vale).
// Meta: { id, nome, alvoCentavos, prazo: "AAAA-MM-DD" | null }
//
// Dinheiro sempre em centavos inteiros; meses no formato "AAAA-MM".

import { mesAtual, somarMeses, diffMeses } from "./util.js";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const ordenarMovimentos = (lista) =>
  [...(lista || [])].sort((a, b) => cmp(a.data, b.data) || (a.ordem || 0) - (b.ordem || 0) || cmp(a.id || "", b.id || ""));

// "aportado" é o que a pessoa colocou do próprio bolso. O primeiro valor informado vira o ponto de partida
// (não conta como rendimento); valores informados depois mudam o total, mas não o aportado.
const VAZIO = { total: 0, aportado: 0, temSaldo: false };
function aplicar(e, m) {
  if (m.tipo === "saldo") return { total: m.valorCentavos, aportado: e.temSaldo ? e.aportado : m.valorCentavos, temSaldo: true };
  return { total: e.total + m.valorCentavos, aportado: e.aportado + m.valorCentavos, temSaldo: e.temSaldo };
}

// Situação de hoje: total, quanto foi aportado, rendimento (pode ser negativo) e datas úteis para a tela.
export function situacao(movs) {
  const ord = ordenarMovimentos(movs);
  let e = VAZIO;
  for (const m of ord) e = aplicar(e, m);
  const saldos = ord.filter((m) => m.tipo === "saldo");
  const rendimento = e.total - e.aportado;
  return {
    quantidade: ord.length,
    total: e.total,
    aportado: e.aportado,
    rendimento,
    rendimentoPct: e.aportado > 0 ? (rendimento / e.aportado) * 100 : 0,
    ultimaData: ord.length ? ord[ord.length - 1].data : null,
    ultimoSaldoData: saldos.length ? saldos[saldos.length - 1].data : null
  };
}

// Um ponto por mês, do primeiro movimento até o mês atual. Mês sem movimento repete o anterior.
// Cada ponto: { m, total, aportado, rendimento, aporteMes } (valores no fim do mês).
export function serieMensal(movs, hoje = mesAtual()) {
  const ord = ordenarMovimentos(movs);
  if (!ord.length) return [];
  const primeiro = ord[0].data.slice(0, 7);
  const ultimo = ord[ord.length - 1].data.slice(0, 7);
  const fim = ultimo > hoje ? ultimo : hoje;
  const pontos = [];
  let e = VAZIO, i = 0;
  for (let m = primeiro; m <= fim; m = somarMeses(m, 1)) {
    let aporteMes = 0;
    while (i < ord.length && ord[i].data.slice(0, 7) <= m) {
      if (ord[i].tipo === "aporte") aporteMes += ord[i].valorCentavos;
      e = aplicar(e, ord[i]);
      i++;
    }
    pontos.push({ m, total: e.total, aportado: e.aportado, rendimento: e.total - e.aportado, aporteMes });
  }
  return pontos;
}

// Média mensal de aportes nos últimos 3 meses fechados (o mês atual ainda está pela metade).
// Quem começou este mês usa o próprio mês. Não conta rendimento: é uma estimativa conservadora.
export function ritmoMensal(movs, hoje = mesAtual()) {
  const ord = ordenarMovimentos(movs);
  if (!ord.length) return 0;
  const primeiro = ord[0].data.slice(0, 7);
  let ini, fim;
  if (primeiro >= hoje) { ini = fim = hoje; }
  else { fim = somarMeses(hoje, -1); ini = primeiro > somarMeses(hoje, -3) ? primeiro : somarMeses(hoje, -3); }
  const meses = diffMeses(ini, fim) + 1;
  const soma = ord
    .filter((m) => m.tipo === "aporte" && m.data.slice(0, 7) >= ini && m.data.slice(0, 7) <= fim)
    .reduce((s, m) => s + m.valorCentavos, 0);
  return Math.round(soma / meses);
}

// Quanto falta para a meta e como ela está.
//   situacao: "atingida" | "no-ritmo" | "abaixo" | "atrasada" | "sem-prazo" | "sem-ritmo"
//   porMes: quanto guardar por mês para chegar no prazo (só com prazo futuro)
//   previsto: mês ("AAAA-MM") em que chega lá mantendo o ritmo de aportes (null sem ritmo)
export function progressoMeta(meta, total, { ritmo = 0, hoje = mesAtual() } = {}) {
  const alvo = meta.alvoCentavos;
  const atingida = total >= alvo;
  const falta = Math.max(0, alvo - total);
  const pct = alvo > 0 ? Math.min(100, Math.floor((total / alvo) * 100)) : 0;
  const prazoMes = meta.prazo ? meta.prazo.slice(0, 7) : null;
  const mesesRestantes = prazoMes ? diffMeses(hoje, prazoMes) : null;
  const porMes = !atingida && prazoMes && mesesRestantes >= 1 ? Math.ceil(falta / mesesRestantes) : null;
  const previsto = !atingida && ritmo > 0 ? somarMeses(hoje, Math.ceil(falta / ritmo)) : null;

  let sit;
  if (atingida) sit = "atingida";
  else if (prazoMes === null) sit = previsto ? "sem-prazo" : "sem-ritmo";
  else if (mesesRestantes < 0) sit = "atrasada";
  else if (previsto && previsto <= prazoMes) sit = "no-ritmo";
  else sit = ritmo > 0 ? "abaixo" : "sem-ritmo";
  return { pct, falta, atingida, prazoMes, mesesRestantes, porMes, previsto, situacao: sit };
}

// Metas na ordem de leitura: as em andamento primeiro (prazo mais próximo, depois menor valor); as atingidas por último.
export function ordenarMetas(metas, total) {
  const aberta = (m) => total < m.alvoCentavos;
  return [...(metas || [])].sort((a, b) => {
    if (aberta(a) !== aberta(b)) return aberta(a) ? -1 : 1;
    const pa = a.prazo || "9999-99-99", pb = b.prazo || "9999-99-99";
    return cmp(pa, pb) || a.alvoCentavos - b.alvoCentavos || cmp(a.nome || "", b.nome || "");
  });
}

// A meta em andamento mais perto de ser alcançada (a de menor valor que falta). Serve ao cartão do Início.
export function metaMaisProxima(metas, total) {
  const abertas = (metas || []).filter((m) => total < m.alvoCentavos);
  if (!abertas.length) return null;
  return abertas.reduce((a, b) => (b.alvoCentavos - total < a.alvoCentavos - total ? b : a));
}
