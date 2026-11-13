// Módulo Contas: contas do período (fixas, variáveis e parceladas), o checklist de pagamento e o teto de gastos.
//
// Os períodos e os cálculos ficam em periodos.js. Conta recorrente:
//   { id, nome, tipo: "fixa" | "variavel" | "parcelada", valorCentavos, inicio, fim, dia, parcelas? }
// É aqui que se marca o que foi pago. A aba Dívidas só lê as parcelas das contas parceladas.

import { $, h, reais, animarValor, animarLargura, paraCampo, parseReais, nomeMes, NOMES_MESES, somarMeses } from "./util.js";
import { icone } from "./icones.js";
import {
  feriadosNacionaisCalculados, buscarFeriadosApi, feriadosDoMes, diasUteisDoMes,
  datasQueContam, feriadosEmDiaDeSemana, gradeDoMes, diaDaSemana, DIAS_SEMANA
} from "./calendario.js";
import {
  hojeIso, somarDias, somarMesesData, diasEntre, mesesEntre, dataCurta, rotuloPeriodo,
  listaPeriodos, periodoDeHoje, periodoSeguinte, periodoContem, selecao, resolverSelecionado,
  tetoDoPeriodo, calcularPeriodo, serieDePeriodos, navegacaoPeriodos, dataDaConta, derivarDividas
} from "./periodos.js";

