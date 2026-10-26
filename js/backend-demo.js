// Backend de demonstração: tudo em memória, sem internet e sem Firebase.
// Serve para pré-visualizar as telas (?demo=1). Os dados somem ao recarregar.

import { mesAtual, somarMeses } from "./util.js";

export function criarBackendDemo() {
  let ouvinte = null;
  let casaId = null;
  let casa = { nome: "", membros: 0 };
  const espera = (ms = 450) => new Promise((r) => setTimeout(r, ms));
  const USUARIO = { uid: "demo", nome: "Vinicius Demo", email: "demo@exemplo.com" };

  // Dívidas de exemplo, sempre relativas ao mês atual.
  const hoje = mesAtual();
  const faixa = (n) => Array.from({ length: n }, (_, i) => i + 1);
  const dividas = new Map();
  let seq = 0;
  const semear = (d) => dividas.set(`d${++seq}`, { id: `d${seq}`, ...d });
  semear({ nome: "Cartão de crédito", valorCentavos: 28900, totalParcelas: 12, mesInicio: somarMeses(hoje, -4), pagas: faixa(4) });
  semear({ nome: "Financiamento da moto", valorCentavos: 41250, totalParcelas: 36, mesInicio: somarMeses(hoje, -10), pagas: faixa(10) });
  semear({ nome: "Empréstimo pessoal", valorCentavos: 18500, totalParcelas: 18, mesInicio: somarMeses(hoje, -2), pagas: [1] });
  semear({ nome: "Notebook", valorCentavos: 24990, totalParcelas: 10, mesInicio: somarMeses(hoje, 1), pagas: [] });
  const ouvintesDividas = new Set();
  const copia = () => [...dividas.values()].map((d) => ({ ...d, pagas: [...(d.pagas || [])] }));
  const notificar = () => ouvintesDividas.forEach((f) => f(copia()));

  // Contas recorrentes de exemplo (valores inventados) e dados de cada mês.
  const contas = new Map();
  const meses = new Map();
  let seqConta = 0;
  const novaConta = (c) => contas.set(`c${++seqConta}`, { id: `c${seqConta}`, fim: null, ...c });
  novaConta({ nome: "Aluguel", tipo: "fixa", valorCentavos: 120000, inicio: somarMeses(hoje, -8) });
  novaConta({ nome: "Internet", tipo: "fixa", valorCentavos: 9990, inicio: somarMeses(hoje, -8) });
  novaConta({ nome: "Energia", tipo: "variavel", valorCentavos: 18000, inicio: somarMeses(hoje, -8) });
  novaConta({ nome: "Água", tipo: "variavel", valorCentavos: 7500, inicio: somarMeses(hoje, -8) });
  novaConta({ nome: "Alimentação", tipo: "variavel", valorCentavos: 90000, inicio: somarMeses(hoje, -8) });
  meses.set(somarMeses(hoje, -1), { valores: { c3: 19245, c4: 7120 } });
  meses.set(hoje, { valores: { c5: 96000 } });
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
      setTimeout(() => aoReceber({ ...casa }), 120);
      return () => {};
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
    async salvarTeto(id, ym, centavos) {
      const m = meses.get(ym) || { valores: {} };
      m.teto = centavos;
      meses.set(ym, m);
      notificarMeses();
    }
  };
}
