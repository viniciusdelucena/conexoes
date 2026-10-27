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
import {
  diasUteisDoMes, feriadosNacionaisCalculados, buscarFeriadosApi, feriadosDoMes,
  datasQueContam, feriadosEmDiaDeSemana, gradeDoMes, diaDaSemana, DIAS_SEMANA
} from "./calendario.js";

export const TETO_PADRAO_CENTAVOS = 50000;

// ---------- Cálculos (funções puras) ----------
export function tetoDoMes(ym, meses) {
  let achado = null;
  for (const [chave, dados] of Object.entries(meses || {})) {
    if (dados && Number.isFinite(dados.teto) && chave <= ym && (achado === null || chave > achado)) achado = chave;
  }
  return achado === null ? TETO_PADRAO_CENTAVOS : meses[achado].teto;
}

export function totalGastosDoMes(ym, gastos) {
  return (gastos || []).filter((g) => g.data && g.data.startsWith(ym + "-")).reduce((s, g) => s + g.valorCentavos, 0);
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

export function calcularMes(ym, { dividas, contas, meses, gastos = [], feriados = [] }) {
  const parcelas = parcelasDoMes(ym, dividas);
  const itens = contasDoMes(ym, contas, meses);
  const somar = (tipo) => itens.filter((i) => i.conta.tipo === tipo).reduce((s, i) => s + i.valor, 0);
  const fixas = somar("fixa");
  const variaveis = somar("variavel");
  const teto = tetoDoMes(ym, meses);
  const gastoTeto = totalGastosDoMes(ym, gastos);
  const total = parcelas.total + fixas + variaveis + teto;
  const dias = diasUteisDoMes(ym, feriados);
  return {
    ym, parcelas, itens, fixas, variaveis, teto, gastoTeto, total,
    totalReal: total - teto + gastoTeto,
    dias,
    feriados: feriados.filter((d) => diaDaSemana(d) !== 0).length,
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
  let manuais = {};          // feriados da casa: { "AAAA-MM-DD": { nome, tipo } }
  const nacionais = {};      // feriados nacionais por ano
  const baixados = new Set(); // anos que já tentaram a BrasilAPI nesta sessão
  let feriadoAlvo = null;    // feriado aberto na folha (null = novo)

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const tudoPronto = () => pronto.dividas && pronto.contas && pronto.meses;
  let gastos = [];
  const dados = (ym) => ({ dividas, contas, meses, gastos, feriados: datasQueContam(feriadosMes(ym)) });

  function nacionaisDoAno(ano) {
    if (!nacionais[ano]) {
      let guardado = null;
      try { guardado = JSON.parse(localStorage.getItem(`conexoes-feriados-${ano}`)); } catch (_) { /* sem cache */ }
      nacionais[ano] = guardado || feriadosNacionaisCalculados(ano);
    }
    return nacionais[ano];
  }
  const feriadosMes = (ym) => feriadosDoMes(ym, nacionaisDoAno(Number(ym.slice(0, 4))), manuais);

  // Só vai à internet quando o valor por dia útil está ligado.
  function atualizarFeriadosNacionais() {
    if (!usarDias) return;
    for (const ano of new Set([Number(mesSel.slice(0, 4)), Number(mesAtual().slice(0, 4))])) {
      if (baixados.has(ano)) continue;
      baixados.add(ano);
      buscarFeriadosApi(ano).then((mapa) => {
        if (!mapa) return;
        nacionais[ano] = mapa;
        try { localStorage.setItem(`conexoes-feriados-${ano}`, JSON.stringify(mapa)); } catch (_) { /* ignora */ }
        renderizar();
      });
    }
  }
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
      if (contexto.aoSerie) contexto.aoSerie([]);
      return;
    }
    const r = calcularMes(mesSel, dados(mesSel));
    caixa.replaceChildren(navegacao(), ...corpo(r));
    contexto.aoResumo(calcularMes(mesAtual(), dados(mesAtual())));
    if (contexto.aoSerie) {
      const hoje = mesAtual();
      contexto.aoSerie(Array.from({ length: 8 }, (_, i) => { const ym = somarMeses(hoje, i - 1); return calcularMes(ym, dados(ym)); }));
    }
    atualizarFeriadosNacionais();
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
      ...(usarDias ? [calendario()] : []),
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
        (usarDias ? ` O valor por dia útil é o total de ${nomeMes(mesSel)} dividido pelos ${r.dias} dias úteis do mês (segunda a sábado, sem os feriados).` : ""))
    );
  }

  // ----- Calendário e feriados (só com o valor por dia útil ligado) -----
  function calendario() {
    const lista = feriadosMes(mesSel);
    const porData = new Map(lista.map((f) => [f.data, f]));
    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${dois(hoje.getMonth() + 1)}-${dois(hoje.getDate())}`;
    const alertas = feriadosEmDiaDeSemana(lista);

    const aviso = alertas.length
      ? h("div", { class: "cal-aviso" },
          h("strong", {}, alertas.length === 1 ? "Atenção: 1 feriado de segunda a sexta" : `Atenção: ${alertas.length} feriados de segunda a sexta`),
          h("span", {}, alertas.map((f) => `${DIAS_SEMANA[f.diaSemana]}, ${f.dia} (${f.nome})`).join(" · ")))
      : h("div", { class: "cal-aviso ok" }, "Nenhum feriado de segunda a sexta neste mês.");

    const cabecalho = ["D", "S", "T", "Q", "Q", "S", "S"].map((l) => h("span", { class: "cal-cab" }, l));
    const dias = gradeDoMes(mesSel).map((d) => {
      if (!d) return h("span", { class: "cal-vazio" });
      const data = `${mesSel}-${dois(d)}`;
      const f = porData.get(data);
      const dow = new Date(Number(mesSel.slice(0, 4)), Number(mesSel.slice(5)) - 1, d).getDay();
      const classes = ["cal-dia"];
      if (dow === 0) classes.push("domingo");
      if (f) classes.push(f.conta ? "feriado" : "isento");
      if (data === hojeIso) classes.push("hoje");
      return h("button", {
        class: classes.join(" "), type: "button",
        "aria-label": `${d} de ${nomeMes(mesSel)}${f ? `, ${f.nome}` : ""}`,
        onclick: () => abrirFeriado(data, f || null)
      }, String(d));
    });

    const linhas = lista.map((f) => h("li", {},
      h("button", { class: "ct-linha", type: "button", onclick: () => abrirFeriado(f.data, f) },
        h("span", { class: "ct-ico", html: icone("calendario", 20) }),
        h("span", { class: "ct-info" },
          h("span", { class: "ct-nome" }, f.nome),
          h("span", { class: "ct-sub" }, `${DIAS_SEMANA[f.diaSemana]}, ${f.dia} · ${f.origem === "nacional" ? "nacional" : "adicionado por vocês"}`)),
        h("span", { class: "ct-valor cal-efeito" }, !f.conta ? "não desconta" : f.diaSemana === 0 ? "domingo" : "−1 dia útil"),
        h("span", { class: "ct-seta", html: icone("dir", 16) }))));

    return h("article", { class: "cartao ct-secao" },
      h("header", { class: "ct-topo" }, h("h3", {}, "Calendário e feriados"), h("span", { class: "ct-subtotal" }, r0(lista) === 1 ? "1 dia descontado" : `${r0(lista)} dias descontados`)),
      aviso,
      h("div", { class: "cal-grade" }, cabecalho, dias),
      linhas.length ? h("ul", { class: "ct-lista" }, linhas) : null,
      h("button", { class: "btn-sutil cal-add", type: "button", onclick: () => abrirFeriado(null, null) }, "+ Adicionar feriado ou folga"),
      h("p", { class: "ct-vazio cal-nota" }, "Feriados nacionais vêm da BrasilAPI (ou são calculados pelo app, sem internet). Toque num dia para adicionar uma folga ou deixar de descontar um feriado."));
  }
  const r0 = (lista) => lista.filter((f) => f.conta && f.diaSemana !== 0).length;

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
      sub: `Gasto até agora: ${reais(r.gastoTeto)} · toque para ver os gastos`,
      valor: r.teto,
      aoClicar: () => contexto.abrirTetoPagina()
    });
  }

  // ----- Folhas (formulários que sobem de baixo) -----
  const FOLHAS = ["folha-conta", "folha-valor", "folha-teto", "folha-feriado"];
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

  // Feriado: novo, adicionado por vocês (editar/excluir) ou nacional (descontar ou não)
  function abrirFeriado(data, f) {
    fecharFolhas();
    feriadoAlvo = { data, f };
    mostrarErro("erro-feriado", "");
    const novo = !f;
    $("feriado-titulo").textContent = novo ? "Novo feriado ou folga" : f.nome;
    $("fr-data").value = data || (mesSel === mesAtual() ? new Date().toISOString().slice(0, 10) : `${mesSel}-01`);
    $("fr-data").disabled = !novo;
    $("fr-nome").value = f ? f.nome : "";
    $("fr-nome").disabled = !!f && f.origem === "nacional";
    $("btn-feriado-salvar").hidden = !!f && f.origem === "nacional";
    const alt = $("btn-feriado-alt");
    alt.hidden = novo;
    alt.classList.toggle("perigo", !!f && f.origem === "extra");
    if (f) alt.textContent = f.origem === "extra" ? "Excluir" : f.conta ? "Não descontar" : "Voltar a descontar";
    $("feriado-dica").textContent = novo
      ? "Use para feriado municipal, ponte ou qualquer dia em que você não trabalha. Ele sai dos dias úteis."
      : f.origem === "nacional"
        ? (f.conta ? "Feriado nacional. Se você trabalha neste dia, toque em \"Não descontar\"." : "Este feriado não está sendo descontado dos dias úteis.")
        : "Folga adicionada por vocês. Ela sai dos dias úteis do mês.";
    $("folha-feriado").hidden = false;
    if (novo) requestAnimationFrame(() => $("fr-nome").focus());
  }

  function salvarFeriado() {
    const alvo = feriadoAlvo;
    if (!alvo) return;
    const data = alvo.f ? alvo.data : $("fr-data").value;
    const nome = $("fr-nome").value.trim() || "Folga";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return mostrarErro("erro-feriado", "Escolha a data.");
    fecharFolhas();
    contexto.aviso("Feriado salvo");
    executar(() => backend().salvarFeriado(casa(), data, { nome, tipo: "extra" }));
  }

  function alternarFeriado() {
    const alvo = feriadoAlvo;
    if (!alvo || !alvo.f) return;
    const { data, f } = alvo;
    fecharFolhas();
    if (f.origem === "extra") {
      contexto.aviso("Feriado excluído");
      executar(() => backend().excluirFeriado(casa(), data));
    } else if (f.conta) {
      contexto.aviso("Este feriado não será descontado");
      executar(() => backend().salvarFeriado(casa(), data, { nome: f.nome, tipo: "removido" }));
    } else {
      contexto.aviso("Voltou a descontar este feriado");
      executar(() => backend().excluirFeriado(casa(), data));
    }
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
  $("form-feriado").addEventListener("submit", (e) => { e.preventDefault(); salvarFeriado(); });
  $("btn-feriado-alt").addEventListener("click", alternarFeriado);
  $("btn-valor-padrao").addEventListener("click", voltarAoPadrao);
  $("btn-editar-conta").addEventListener("click", () => {
    if (valorAlvo) abrirConta(valorAlvo.conta);
  });

  renderizar();

  return {
    receberDividas(lista) { dividas = lista; pronto.dividas = true; renderizar(); },
    receberContas(lista) { contas = lista; pronto.contas = true; renderizar(); },
    definirDiasUteis(ativo) { if (usarDias !== ativo) { usarDias = ativo; renderizar(); } },
    receberGastos(lista) { gastos = lista; renderizar(); },
    editarTeto(ym) { mesSel = ym; renderizar(); abrirTeto(); },
    receberFeriados(mapa) { manuais = mapa || {}; renderizar(); },
    receberMeses(mapa) { meses = mapa; pronto.meses = true; renderizar(); },
    limpar() {
      dividas = []; contas = []; meses = {}; manuais = {}; gastos = [];
      pronto.dividas = pronto.contas = pronto.meses = false;
      mesSel = mesAtual();
      fecharFolhas();
      renderizar();
    }
  };
}
