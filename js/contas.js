// Módulo Contas do mês: parcelas das dívidas + contas fixas + contas variáveis + teto de gastos.
//
// Conta recorrente: { id, nome, tipo: "fixa" | "variavel", valorCentavos, inicio: "AAAA-MM", fim: "AAAA-MM" | null }
// Dados de um mês:  { valores: { [idDaConta]: centavos }, teto: centavos }
//   - valores guarda o valor real de uma conta variável (energia, água...) ou um reajuste só daquele mês;
//   - sem valor no mês, vale o valor padrão da conta (nas variáveis, ele é só uma estimativa);
//   - o teto vale para o mês em que foi definido e para os seguintes, até alguém mudar de novo.

import {
  $, h, reais, paraCampo, parseReais,
  mesAtual, somarMeses, diffMeses, nomeMes, mesCurto, NOMES_MESES
} from "./util.js";
import { icone } from "./icones.js";
import { diasUteisDoMes } from "./calendario.js";

export const TETO_PADRAO_CENTAVOS = 50000;

// ---------- Cálculos (funções puras) ----------
export function tetoDoMes(ym, meses) {
  let achado = null;
  for (const [chave, dados] of Object.entries(meses || {})) {
    if (dados && Number.isFinite(dados.teto) && chave <= ym && (achado === null || chave > achado)) achado = chave;
  }
  return achado === null ? TETO_PADRAO_CENTAVOS : meses[achado].teto;
}

export function parcelasDoMes(ym, dividas) {
  let total = 0;
  let quantidade = 0;
  for (const d of dividas || []) {
    const k = diffMeses(d.mesInicio, ym) + 1;
    if (k >= 1 && k <= d.totalParcelas) { total += d.valorCentavos; quantidade++; }
  }
  return { total, quantidade };
}

export function contasDoMes(ym, contas, meses) {
  const valores = (meses && meses[ym] && meses[ym].valores) || {};
  return (contas || [])
    .filter((c) => c.inicio <= ym && (!c.fim || ym <= c.fim))
    .map((c) => {
      const alterada = Number.isFinite(valores[c.id]);
      return {
        conta: c,
        valor: alterada ? valores[c.id] : c.valorCentavos,
        alterada,
        estimada: c.tipo === "variavel" && !alterada
      };
    })
    .sort((a, b) => a.conta.nome.localeCompare(b.conta.nome, "pt-BR"));
}

export function calcularMes(ym, { dividas, contas, meses, feriados = [] }) {
  const parcelas = parcelasDoMes(ym, dividas);
  const itens = contasDoMes(ym, contas, meses);
  const somar = (tipo) => itens.filter((i) => i.conta.tipo === tipo).reduce((s, i) => s + i.valor, 0);
  const fixas = somar("fixa");
  const variaveis = somar("variavel");
  const teto = tetoDoMes(ym, meses);
  const gastoTeto = 0; // os lançamentos de gastos chegam na Fase 5
  const total = parcelas.total + fixas + variaveis + teto;
  const dias = diasUteisDoMes(ym, feriados);
  return {
    ym, parcelas, itens, fixas, variaveis, teto, gastoTeto, total,
    totalReal: total - teto + gastoTeto,
    dias,
    porDia: dias ? Math.round(total / dias) : 0
  };
}