// ---------- Interface ----------
// contexto: { obterBackend, obterCasaId, aviso, abrirDividas(ym), aoResumo(resumoDoMesAtual | null) }
// contexto: { obterBackend, obterCasaId, aviso, abrirTetoPagina(), aoResumo(resumoDoPeriodoDeHoje | null), aoSerie(serie), aoPeriodo() }
export function configurarContas(contexto) {
  let contas = [];
  let meses = {};            // documentos de período (veja periodos.js)
  let gastos = [];
  const pronto = { contas: false, meses: false };
  let contaForm = null;      // conta aberta no cadastro (null = nova)
  let tipoForm = "fixa";
  let valorAlvo = null;      // { conta, alterada } da folha de valor
  let periodoAlvo = null;    // período aberto na folha (null = novo)
  let confirmandoExclusao = false;
  let confirmandoPeriodo = false;
  let linhasParcela = [];    // editor de parcelas da conta parcelada
  let dividasAntigas = [];   // dívidas do modelo antigo, ainda por converter em contas
  let fimMexido = false;
  let usarDias = false;      // preferência da casa: mostrar valor por dia útil
  let manuais = {};          // feriados da casa: { "AAAA-MM-DD": { nome, tipo } }
  const nacionais = {};      // feriados nacionais por ano
  const baixados = new Set(); // anos que já tentaram a BrasilAPI nesta sessão
  let feriadoAlvo = null;    // feriado aberto na folha (null = novo)
  let calMes = null;         // mês escolhido no calendário ("AAAA-MM"); null = os meses do período

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const tudoPronto = () => pronto.contas && pronto.meses;
  const periodos = () => listaPeriodos(meses);
  const dois = (n) => String(n).padStart(2, "0");

  function nacionaisDoAno(ano) {
    if (!nacionais[ano]) {
      let guardado = null;
      try { guardado = JSON.parse(localStorage.getItem(`conexoes-feriados-${ano}`)); } catch (_) { /* sem cache */ }
      nacionais[ano] = guardado || feriadosNacionaisCalculados(ano);
    }
    return nacionais[ano];
  }
  const feriadosMes = (ym) => feriadosDoMes(ym, nacionaisDoAno(Number(ym.slice(0, 4))), manuais);
  const feriadosPeriodo = (p) =>
    mesesEntre(p.inicio, p.fim).flatMap(feriadosMes).filter((f) => periodoContem(p, f.data));
  const dados = (p) => ({ contas, periodos: periodos(), gastos, feriados: datasQueContam(feriadosPeriodo(p)) });

  // Só vai à internet quando o valor por dia útil está ligado.
  function atualizarFeriadosNacionais(p) {
    if (!usarDias || !p) return;
    const anos = new Set([Number(p.inicio.slice(0, 4)), Number(p.fim.slice(0, 4))]);
    if (calMes) anos.add(Number(calMes.slice(0, 4)));
    for (const ano of anos) {
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

  function falha(e) {
    console.error(e);
    contexto.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore.");
  }
  const executar = (fn) => Promise.resolve().then(fn).catch(falha);

  // ----- Desenho -----
  function escolher(id) {
    selecao.id = id;
    calMes = null;
    renderizar();
    if (contexto.aoPeriodo) contexto.aoPeriodo();
  }

  function navegacao(lista, p) {
    return navegacaoPeriodos({
      periodos: lista, sel: p, aoEscolher: escolher,
      aoNovo: () => abrirPeriodo(null), aoEditar: (x) => abrirPeriodo(x)
    });
  }

  // Avisos de marco: metade das contas pagas e tudo pago. A primeira vez que um período aparece só guarda a base.
  const pagasVistas = new Map();
  function avisarMarcos(p, r) {
    if (!r.qtdContas) return;
    const agora = r.qtdPagas / r.qtdContas;
    const antes = pagasVistas.get(p.id);
    pagasVistas.set(p.id, agora);
    if (antes === undefined) return;
    if (agora === 1 && antes < 1) contexto.aviso("Tudo pago neste período. Parabéns!");
    else if (agora >= 0.5 && antes < 0.5) contexto.aviso("Metade das contas já está paga");
  }

  function renderizar() {
    const caixa = $("ct-conteudo");
    if (!caixa) return;
    if (!tudoPronto()) {
      caixa.replaceChildren(h("div", { class: "cartao ct-carregando" }, h("div", { class: "spinner", "aria-label": "Carregando" })));
      contexto.aoResumo(null);
      if (contexto.aoSerie) contexto.aoSerie([]);
      return;
    }
    const lista = periodos();
    const p = resolverSelecionado(lista);
    const hoje = periodoDeHoje(lista);
    contexto.aoResumo(hoje
      ? { ...calcularPeriodo(hoje, dados(hoje)), quantidadeContas: contas.length }
      : { semPeriodo: true, quantidadeContas: contas.length });
    if (contexto.aoSerie) contexto.aoSerie(serieDePeriodos(lista, { contas, gastos }));
    if (!p) {
      caixa.replaceChildren(navegacao(lista, null));
      return;
    }
    const rSel = calcularPeriodo(p, dados(p));
    avisarMarcos(p, rSel);
    caixa.replaceChildren(navegacao(lista, p), ...corpo(rSel, p));
    atualizarFeriadosNacionais(p);
  }

  function corpo(r, p) {
    return [
      ...(dividasAntigas.length ? [cartaoMigracao()] : []),
      resumo(r, p),
      ...(usarDias ? [calendario(p)] : []),
      secao("Contas fixas", r.fixas, linhasContas(r, "fixa"), "Nenhuma conta fixa neste período."),
      secao("Contas variáveis", r.variaveis, linhasContas(r, "variavel"), "Nenhuma conta variável neste período."),
      secao("Cartões e empréstimos", r.parceladas, linhasContas(r, "parcelada"), "Nenhuma parcela vence neste período. Crie uma conta do tipo Parcelada."),
      secao("Imprevistos", r.teto, [linhaTeto(r)]),
      h("button", { class: "btn-sutil", type: "button", onclick: () => abrirConta(null) }, "+ Adicionar conta")
    ];
  }

  function resumo(r, p) {
    const meta = (rotulo, valor) => h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, valor));
    const valor = h("div", { class: "rd-valor" });
    animarValor(valor, "contas-hero", r.total);
    const preenchido = h("span", {});
    animarLargura(preenchido, "contas-hero", r.pagoPct);
    return h("div", { class: "cartao resumo-div" },
      h("div", { class: "rd-rotulo" }, `Total de ${rotuloPeriodo(p)}`),
      valor,
      h("div", { class: "rd-pago" },
        h("div", { class: "rd-pago-txt" },
          h("span", {}, r.qtdContas ? `${r.qtdPagas} de ${r.qtdContas} ${r.qtdContas === 1 ? "conta paga" : "contas pagas"}` : "Nenhuma conta neste período"),
          h("strong", {}, `${r.pagoPct}%`)),
        h("div", { class: "barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.pagoPct), "aria-label": "Quanto das contas já foi pago" },
          preenchido)),
      h("div", { class: "rd-meta" },
        meta("Já pago", reais(r.pago)),
        meta("Falta pagar", reais(r.faltaPagar)),
        usarDias ? meta("Por dia útil", reais(r.porDia)) : null,
        usarDias ? meta("Dias úteis no período", String(r.dias)) : null,
        meta("Com o gasto real", reais(r.totalReal))),
      h("div", { class: "rd-nota" },
        "O total soma as contas e o limite de imprevistos cheio. Marque cada conta como paga na lista. \"Com o gasto real\" troca o limite pelo que já foi gasto dele." +
        (usarDias ? ` O valor por dia útil é o total dividido pelos ${r.dias} dias úteis do período (segunda a sábado, sem os feriados).` : ""))
    );
  }

  // Escolha do mês do calendário: setas, lista de meses (1 ano atrás até 3 anos à frente) e volta ao período.
  function navegacaoCalendario(p) {
    const meses_ = mesesEntre(p.inicio, p.fim);
    const atual = calMes || meses_[0];
    const base = hojeIso().slice(0, 7);
    const opcoes = [];
    for (let i = -12; i <= 36; i++) opcoes.push(somarMeses(base, i));
    if (!opcoes.includes(atual)) opcoes.push(atual);
    opcoes.sort();
    const ir = (n) => {
      const ref = calMes || (n > 0 ? meses_[meses_.length - 1] : meses_[0]);
      calMes = somarMeses(ref, n);
      renderizar();
    };
    return h("div", { class: "cal-nav" },
      h("button", { class: "mes-seta", type: "button", "aria-label": "Mês anterior", onclick: () => ir(-1), html: icone("esq", 20) }),
      h("label", { class: "mes-escolha" },
        h("span", { class: "mes-nome" }, calMes ? nomeMes(calMes) : meses_.length > 1 ? `${nomeMes(meses_[0])} e ${NOMES_MESES[Number(meses_[1].slice(5)) - 1]}` : nomeMes(meses_[0])),
        h("span", { class: "mes-dica" }, calMes ? "Toque para escolher o mês" : "Período atual · toque para escolher o mês"),
        h("select", { class: "mes-select", "aria-label": "Escolher o mês do calendário", onchange: (e) => { calMes = e.target.value; renderizar(); } },
          opcoes.map((ym) => h("option", { value: ym, selected: ym === atual }, nomeMes(ym))))),
      h("button", { class: "mes-seta", type: "button", "aria-label": "Próximo mês", onclick: () => ir(1), html: icone("dir", 20) }),
      calMes ? h("button", { class: "btn-sutil cal-volta", type: "button", onclick: () => { calMes = null; renderizar(); } }, "Voltar ao período") : null);
  }

  // ----- Calendário e feriados (só com o valor por dia útil ligado) -----
  function calendario(p) {
    const lista = calMes ? feriadosMes(calMes) : feriadosPeriodo(p);
    const porData = new Map(lista.map((f) => [f.data, f]));
    const hojeI = hojeIso();
    const alertas = feriadosEmDiaDeSemana(lista);
    const onde = calMes ? "neste mês" : "neste período";

    const aviso = alertas.length
      ? h("div", { class: "cal-aviso" },
          h("strong", {}, alertas.length === 1 ? "Atenção: 1 feriado de segunda a sexta" : `Atenção: ${alertas.length} feriados de segunda a sexta`),
          h("span", {}, alertas.map((f) => `${DIAS_SEMANA[f.diaSemana]}, ${dataCurta(f.data)} (${f.nome})`).join(" · ")))
      : h("div", { class: "cal-aviso ok" }, `Nenhum feriado de segunda a sexta ${onde}.`);

    const cabecalho = ["D", "S", "T", "Q", "Q", "S", "S"].map((l) => h("span", { class: "cal-cab" }, l));
    const mesesDoPeriodo = calMes ? [calMes] : mesesEntre(p.inicio, p.fim);
    const blocos = mesesDoPeriodo.map((ym) => {
      const dias = gradeDoMes(ym).map((d) => {
        if (!d) return h("span", { class: "cal-vazio" });
        const data = `${ym}-${dois(d)}`;
        const fora = !calMes && !periodoContem(p, data);
        const f = fora ? null : porData.get(data);
        const dow = diaDaSemana(data);
        const classes = ["cal-dia"];
        if (dow === 0) classes.push("domingo");
        if (fora) classes.push("fora");
        if (f) classes.push(f.conta ? "feriado" : "isento");
        if (data === hojeI) classes.push("hoje");
        return h("button", {
          class: classes.join(" "), type: "button", disabled: fora,
          "aria-label": `${d} de ${nomeMes(ym)}${f ? `, ${f.nome}` : ""}`,
          onclick: () => abrirFeriado(data, f || null)
        }, String(d));
      });
      return h("div", { class: "cal-mes" },
        mesesDoPeriodo.length > 1 && !calMes ? h("p", { class: "cal-mes-nome" }, nomeMes(ym)) : null,
        h("div", { class: "cal-grade" }, cabecalho, dias));
    });

    const linhas = lista.map((f) => h("li", {},
      h("button", { class: "ct-linha", type: "button", onclick: () => abrirFeriado(f.data, f) },
        h("span", { class: "ct-ico", html: icone("calendario", 20) }),
        h("span", { class: "ct-info" },
          h("span", { class: "ct-nome" }, f.nome),
          h("span", { class: "ct-sub" }, `${DIAS_SEMANA[f.diaSemana]}, ${dataCurta(f.data)} · ${f.origem === "nacional" ? "nacional" : "adicionado por vocês"}`)),
        h("span", { class: "ct-valor cal-efeito" }, !f.conta ? "não desconta" : f.diaSemana === 0 ? "domingo" : "−1 dia útil"),
        h("span", { class: "ct-seta", html: icone("dir", 16) }))));

    const descontados = lista.filter((f) => f.conta && f.diaSemana !== 0).length;
    return h("article", { class: "cartao ct-secao" },
      h("header", { class: "ct-topo" }, h("h3", {}, "Calendário e feriados"), h("span", { class: "ct-subtotal" }, descontados === 1 ? "1 dia descontado" : `${descontados} dias descontados`)),
      navegacaoCalendario(p),
      aviso,
      blocos,
      calMes ? h("p", { class: "cal-uteis" }, h("strong", {}, String(diasUteisDoMes(calMes, datasQueContam(lista)))), " dias úteis em ", nomeMes(calMes), " (segunda a sábado, sem feriados)") : null,
      linhas.length ? h("ul", { class: "ct-lista" }, linhas) : null,
      h("button", { class: "btn-sutil cal-add", type: "button", onclick: () => abrirFeriado(null, null) }, "+ Adicionar feriado ou folga"),
      h("p", { class: "ct-vazio cal-nota" }, "Feriados nacionais vêm da BrasilAPI (ou são calculados pelo app, sem internet). Toque num dia para adicionar uma folga ou deixar de descontar um feriado."));
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

  // Linha com o círculo de "paga" à esquerda e o resto abrindo o detalhe da conta.
  function linhasContas(r, tipo) {
    return r.itens.filter((i) => i.conta.tipo === tipo).map((i) => {
      const venc = i.conta.dia ? `vence ${dataCurta(i.data)}` : null;
      let resto;
      if (tipo === "parcelada") resto = i.parcelas.map((x) => `${x.it.nome} ${x.k}/${x.it.total}`).join(" · ");
      else if (i.estimada) resto = [h("span", { class: "chip atencao" }, "Estimada"), " toque para informar"];
      else if (tipo === "fixa") resto = i.alterada ? "valor ajustado só neste período" : "todo mês";
      else resto = "valor informado";
      const sub = venc ? [`${venc} · `, ...[].concat(resto)] : [].concat(resto);
      return h("div", { class: "ct-item" + (i.paga ? " paga" : "") },
        h("button", {
          type: "button", class: "chk" + (i.paga ? " on" : "") + (acabouDeMarcar(i.conta.id, i.paga) ? " acabou" : ""), role: "checkbox",
          "aria-checked": String(i.paga), "aria-label": `${i.conta.nome}: marcar como paga`,
          disabled: !!i.automatica, title: i.automatica ? "Parcelas já pagas antes do cadastro" : null,
          html: icone("check", 16), onclick: () => marcarPaga(i)
        }),
        h("button", { class: "ct-linha", type: "button", onclick: () => (tipo === "parcelada" ? abrirConta(i.conta) : abrirValor(i)) },
          h("span", { class: "ct-info" }, h("span", { class: "ct-nome" }, i.conta.nome), h("span", { class: "ct-sub" }, sub)),
          h("span", { class: "ct-valor" }, reais(i.valor)),
          h("span", { class: "ct-seta", html: icone("dir", 16) })));
    });
  }

  // Última conta marcada agora: o check dela ganha o pulso (o desenho da tela é refeito a cada mudança).
  let marcadaAgora = null;
  const acabouDeMarcar = (id, paga) => paga && marcadaAgora && marcadaAgora.id === id && Date.now() - marcadaAgora.t < 900;

  function marcarPaga(item) {
    const p = periodoAtual();
    if (!p) return;
    if (!item.paga) marcadaAgora = { id: item.conta.id, t: Date.now() };
    contexto.aviso(item.paga ? "Pagamento desmarcado" : "Conta marcada como paga");
    executar(() => backend().salvarPaga(casa(), p.id, item.conta.id, !item.paga));
  }

  function marcarTetoPago(r) {
    const p = periodoAtual();
    if (!p) return;
    if (!r.tetoPago) marcadaAgora = { id: "imprevistos", t: Date.now() };
    contexto.aviso(r.tetoPago ? "Pagamento desmarcado" : "Imprevistos marcado como pago");
    executar(() => backend().salvarPaga(casa(), p.id, "imprevistos", !r.tetoPago));
  }

  function linhaTeto(r) {
    const pago = r.tetoPago;
    return h("div", { class: "ct-item" + (pago ? " paga" : "") },
      h("button", {
        type: "button", class: "chk" + (pago ? " on" : "") + (acabouDeMarcar("imprevistos", pago) ? " acabou" : ""), role: "checkbox",
        "aria-checked": String(pago), "aria-label": "Imprevistos: marcar como pago",
        html: icone("check", 16), onclick: () => marcarTetoPago(r)
      }),
      h("button", { class: "ct-linha", type: "button", onclick: () => contexto.abrirTetoPagina() },
        h("span", { class: "ct-info" },
          h("span", { class: "ct-nome" }, "Limite do período"),
          h("span", { class: "ct-sub" }, `Gasto: ${reais(r.gastoTeto)} · ver gastos`)),
        h("span", { class: "ct-valor" }, reais(r.teto)),
        h("span", { class: "ct-seta", html: icone("dir", 16) })));
  }

  // ----- Dívidas do modelo antigo -> contas parceladas -----
  const pagasSeguidas = (pagas) => { let n = 0; const set = new Set(pagas || []); while (set.has(n + 1)) n++; return n; };

  function cartaoMigracao() {
    return h("article", { class: "cartao ct-migrar" },
      h("h3", {}, "Suas dívidas antigas"),
      h("p", { class: "sub" }, `Encontramos ${dividasAntigas.length} ${dividasAntigas.length === 1 ? "dívida cadastrada" : "dívidas cadastradas"} do jeito antigo. Converta em contas parceladas: o checklist passa a ser aqui e a aba Dívidas continua mostrando o andamento.`),
      h("button", { class: "btn primario", type: "button", onclick: converterDividas }, "Converter em contas"));
  }

  function converterDividas() {
    const grupos = new Map();
    for (const d of dividasAntigas) {
      const nome = ((d.grupo || "").trim() || d.nome);
      const chave = nome.toLocaleLowerCase("pt-BR");
      if (!grupos.has(chave)) grupos.set(chave, { nome, itens: [] });
      grupos.get(chave).itens.push(d);
    }
    const antigas = [...dividasAntigas];
    contexto.aviso("Convertendo as dívidas em contas…");
    executar(async () => {
      for (const g of grupos.values()) {
        const dia = g.itens.map((d) => Number(d.diaVencimento)).find((n) => n >= 1 && n <= 31) || null;
        const parcelas = g.itens.map((d) => ({
          id: idCurto(), nome: d.nome, valorCentavos: d.valorCentavos, total: d.totalParcelas,
          mesInicio: d.mesInicio, pagasAntes: Math.min(d.totalParcelas, pagasSeguidas(d.pagas))
        }));
        const inicio = parcelas.map((x) => x.mesInicio).sort()[0];
        await backend().salvarConta(casa(), null, { nome: g.nome, tipo: "parcelada", valorCentavos: 0, inicio, fim: null, dia, parcelas });
      }
      for (const d of antigas) await backend().excluirDivida(casa(), d.id);
      contexto.aviso("Dívidas convertidas em contas");
    });
  }

  // ----- Folhas (formulários que sobem de baixo) -----
  const FOLHAS = ["folha-conta", "folha-valor", "folha-teto", "folha-feriado", "folha-periodo"];
  function fecharFolhas() {
    FOLHAS.forEach((id) => { $(id).hidden = true; });
    contaForm = null;
    valorAlvo = null;
    periodoAlvo = null;
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
  const periodoAtual = () => resolverSelecionado(periodos());

  // Período: criar ou editar as datas
  function abrirPeriodo(p) {
    fecharFolhas();
    periodoAlvo = { p };
    confirmandoPeriodo = false;
    fimMexido = !!p;
    mostrarErro("erro-periodo", "");
    const lista = periodos();
    let ini, fim;
    if (p) { ini = p.inicio; fim = p.fim; }
    else if (lista.length) { ({ inicio: ini, fim } = periodoSeguinte(lista[lista.length - 1])); }
    else { ini = hojeIso(); fim = somarDias(somarMesesData(ini, 1), -1); }
    $("periodo-titulo").textContent = p ? "Editar período" : "Novo período";
    $("pr-inicio").value = ini;
    $("pr-fim").value = fim;
    const botao = $("btn-excluir-periodo");
    botao.hidden = !p;
    botao.textContent = "Excluir";
    botao.classList.remove("confirmar");
    $("periodo-dica").textContent = p
      ? "Mudar as datas não apaga nada: as contas e os gastos do período continuam. Só passam a valer no novo intervalo."
      : "Escolha o primeiro e o último dia. Por exemplo, de 20/10 a 19/11. As contas aparecem no período em que o dia de vencimento cai.";
    $("folha-periodo").hidden = false;
  }

  function salvarPeriodo() {
    const alvo = periodoAlvo;
    if (!alvo) return;
    const inicio = $("pr-inicio").value;
    const fim = $("pr-fim").value;
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(inicio) || !re.test(fim)) return mostrarErro("erro-periodo", "Escolha o primeiro e o último dia do período.");
    if (fim < inicio) return mostrarErro("erro-periodo", "O período não pode terminar antes de começar.");
    if (diasEntre(inicio, fim) > 100) return mostrarErro("erro-periodo", "O período está muito longo. Confira as datas.");
    const choque = periodos().find((q) => (!alvo.p || q.id !== alvo.p.id) && inicio <= q.fim && q.inicio <= fim);
    if (choque) return mostrarErro("erro-periodo", `Essas datas se misturam com o período de ${rotuloPeriodo(choque)}.`);
    const existentes = new Set(Object.keys(meses));
    let id = alvo.p ? alvo.p.id : inicio;
    if (!alvo.p) { let n = 2; while (existentes.has(id)) id = `${inicio}-${n++}`; }
    fecharFolhas();
    selecao.id = id;
    contexto.aviso(alvo.p ? "Período atualizado" : "Período criado");
    executar(() => backend().salvarPeriodo(casa(), id, { inicio, fim }));
    if (contexto.aoPeriodo) contexto.aoPeriodo();
  }

  function excluirPeriodo() {
    const alvo = periodoAlvo;
    if (!alvo || !alvo.p) return;
    const botao = $("btn-excluir-periodo");
    if (!confirmandoPeriodo) {
      confirmandoPeriodo = true;
      botao.textContent = "Confirmar exclusão";
      botao.classList.add("confirmar");
      mostrarErro("erro-periodo", "Excluir apaga os valores informados e o limite de imprevistos deste período. As contas e os gastos continuam existindo.");
      return;
    }
    const id = alvo.p.id;
    fecharFolhas();
    if (selecao.id === id) selecao.id = null;
    contexto.aviso("Período excluído");
    executar(() => backend().excluirPeriodo(casa(), id));
    if (contexto.aoPeriodo) contexto.aoPeriodo();
  }

  // Cadastro da conta
  const DICAS_TIPO = {
    fixa: "Fixa: o valor é o mesmo todo mês, como aluguel e internet.",
    variavel: "Variável: o valor muda a cada mês, como energia e água. Você informa o valor real quando a conta chegar.",
    parcelada: "Parcelada: cartão, empréstimo ou financiamento. Coloque as parcelas dentro da conta e marque a conta como paga todo mês. As parcelas aparecem sozinhas na aba Dívidas."
  };

  function definirTipo(tipo) {
    tipoForm = tipo;
    document.querySelectorAll("#cc-tipo [data-tipo]").forEach((b) => {
      const ativo = b.dataset.tipo === tipo;
      b.classList.toggle("ativo", ativo);
      b.setAttribute("aria-pressed", String(ativo));
    });
    $("cc-valor-rotulo").textContent = tipo === "fixa" ? "Valor (R$)" : "Valor estimado (R$)";
    $("cc-tipo-dica").textContent = DICAS_TIPO[tipo];
    $("cc-bloco-valor").hidden = tipo === "parcelada";
    $("cc-bloco-vigencia").hidden = tipo === "parcelada";
    $("cc-bloco-parcelas").hidden = tipo !== "parcelada";
    if (tipo === "parcelada" && !linhasParcela.length) adicionarLinhaParcela(null);
  }

  // ----- Editor de parcelas (conta parcelada) -----
  // Em cada linha: nome, valor, nº de parcelas e quantas já foram pagas. "Já pagas" conta a partir do mês em que a conta cai
  // no período aberto: se faltam 4 parcelas e uma vence neste período, já pagas = total - 4.
  function adicionarLinhaParcela(pc, pagasAtuais, proximaMes) {
    const campo = (rotulo, atributos) => {
      const el = h("input", { type: "text", autocomplete: "off", ...atributos });
      return { el, no: h("label", { class: "pc-campo" }, h("span", {}, rotulo), el) };
    };
    const nome = campo("O que é", { maxlength: "40", placeholder: "Ex.: Celular, empréstimo", value: pc ? pc.nome : "" });
    const valor = campo("Valor da parcela (R$)", { inputmode: "decimal", placeholder: "0,00", value: pc ? paraCampo(pc.valorCentavos) : "" });
    const total = campo("Nº de parcelas", { inputmode: "numeric", maxlength: "3", placeholder: "7", value: pc ? String(pc.total) : "" });
    const pagas = campo("Já pagas", { inputmode: "numeric", maxlength: "3", placeholder: "0", value: pc ? String(pagasAtuais) : "" });
    const linhaObj = { pc, pagasAtuais: pc ? pagasAtuais : null, proximaMes: proximaMes || null, nome: nome.el, valor: valor.el, total: total.el, pagas: pagas.el };
    const no = h("div", { class: "pc-linha" },
      nome.no,
      h("div", { class: "pc-trio" }, valor.no, total.no, pagas.no),
      h("button", {
        type: "button", class: "pc-remover", "aria-label": "Remover esta parcela",
        onclick: () => { linhasParcela = linhasParcela.filter((x) => x !== linhaObj); no.remove(); }
      }, "Remover parcela"));
    linhaObj.no = no;
    linhasParcela.push(linhaObj);
    $("cc-parcelas").append(no);
    return linhaObj;
  }

  function carregarParcelas(c) {
    linhasParcela = [];
    $("cc-parcelas").replaceChildren();
    if (!c || c.tipo !== "parcelada") return;
    const derivadas = derivarDividas([c], periodos());
    for (const pc of c.parcelas || []) {
      const d = derivadas.find((x) => x.id === `${c.id}:${pc.id}`);
      const pagas = d ? d.pagas.length : (pc.pagasAntes || 0);
      let primeira = 1;
      while (d && d.pagas.includes(primeira)) primeira++;
      adicionarLinhaParcela(pc, pagas, somarMeses(pc.mesInicio, primeira - 1));
    }
  }

  function abrirConta(c) {
    fecharFolhas();
    contaForm = c;
    confirmandoExclusao = false;
    mostrarErro("erro-conta", "");
    $("conta-titulo").textContent = c ? "Editar conta" : "Nova conta";
    $("cc-nome").value = c ? c.nome : "";
    linhasParcela = [];
    $("cc-parcelas").replaceChildren();
    carregarParcelas(c);
    definirTipo(c ? c.tipo : "fixa");
    $("cc-valor").value = c && c.tipo !== "parcelada" ? paraCampo(c.valorCentavos) : "";
    $("cc-dia").value = c && c.dia ? String(c.dia) : "";
    const p = periodoAtual();
    const [ai, mi] = (c && c.tipo !== "parcelada" ? c.inicio : (p ? p.inicio : hojeIso()).slice(0, 7)).split("-").map(Number);
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

  const idCurto = () => "p" + Math.random().toString(36).slice(2, 8);

  // Lê e confere as linhas do editor. Devolve a lista de parcelas ou uma mensagem de erro.
  function lerParcelas(dia) {
    if (!linhasParcela.length) return { erro: "Adicione pelo menos uma parcela." };
    const p = periodoAtual();
    const base = ((p && dataDaConta({ tipo: "parcelada", dia }, p)) || (p ? p.inicio : hojeIso())).slice(0, 7);
    const lista = [];
    for (const L of linhasParcela) {
      const nome = L.nome.value.trim();
      const valorCentavos = parseReais(L.valor.value);
      const total = parseInt(L.total.value, 10);
      const pagasTexto = L.pagas.value.trim();
      const pagas = pagasTexto === "" ? 0 : parseInt(pagasTexto, 10);
      if (!nome) return { erro: "Diga o que é cada parcela, por exemplo Celular." };
      if (!(valorCentavos > 0)) return { erro: `Informe o valor da parcela de ${nome}.` };
      if (!(total >= 1 && total <= 120)) return { erro: `O número de parcelas de ${nome} deve ficar entre 1 e 120.` };
      if (!(pagas >= 0 && pagas <= total)) return { erro: `Em ${nome}, as parcelas já pagas devem ficar entre 0 e ${total}.` };
      if (L.pc && pagas === L.pagasAtuais) {
        // Não mexeu nas pagas: mantém o histórico exatamente como está.
        lista.push({ ...L.pc, nome, valorCentavos, total });
      } else {
        // Novo, ou corrigiu as pagas: a próxima parcela em aberto cai no mês de referência.
        const referencia = L.pc ? L.proximaMes : base;
        lista.push({ id: L.pc ? L.pc.id : idCurto(), nome, valorCentavos, total, mesInicio: somarMeses(referencia, -pagas), pagasAntes: pagas });
      }
    }
    return { lista };
  }

  function salvarConta() {
    const nome = $("cc-nome").value.trim();
    const diaTexto = $("cc-dia").value.trim();
    const dia = diaTexto === "" ? null : parseInt(diaTexto, 10);
    if (!nome) return mostrarErro("erro-conta", "Dê um nome para a conta.");
    if (dia !== null && !(dia >= 1 && dia <= 31)) return mostrarErro("erro-conta", "O dia do vencimento deve ficar entre 1 e 31, ou em branco.");

    let dadosConta;
    if (tipoForm === "parcelada") {
      const r = lerParcelas(dia);
      if (r.erro) return mostrarErro("erro-conta", r.erro);
      const inicio = r.lista.map((x) => x.mesInicio).sort()[0];
      dadosConta = { nome, tipo: "parcelada", valorCentavos: 0, inicio, fim: null, dia, parcelas: r.lista };
    } else {
      const valorCentavos = parseReais($("cc-valor").value);
      const inicio = `${$("cc-inicio-ano").value}-${dois($("cc-inicio-mes").value)}`;
      const fim = $("cc-fim-ano").value ? `${$("cc-fim-ano").value}-${dois($("cc-fim-mes").value)}` : null;
      if (!(valorCentavos > 0)) return mostrarErro("erro-conta", "Informe o valor, por exemplo 120,00.");
      if (fim && fim < inicio) return mostrarErro("erro-conta", "A conta não pode terminar antes de começar.");
      dadosConta = { nome, tipo: tipoForm, valorCentavos, inicio, fim, dia, parcelas: [] };
    }
    const id = contaForm ? contaForm.id : null;
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
    contexto.aviso("Conta excluída de todos os períodos");
    executar(() => backend().excluirConta(casa(), id));
  }

  // Valor da conta neste período
  function abrirValor(item) {
    fecharFolhas();
    valorAlvo = { conta: item.conta, alterada: item.alterada };
    mostrarErro("erro-valor", "");
    $("valor-titulo").textContent = item.conta.nome;
    $("valor-rotulo").textContent = `Valor neste período (R$)`;
    $("cv-valor").value = paraCampo(item.valor);
    $("valor-dica").textContent = `Valor padrão da conta: ${reais(item.conta.valorCentavos)}. ` +
      (item.conta.tipo === "variavel"
        ? "Informe o valor real quando a conta chegar."
        : "Use para um reajuste só deste período.");
    $("btn-valor-padrao").hidden = !item.alterada;
    $("folha-valor").hidden = false;
    requestAnimationFrame(() => $("cv-valor").select());
  }

  function salvarValor() {
    if (!valorAlvo) return;
    const centavos = parseReais($("cv-valor").value);
    if (!(centavos >= 0)) return mostrarErro("erro-valor", "Informe o valor, por exemplo 180,00.");
    const { conta } = valorAlvo;
    const p = periodoAtual();
    if (!p) return;
    // Conta fixa com o mesmo valor do padrão não precisa de ajuste.
    const gravar = conta.tipo === "fixa" && centavos === conta.valorCentavos ? null : centavos;
    fecharFolhas();
    contexto.aviso("Valor salvo");
    executar(() => backend().salvarValorMes(casa(), p.id, conta.id, gravar));
  }

  function voltarAoPadrao() {
    if (!valorAlvo) return;
    const { conta } = valorAlvo;
    const p = periodoAtual();
    if (!p) return;
    fecharFolhas();
    contexto.aviso("Voltou ao valor padrão");
    executar(() => backend().salvarValorMes(casa(), p.id, conta.id, null));
  }

  // Teto de gastos
  function abrirTeto() {
    const p = periodoAtual();
    if (!p) { contexto.aviso("Crie um período antes de alterar o limite"); return; }
    fecharFolhas();
    mostrarErro("erro-teto", "");
    $("teto-rotulo").textContent = `Limite a partir de ${rotuloPeriodo(p)} (R$)`;
    $("ctt-valor").value = paraCampo(tetoDoPeriodo(p, periodos()));
    $("folha-teto").hidden = false;
    requestAnimationFrame(() => $("ctt-valor").select());
  }

  function salvarTeto() {
    const centavos = parseReais($("ctt-valor").value);
    if (!(centavos >= 0)) return mostrarErro("erro-teto", "Informe o valor do limite, por exemplo 500,00.");
    const p = periodoAtual();
    if (!p) return;
    fecharFolhas();
    contexto.aviso("Limite atualizado");
    executar(() => backend().salvarTeto(casa(), p.id, centavos));
  }

  // Feriado: novo, adicionado por vocês (editar/excluir) ou nacional (descontar ou não)
  function abrirFeriado(data, f) {
    fecharFolhas();
    feriadoAlvo = { data, f };
    mostrarErro("erro-feriado", "");
    const novo = !f;
    const p = periodoAtual();
    $("feriado-titulo").textContent = novo ? "Novo feriado ou folga" : f.nome;
    $("fr-data").value = data || (p && periodoContem(p, hojeIso()) ? hojeIso() : p ? p.inicio : hojeIso());
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
        : "Folga adicionada por vocês. Ela sai dos dias úteis do período.";
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

  // Ao mudar o início do período, o fim acompanha (um mês depois) até a pessoa mexer nele.
  $("pr-fim").addEventListener("input", () => { fimMexido = true; });
  $("pr-inicio").addEventListener("change", () => {
    const ini = $("pr-inicio").value;
    if (!fimMexido && /^\d{4}-\d{2}-\d{2}$/.test(ini)) $("pr-fim").value = somarDias(somarMesesData(ini, 1), -1);
  });

  $("btn-add-parcela").addEventListener("click", () => { const L = adicionarLinhaParcela(null); L.nome.focus(); });
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
  $("form-periodo").addEventListener("submit", (e) => { e.preventDefault(); salvarPeriodo(); });
  $("btn-excluir-periodo").addEventListener("click", excluirPeriodo);
  $("btn-excluir-conta").addEventListener("click", excluirConta);
  $("form-feriado").addEventListener("submit", (e) => { e.preventDefault(); salvarFeriado(); });
  $("btn-feriado-alt").addEventListener("click", alternarFeriado);
  $("btn-valor-padrao").addEventListener("click", voltarAoPadrao);
  $("btn-editar-conta").addEventListener("click", () => {
    if (valorAlvo) abrirConta(valorAlvo.conta);
  });

  renderizar();

  return {
    receberContas(lista) { contas = lista; pronto.contas = true; renderizar(); },
    definirDiasUteis(ativo) { if (usarDias !== ativo) { usarDias = ativo; renderizar(); } },
    receberGastos(lista) { gastos = lista; renderizar(); },
    editarTeto() { abrirTeto(); },
    receberDividasAntigas(lista) { dividasAntigas = lista || []; renderizar(); },
    contas() { return contas; },
    abrirContaPorId(id) { const c = contas.find((x) => x.id === id); if (c) abrirConta(c); },
    novoPeriodo() { abrirPeriodo(null); },
    editarPeriodo(p) { abrirPeriodo(p); },
    atualizar() { renderizar(); },
    receberFeriados(mapa) { manuais = mapa || {}; renderizar(); },
    receberMeses(mapa) { meses = mapa; pronto.meses = true; renderizar(); },
    limpar() {
      contas = []; meses = {}; manuais = {}; gastos = []; dividasAntigas = [];
      pronto.contas = pronto.meses = false;
      selecao.id = null;
      fecharFolhas();
      renderizar();
    }
  };
}
