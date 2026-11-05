// Backend de demonstração: tudo em memória, sem internet e sem Firebase.
// Serve para pré-visualizar as telas (?demo=1). Os dados somem ao recarregar.

import { mesAtual, somarMeses } from "./util.js";

export function criarBackendDemo() {
  let ouvinte = null;
  let casaId = null;
  let casa = { nome: "", membros: 0, diasUteis: false };
  let ouvinteCasa = null;
  const espera = (ms = 450) => new Promise((r) => setTimeout(r, ms));
  const USUARIO = { uid: "demo", nome: "Vinicius Demo", email: "demo@exemplo.com" };

  // Dívidas de exemplo, sempre relativas ao mês atual.
  const hoje = mesAtual();
  const faixa = (n) => Array.from({ length: n }, (_, i) => i + 1);
  const dividas = new Map();
  let seq = 0;
  const semear = (d) => dividas.set(`d${++seq}`, { id: `d${seq}`, ...d });
  // Sem dívidas no modelo antigo: as dívidas agora vêm das contas parceladas (veja abaixo).
  const ouvintesDividas = new Set();
  const copia = () => [...dividas.values()].map((d) => ({ ...d, pagas: [...(d.pagas || [])] }));
  const notificar = () => ouvintesDividas.forEach((f) => f(copia()));

  // Contas recorrentes de exemplo (valores inventados) e dados de cada mês.
  const contas = new Map();
  const meses = new Map();
  let seqConta = 0;
  const novaConta = (c) => contas.set(`c${++seqConta}`, { id: `c${seqConta}`, fim: null, ...c });
  novaConta({ nome: "Aluguel", tipo: "fixa", valorCentavos: 120000, inicio: somarMeses(hoje, -8), dia: 5 });
  novaConta({ nome: "Internet", tipo: "fixa", valorCentavos: 9990, inicio: somarMeses(hoje, -8), dia: 25 });
  novaConta({ nome: "Energia", tipo: "variavel", valorCentavos: 18000, inicio: somarMeses(hoje, -8), dia: 10 });
  novaConta({ nome: "Água", tipo: "variavel", valorCentavos: 7500, inicio: somarMeses(hoje, -8), dia: 12 });
  novaConta({ nome: "Alimentação", tipo: "variavel", valorCentavos: 90000, inicio: somarMeses(hoje, -8), dia: 20 });
  // Contas parceladas: as parcelas ficam dentro da conta e viram "dívidas" sozinhas.
  contas.set("c6", { id: "c6", nome: "Cartão Carrefour", tipo: "parcelada", valorCentavos: 0, inicio: somarMeses(hoje, -3), fim: null, dia: 5, parcelas: [
    { id: "p1", nome: "Celular", valorCentavos: 28900, total: 7, mesInicio: somarMeses(hoje, -3), pagasAntes: 3 },
    { id: "p2", nome: "Empréstimo", valorCentavos: 18500, total: 5, mesInicio: somarMeses(hoje, -3), pagasAntes: 3 }] });
  contas.set("c7", { id: "c7", nome: "Financiamento da moto", tipo: "parcelada", valorCentavos: 0, inicio: somarMeses(hoje, -10), fim: null, dia: 15, parcelas: [
    { id: "p1", nome: "Parcela", valorCentavos: 41250, total: 36, mesInicio: somarMeses(hoje, -10), pagasAntes: 10 }] });
  seqConta = 7;
  // Períodos de exemplo: do dia 20 de um mês até o dia 19 do seguinte.
  const hojeData = new Date();
  const iniAtual = hojeData.getDate() >= 20 ? `${hoje}-20` : `${somarMeses(hoje, -1)}-20`;
  const iniAnterior = `${somarMeses(iniAtual.slice(0, 7), -1)}-20`;
  const fim19 = (ini) => `${somarMeses(ini.slice(0, 7), 1)}-19`;
  meses.set(iniAnterior, { inicio: iniAnterior, fim: fim19(iniAnterior), valores: { c3: 19245, c4: 7120 }, pagas: { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true, c7: true } });
  meses.set(iniAtual, { inicio: iniAtual, fim: fim19(iniAtual), valores: { c5: 96000 }, pagas: { c1: true } });
  const gastos = new Map();
  let seqGasto = 0;
  const dia2 = (n) => String(n).padStart(2, "0");
  const somarDiaDemo = (ini, n) => { const d = new Date(Number(ini.slice(0, 4)), Number(ini.slice(5, 7)) - 1, Number(ini.slice(8)) + n); return `${d.getFullYear()}-${dia2(d.getMonth() + 1)}-${dia2(d.getDate())}`; };
  [["Farmácia", 4250, 3], ["Lanche", 2890, 8], ["Conserto da bike", 12000, 12]].forEach(([descricao, valorCentavos, d]) => {
    const id = `g${++seqGasto}`;
    gastos.set(id, { id, descricao, valorCentavos, data: somarDiaDemo(iniAtual, d) });
  });
  const ouvintesGastos = new Set();
  const notificarGastos = () => ouvintesGastos.forEach((f) => f([...gastos.values()].map((g) => ({ ...g }))));
  const feriados = {};
  const ouvintesFeriados = new Set();
  const ouvintesContas = new Set();
  const ouvintesMeses = new Set();
  const copiaContas = () => [...contas.values()].map((c) => ({ ...c }));
  const copiaMeses = () => Object.fromEntries([...meses].map(([k, v]) => [k, { ...v, valores: { ...(v.valores || {}) } }]));
  const notificarContas = () => ouvintesContas.forEach((f) => f(copiaContas()));
  const notificarMeses = () => ouvintesMeses.forEach((f) => f(copiaMeses()));

  return {
    aoMudarLogin(cb) {
      ouvinte = cb;
      setTimeout(() => cb(null), 700);
      return () => {};
    },
    async login() { await espera(); ouvinte(USUARIO); },
    async sair() { casaId = null; ouvinte(null); },
    async casaDoUsuario() { await espera(250); return casaId; },
    async criarCasa(user, nome, id) { await espera(); casaId = id; casa = { nome, membros: 1 }; },
    async entrarNaCasa(user, codigo) {
      await espera();
      if (codigo !== "DEMO2026") return { erro: "nao-existe" };
      casaId = codigo;
      casa = { nome: "Nossa casa", membros: 2 };
      return { ok: true };
    },
    observarCasa(id, aoReceber) {
      ouvinteCasa = aoReceber;
      setTimeout(() => aoReceber({ ...casa }), 120);
      return () => { ouvinteCasa = null; };
    },
    async salvarPreferencias(id, prefs) {
      Object.assign(casa, prefs);
      if (ouvinteCasa) ouvinteCasa({ ...casa });
    },

    observarDividas(id, aoReceber) {
      ouvintesDividas.add(aoReceber);
      setTimeout(() => aoReceber(copia()), 150);
      return () => ouvintesDividas.delete(aoReceber);
    },
    async salvarDivida(id, divId, dados) {
      if (divId) {
        Object.assign(dividas.get(divId), dados);
      } else {
        divId = `d${++seq}`;
        dividas.set(divId, { id: divId, pagas: [], ...dados });
      }
      notificar();
    },
    async excluirDivida(id, divId) { dividas.delete(divId); notificar(); },
    async marcarParcela(id, divId, numero, pago) {
      const d = dividas.get(divId);
      const s = new Set(d.pagas || []);
      if (pago) s.add(numero); else s.delete(numero);
      d.pagas = [...s];
      notificar();
    },

    observarContas(id, aoReceber) {
      ouvintesContas.add(aoReceber);
      setTimeout(() => aoReceber(copiaContas()), 150);
      return () => ouvintesContas.delete(aoReceber);
    },
    async salvarConta(id, contaId, dados) {
      if (contaId) {
        Object.assign(contas.get(contaId), dados);
      } else {
        contaId = `c${++seqConta}`;
        contas.set(contaId, { id: contaId, ...dados });
      }
      notificarContas();
    },
    async excluirConta(id, contaId) { contas.delete(contaId); notificarContas(); },

    observarGastos(id, aoReceber) {
      ouvintesGastos.add(aoReceber);
      setTimeout(() => aoReceber([...gastos.values()].map((g) => ({ ...g }))), 150);
      return () => ouvintesGastos.delete(aoReceber);
    },
    async salvarGasto(id, gastoId, dados) {
      if (gastoId) Object.assign(gastos.get(gastoId), dados);
      else { gastoId = `g${++seqGasto}`; gastos.set(gastoId, { id: gastoId, ...dados }); }
      notificarGastos();
    },
    async excluirGasto(id, gastoId) { gastos.delete(gastoId); notificarGastos(); },

    observarFeriados(id, aoReceber) {
      ouvintesFeriados.add(aoReceber);
      setTimeout(() => aoReceber({ ...feriados }), 150);
      return () => ouvintesFeriados.delete(aoReceber);
    },
    async salvarFeriado(id, data, dados) { feriados[data] = { ...dados }; ouvintesFeriados.forEach((f) => f({ ...feriados })); },
    async excluirFeriado(id, data) { delete feriados[data]; ouvintesFeriados.forEach((f) => f({ ...feriados })); },

    observarMeses(id, aoReceber) {
      ouvintesMeses.add(aoReceber);
      setTimeout(() => aoReceber(copiaMeses()), 150);
      return () => ouvintesMeses.delete(aoReceber);
    },
    async salvarValorMes(id, ym, contaId, centavos) {
      const m = meses.get(ym) || { valores: {} };
      m.valores = { ...(m.valores || {}) };
      if (centavos === null) delete m.valores[contaId]; else m.valores[contaId] = centavos;
      meses.set(ym, m);
      notificarMeses();
    },
    async salvarTeto(id, perId, centavos) {
      const m = meses.get(perId) || { valores: {} };
      m.teto = centavos;
      meses.set(perId, m);
      notificarMeses();
    },
    async salvarPaga(id, perId, contaId, paga) {
      const m = meses.get(perId) || { valores: {} };
      m.pagas = { ...(m.pagas || {}) };
      if (paga) m.pagas[contaId] = true; else delete m.pagas[contaId];
      meses.set(perId, m);
      notificarMeses();
    },
    async salvarPeriodo(id, perId, dados) {
      const m = meses.get(perId) || { valores: {} };
      meses.set(perId, { ...m, ...dados });
      notificarMeses();
    },
    async excluirPeriodo(id, perId) { meses.delete(perId); notificarMeses(); }
  };
}