// ---------- Interface ----------
// contexto: { obterBackend, obterCasaId, aviso, abrirDividas(ym), aoResumo(resumoDoMesAtual | null) }
export function configurarContas(contexto) {
  let dividas = [];
  let contas = [];
  let meses = {};
  const pronto = { dividas: false, contas: false, meses: false };
  let mesSel = mesAtual();
  let contaForm = null;      // conta aberta no cadastro (null = nova)
  let tipoForm = "fixa";
  let valorAlvo = null;      // { conta, alterada } da folha de valor
  let confirmandoExclusao = false;
  let usarDias = false;      // preferência da casa: mostrar valor por dia útil

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const tudoPronto = () => pronto.dividas && pronto.contas && pronto.meses;
  const dados = () => ({ dividas, contas, meses });
  const dois = (n) => String(n).padStart(2, "0");

  function falha(e) {
    console.error(e);
    contexto.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore.");
  }
  const executar = (fn) => Promise.resolve().then(fn).catch(falha);

  // ----- Desenho -----
  function renderizar() {
    const caixa = $("ct-conteudo");
    if (!caixa) return;
    if (!tudoPronto()) {
      caixa.replaceChildren(navegacao(), h("div", { class: "cartao ct-carregando" }, h("div", { class: "spinner", "aria-label": "Carregando" })));
      contexto.aoResumo(null);
      return;
    }
    const r = calcularMes(mesSel, dados());
    caixa.replaceChildren(navegacao(), ...corpo(r));
    contexto.aoResumo(calcularMes(mesAtual(), dados()));
  }

  function navegacao() {
    const hoje = mesAtual();
    const ir = (n) => () => { mesSel = somarMeses(mesSel, n); renderizar(); };
    const opcoes = [];
    for (let n = -12; n <= 12; n++) {
      const ym = somarMeses(mesSel, n);
      opcoes.push(h("option", { value: ym, selected: n === 0 }, nomeMes(ym)));
    }
    const nos = [
      h("div", { class: "mes-nav" },
        h("button", { class: "mes-seta", type: "button", "aria-label": "Mês anterior", onclick: ir(-1), html: icone("esq", 20) }),
        h("label", { class: "mes-escolha" },
          h("span", { class: "mes-nome" }, nomeMes(mesSel)),
          h("span", { class: "mes-dica" }, mesSel === hoje ? "Este mês" : "Toque para escolher o mês"),
          h("select", {
            class: "mes-select", "aria-label": "Escolher o mês",
            onchange: (e) => { mesSel = e.target.value; renderizar(); }
          }, opcoes)),
        h("button", { class: "mes-seta", type: "button", "aria-label": "Próximo mês", onclick: ir(1), html: icone("dir", 20) }))
    ];
    if (mesSel !== hoje) {
      nos.push(h("button", {
        class: "btn-sutil", type: "button",
        onclick: () => { mesSel = hoje; renderizar(); }
      }, "Voltar para este mês"));
    }
    return h("div", { class: "ct-nav" }, nos);
  }

  function corpo(r) {
    return [
      resumo(r),
      secao("Dívidas", r.parcelas.total, [linhaParcelas(r)]),
      secao("Contas fixas", r.fixas, linhasContas(r, "fixa"), "Nenhuma conta fixa neste mês."),
      secao("Contas variáveis", r.variaveis, linhasContas(r, "variavel"), "Nenhuma conta variável neste mês."),
      secao("Teto de gastos", r.teto, [linhaTeto(r)]),
      h("button", { class: "btn-sutil", type: "button", onclick: () => abrirConta(null) }, "+ Adicionar conta")
    ];
  }

  function resumo(r) {
    const meta = (rotulo, valor) => h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
    return h("div", { class: "cartao resumo-div" },
      h("div", { class: "rd-rotulo" }, "Total do mês"),
      h("div", { class: "rd-valor" }, reais(r.total)),
      h("div", { class: "rd-meta" },
        usarDias ? meta("Por dia útil", reais(r.porDia)) : null,
        usarDias ? meta(`Dias úteis em ${NOMES_MESES[Number(mesSel.slice(5)) - 1].toLowerCase()}`, String(r.dias)) : null,
        meta("Com o gasto real", reais(r.totalReal))),
      h("div", { class: "rd-nota" },
        "O total usa o teto cheio. \"Com o gasto real\" troca o teto pelo que já foi gasto dele." +
        (usarDias ? ` O valor por dia útil é o total de ${nomeMes(mesSel)} dividido pelos ${r.dias} dias úteis do mês (segunda a sábado, sem descontar feriados por enquanto).` : ""))
    );
  }

  function secao(titulo, subtotal, linhas, vazio) {
    return h("article", { class: "cartao ct-secao" },
      h("header", { class: "ct-topo" }, h("h3", {}, titulo), h("span", { class: "ct-subtotal" }, reais(subtotal))),
      linhas.length
        ? h("ul", { class: "ct-lista" }, linhas.map((l) => h("li", {}, l)))
        : h("p", { class: "ct-vazio" }, vazio));
  }

  function linha({ icone: nomeIcone, nome, sub, valor, aoClicar }) {
    return h("button", { class: "ct-linha", type: "button", onclick: aoClicar },
      h("span", { class: "ct-ico", html: icone(nomeIcone, 20) }),
      h("span", { class: "ct-info" }, h("span", { class: "ct-nome" }, nome), h("span", { class: "ct-sub" }, sub)),
      h("span", { class: "ct-valor" }, reais(valor)),
      h("span", { class: "ct-seta", html: icone("dir", 16) }));
  }

  function linhaParcelas(r) {
    const q = r.parcelas.quantidade;
    return linha({
      icone: "dividas",
      nome: "Parcelas das dívidas",
      sub: q ? `${q} ${q === 1 ? "parcela" : "parcelas"} neste mês · toque para ver` : "Nenhuma parcela neste mês",
      valor: r.parcelas.total,
      aoClicar: () => contexto.abrirDividas(mesSel)
    });
  }

  function linhasContas(r, tipo) {
    return r.itens.filter((i) => i.conta.tipo === tipo).map((i) => {
      const ate = i.conta.fim ? ` · até ${mesCurto(i.conta.fim)}` : "";
      let sub;
      if (i.estimada) sub = [h("span", { class: "chip atraso" }, "Estimada"), ` toque para informar${ate}`];
      else if (tipo === "fixa") sub = i.alterada ? `Valor ajustado só neste mês${ate}` : `Todo mês${ate}`;
      else sub = `Valor informado${ate}`;
      return linha({ icone: "contas", nome: i.conta.nome, sub, valor: i.valor, aoClicar: () => abrirValor(i) });
    });
  }

  function linhaTeto(r) {
    return linha({
      icone: "teto",
      nome: "Reserva para imprevistos",
      sub: `Gasto até agora: ${reais(r.gastoTeto)} · lançamentos na Fase 5`,
      valor: r.teto,
      aoClicar: abrirTeto
    });
  }

  // ----- Folhas (formulários que sobem de baixo) -----
  const FOLHAS = ["folha-conta", "folha-valor", "folha-teto"];
  function fecharFolhas() {
    FOLHAS.forEach((id) => { $(id).hidden = true; });
    contaForm = null;
    valorAlvo = null;
  }
  function mostrarErro(id, msg) {
    const el = $(id);
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function definirSelect(id, valor) {
    const sel = $(id);
    if (![...sel.options].some((o) => o.value === String(valor))) sel.append(h("option", { value: valor }, valor));
    sel.value = String(valor);
  }

  // Cadastro da conta
  function definirTipo(tipo) {
    tipoForm = tipo;
    document.querySelectorAll("#cc-tipo [data-tipo]").forEach((b) => {
      const ativo = b.dataset.tipo === tipo;
      b.classList.toggle("ativo", ativo);
      b.setAttribute("aria-pressed", String(ativo));
    });
    $("cc-valor-rotulo").textContent = tipo === "fixa" ? "Valor (R$)" : "Valor estimado (R$)";
    $("cc-tipo-dica").textContent = tipo === "fixa"
      ? "Fixa: o valor é o mesmo todo mês, como aluguel e internet."
      : "Variável: o valor muda a cada mês, como energia e água. Você informa o valor real quando a conta chegar.";
  }

  function abrirConta(c) {
    fecharFolhas();
    contaForm = c;
    confirmandoExclusao = false;
    mostrarErro("erro-conta", "");
    $("conta-titulo").textContent = c ? "Editar conta" : "Nova conta";
    $("cc-nome").value = c ? c.nome : "";
    definirTipo(c ? c.tipo : "fixa");
    $("cc-valor").value = c ? paraCampo(c.valorCentavos) : "";
    const [ai, mi] = (c ? c.inicio : mesSel).split("-").map(Number);
    definirSelect("cc-inicio-ano", ai);
    $("cc-inicio-mes").value = String(mi);
    if (c && c.fim) {
      const [af, mf] = c.fim.split("-").map(Number);
      definirSelect("cc-fim-ano", af);
      $("cc-fim-mes").value = String(mf);
    } else {
      $("cc-fim-ano").value = "";
      $("cc-fim-mes").value = "1";
    }
    $("cc-fim-mes").hidden = !$("cc-fim-ano").value;
    const botao = $("btn-excluir-conta");
    botao.hidden = !c;
    botao.textContent = "Excluir";
    botao.classList.remove("confirmar");
    $("folha-conta").hidden = false;
    if (!c) requestAnimationFrame(() => $("cc-nome").focus());
  }

  function salvarConta() {
    const nome = $("cc-nome").value.trim();
    const valorCentavos = parseReais($("cc-valor").value);
    const inicio = `${$("cc-inicio-ano").value}-${dois($("cc-inicio-mes").value)}`;
    const fim = $("cc-fim-ano").value ? `${$("cc-fim-ano").value}-${dois($("cc-fim-mes").value)}` : null;

    if (!nome) return mostrarErro("erro-conta", "Dê um nome para a conta.");
    if (!(valorCentavos > 0)) return mostrarErro("erro-conta", "Informe o valor, por exemplo 120,00.");
    if (fim && fim < inicio) return mostrarErro("erro-conta", "A conta não pode terminar antes de começar.");

    const id = contaForm ? contaForm.id : null;
    const dadosConta = { nome, tipo: tipoForm, valorCentavos, inicio, fim };
    fecharFolhas();
    contexto.aviso(id ? "Conta atualizada" : "Conta adicionada");
    executar(() => backend().salvarConta(casa(), id, dadosConta));
  }

  function excluirConta() {
    if (!contaForm) return;
    const botao = $("btn-excluir-conta");
    if (!confirmandoExclusao) {
      confirmandoExclusao = true;
      botao.textContent = "Confirmar exclusão";
      botao.classList.add("confirmar");
      return;
    }
    const id = contaForm.id;
    fecharFolhas();
    contexto.aviso("Conta excluída de todos os meses");
    executar(() => backend().excluirConta(casa(), id));
  }

  // Valor da conta neste mês
  function abrirValor(item) {
    fecharFolhas();
    valorAlvo = { conta: item.conta, alterada: item.alterada };
    mostrarErro("erro-valor", "");
    $("valor-titulo").textContent = item.conta.nome;
    $("valor-rotulo").textContent = `Valor em ${nomeMes(mesSel)} (R$)`;
    $("cv-valor").value = paraCampo(item.valor);
    $("valor-dica").textContent = `Valor padrão da conta: ${reais(item.conta.valorCentavos)}. ` +
      (item.conta.tipo === "variavel"
        ? "Informe o valor real quando a conta chegar."
        : "Use para um reajuste só deste mês.");
    $("btn-valor-padrao").hidden = !item.alterada;
    $("folha-valor").hidden = false;
    requestAnimationFrame(() => $("cv-valor").select());
  }

  function salvarValor() {
    if (!valorAlvo) return;
    const centavos = parseReais($("cv-valor").value);
    if (!(centavos >= 0)) return mostrarErro("erro-valor", "Informe o valor, por exemplo 180,00.");
    const { conta } = valorAlvo;
    const ym = mesSel;
    // Conta fixa com o mesmo valor do padrão não precisa de ajuste.
    const gravar = conta.tipo === "fixa" && centavos === conta.valorCentavos ? null : centavos;
    fecharFolhas();
    contexto.aviso("Valor salvo");
    executar(() => backend().salvarValorMes(casa(), ym, conta.id, gravar));
  }

  function voltarAoPadrao() {
    if (!valorAlvo) return;
    const { conta } = valorAlvo;
    const ym = mesSel;
    fecharFolhas();
    contexto.aviso("Voltou ao valor padrão");
    executar(() => backend().salvarValorMes(casa(), ym, conta.id, null));
  }

  // Teto de gastos
  function abrirTeto() {
    fecharFolhas();
    mostrarErro("erro-teto", "");
    $("teto-rotulo").textContent = `Teto a partir de ${nomeMes(mesSel)} (R$)`;
    $("ctt-valor").value = paraCampo(tetoDoMes(mesSel, meses));
    $("folha-teto").hidden = false;
    requestAnimationFrame(() => $("ctt-valor").select());
  }

  function salvarTeto() {
    const centavos = parseReais($("ctt-valor").value);
    if (!(centavos >= 0)) return mostrarErro("erro-teto", "Informe o valor do teto, por exemplo 500,00.");
    const ym = mesSel;
    fecharFolhas();
    contexto.aviso("Teto atualizado");
    executar(() => backend().salvarTeto(casa(), ym, centavos));
  }

  // ----- Preparação -----
  const ano = new Date().getFullYear();
  const opcoesMes = () => NOMES_MESES.map((n, i) => h("option", { value: i + 1 }, n));
  const opcoesAno = (de, ate, vazio) => {
    const o = vazio ? [h("option", { value: "" }, vazio)] : [];
    for (let a = de; a <= ate; a++) o.push(h("option", { value: a }, a));
    return o;
  };
  $("cc-inicio-mes").replaceChildren(...opcoesMes());
  $("cc-inicio-ano").replaceChildren(...opcoesAno(ano - 3, ano + 9));
  $("cc-fim-mes").replaceChildren(...opcoesMes());
  $("cc-fim-ano").replaceChildren(...opcoesAno(ano - 3, ano + 15, "Sem data final"));
  $("cc-fim-ano").addEventListener("change", () => { $("cc-fim-mes").hidden = !$("cc-fim-ano").value; });

  $("cc-tipo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tipo]");
    if (b) definirTipo(b.dataset.tipo);
  });
  FOLHAS.forEach((id) => $(id).addEventListener("click", (e) => {
    if (e.target.closest("[data-fechar]")) fecharFolhas();
  }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && FOLHAS.some((id) => !$(id).hidden)) fecharFolhas();
  });
  $("form-conta").addEventListener("submit", (e) => { e.preventDefault(); salvarConta(); });
  $("form-valor").addEventListener("submit", (e) => { e.preventDefault(); salvarValor(); });
  $("form-teto").addEventListener("submit", (e) => { e.preventDefault(); salvarTeto(); });
  $("btn-excluir-conta").addEventListener("click", excluirConta);
  $("btn-valor-padrao").addEventListener("click", voltarAoPadrao);
  $("btn-editar-conta").addEventListener("click", () => {
    if (valorAlvo) abrirConta(valorAlvo.conta);
  });

  renderizar();

  return {
    receberDividas(lista) { dividas = lista; pronto.dividas = true; renderizar(); },
    receberContas(lista) { contas = lista; pronto.contas = true; renderizar(); },
    definirDiasUteis(ativo) { if (usarDias !== ativo) { usarDias = ativo; renderizar(); } },
    receberMeses(mapa) { meses = mapa; pronto.meses = true; renderizar(); },
    limpar() {
      dividas = []; contas = []; meses = {};
      pronto.dividas = pronto.contas = pronto.meses = false;
      mesSel = mesAtual();
      fecharFolhas();
      renderizar();
    }
  };
}
