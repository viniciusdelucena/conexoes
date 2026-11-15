// Módulo Investimentos: quanto a casa tem investido, a evolução mês a mês, os aportes e as metas.
//
// Movimento: { id, tipo: "saldo" | "aporte", valorCentavos, data: "AAAA-MM-DD", nota, ordem }
//   "saldo"  = o total que a pessoa informou ter naquela data (já com rendimentos)
//   "aporte" = dinheiro novo colocado, que soma ao total
// Meta: { id, nome, alvoCentavos, prazo: "AAAA-MM-DD" | null }. Cada meta é medida pelo total investido.
// Os cálculos ficam em invest-calc.js e o gráfico em invest-grafico.js.

import { $, h, reais, animarValor, animarLargura, paraCampo, parseReais, mesCurto } from "./util.js";
import { icone } from "./icones.js";
import { estadoVazio } from "./vazio.js";
import { diaDaSemana, DIAS_SEMANA } from "./calendario.js";
import { hojeIso, dataCurta } from "./periodos.js";
import { situacao, serieMensal, ritmoMensal, progressoMeta, ordenarMetas, ordenarMovimentos, metaMaisProxima } from "./invest-calc.js";
import { montarGraficoInvest, comSinal } from "./invest-grafico.js";
import { esqueletoPagina } from "./esqueleto.js";

const LIMITE = 9999999999; // R$ 99.999.999,99
const VISIVEIS = 6;       // registros do histórico antes de "Ver todos"

const dataComAno = (iso) => dataCurta(iso) + (iso.slice(0, 4) === String(new Date().getFullYear()) ? "" : `/${iso.slice(0, 4)}`);
const fmtPct = (n) => (n > 0 ? "+" : "") + n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";

// contexto: { obterBackend, obterCasaId, aviso, aoResumo(resumo | null) }
export function configurarInvestimentos(contexto) {
  let movs = [];
  let metas = [];
  const pronto = { movs: false, metas: false };
  let animarProximo = false; // o gráfico anima ao entrar na tela, não a cada atualização
  let verTodos = false;

  let alvoMov = null;        // movimento aberto na folha (null = novo)
  let tipoMov = "aporte";
  let confirmandoMov = false;
  let alvoMeta = null;       // meta aberta na folha (null = nova)
  let confirmandoMeta = false;

  const backend = () => contexto.obterBackend();
  const casa = () => contexto.obterCasaId();
  const falha = (e) => { console.error(e); contexto.aviso("Não foi possível salvar. Confira a conexão e as regras do Firestore."); };
  const executar = (fn) => Promise.resolve().then(fn).catch(falha);

  // ----- Tela -----
  function renderizar() {
    const caixa = $("inv-conteudo");
    if (!caixa) return;
    if (!pronto.movs || !pronto.metas) {
      caixa.replaceChildren(esqueletoPagina());
      contexto.aoResumo(null);
      return;
    }
    const sit = situacao(movs);
    const ritmo = ritmoMensal(movs);
    const prox = metaMaisProxima(metas, sit.total);
    contexto.aoResumo(!sit.quantidade ? { vazio: true } : {
      vazio: false, total: sit.total, rendimento: sit.rendimento, temMetas: metas.length > 0,
      proxima: prox ? { nome: prox.nome, pct: progressoMeta(prox, sit.total, { ritmo }).pct } : null
    });
    const animar = animarProximo;
    animarProximo = false;

    const partes = [];
    if (!sit.quantidade) {
      partes.push(
        estadoVazio({
          ilustracao: "investimentos",
          titulo: "Acompanhe seus investimentos",
          texto: "Informe quanto você tem investido hoje. Depois, a cada aporte ou atualização, o app mostra a evolução e o caminho até suas metas.",
          botao: { texto: "Informar quanto tenho", aoClicar: () => abrirMov("saldo", null) }
        }),
        secaoMetas(sit, ritmo));
    } else {
      partes.push(hero(sit), acoes(), montarGraficoInvest(serieMensal(movs), { animar }), secaoMetas(sit, ritmo), historico());
    }
    caixa.replaceChildren(...partes);
  }

  function hero(sit) {
    const valor = h("div", { class: "rd-valor" });
    animarValor(valor, "inv-hero", sit.total);
    const item = (rotulo, v) => h("div", { class: "rd-item" }, h("small", {}, rotulo), h("strong", {}, v));
    const pct = sit.aportado > 0 ? ` · ${fmtPct(sit.rendimentoPct)}` : "";
    return h("div", { class: "cartao resumo-div inv-hero" },
      h("div", { class: "rd-rotulo" }, "Total investido"),
      valor,
      h("div", { class: "rd-meta" },
        item("Aportado", reais(sit.aportado)),
        item(`Rendimento${pct}`, comSinal(sit.rendimento))),
      sit.ultimoSaldoData ? h("p", { class: "rd-nota" }, `Último valor informado em ${dataComAno(sit.ultimoSaldoData)}`) : null);
  }

  function acoes() {
    return h("div", { class: "gt-acoes" },
      h("button", { class: "btn primario", type: "button", onclick: () => abrirMov("aporte", null) }, "+ Adicionar aporte"),
      h("button", { class: "btn", type: "button", onclick: () => abrirMov("saldo", null) }, "Atualizar valor"));
  }

  // ----- Metas -----
  function secaoMetas(sit, ritmo) {
    const lista = ordenarMetas(metas, sit.total);
    if (!lista.length) {
      return h("article", { class: "cartao ct-secao inv-metas" },
        h("header", { class: "ct-topo" }, h("h3", {}, "Metas")),
        h("p", { class: "sub inv-meta-vazio" }, "Defina quanto quer juntar e, se quiser, até quando. O app mostra o quanto falta e quanto guardar por mês."),
        h("button", { class: "btn inv-meta-criar", type: "button", onclick: () => abrirMeta(null) }, "Criar meta"));
    }
    return h("article", { class: "cartao ct-secao inv-metas" },
      h("header", { class: "ct-topo" },
        h("h3", {}, "Metas"),
        h("button", { class: "inv-link", type: "button", onclick: () => abrirMeta(null) }, "+ Nova meta")),
      ritmo > 0 && lista.some((m) => sit.total < m.alvoCentavos)
        ? h("p", { class: "sub pequeno inv-ritmo" }, `Ritmo atual: ${reais(ritmo)} de aportes por mês (média dos últimos meses). As previsões partem dele.`)
        : null,
      h("ul", { class: "ct-lista" }, lista.map((m) => linhaMeta(m, sit, ritmo))));
  }

  function linhaMeta(m, sit, ritmo) {
    const p = progressoMeta(m, sit.total, { ritmo });
    const preenchido = h("span", {});
    animarLargura(preenchido, `inv-meta-${m.id}`, p.pct);

    const status = [];
    if (p.atingida) {
      status.push(h("span", { class: "inv-meta-txt ok" }, `Alvo de ${reais(m.alvoCentavos)} alcançado`));
    } else {
      status.push(h("span", { class: "inv-meta-txt" }, `Faltam ${reais(p.falta)} de ${reais(m.alvoCentavos)}`));
      if (p.prazoMes) {
        status.push(h("span", { class: "ct-sub" }, p.mesesRestantes < 0
          ? `Prazo em ${mesCurto(p.prazoMes)} já passou`
          : `Prazo ${mesCurto(p.prazoMes)}` + (p.porMes ? ` · guardar ${reais(p.porMes)} por mês` : " · é este mês")));
      }
      const comSelo = (cls, rotulo, texto) => h("span", { class: "ct-sub inv-status" }, h("span", { class: `chip ${cls}` }, rotulo), h("span", {}, texto));
      const previsao = p.previsto ? `no ritmo atual chega em ${mesCurto(p.previsto)}` : "faça aportes para ver a previsão";
      if (p.situacao === "no-ritmo") status.push(comSelo("ok", "No ritmo", previsao));
      else if (p.situacao === "abaixo") status.push(comSelo("atencao", "Abaixo do ritmo", previsao));
      else if (p.situacao === "atrasada") status.push(comSelo("atencao", "Fora do prazo", previsao));
      else if (p.situacao === "sem-prazo") status.push(h("span", { class: "ct-sub" }, `No ritmo atual chega em ${mesCurto(p.previsto)}`));
      else if (p.prazoMes) status.push(comSelo("atencao", "Sem aportes recentes", "faça aportes para ver a previsão"));
      else status.push(h("span", { class: "ct-sub" }, "Faça aportes para ver a previsão"));
    }
    return h("li", {},
      h("button", { class: "inv-meta" + (p.atingida ? " atingida" : ""), type: "button", onclick: () => abrirMeta(m) },
        h("span", { class: "inv-meta-topo" },
          h("span", { class: "ct-nome" }, m.nome),
          p.atingida
            ? h("span", { class: "chip ok" }, "Atingida")
            : h("span", { class: "inv-pct" }, `${p.pct}%`)),
        h("span", { class: "inv-barra", "aria-hidden": "true" }, preenchido),
        ...status));
  }

  // ----- Histórico -----
  function historico() {
    const lista = ordenarMovimentos(movs).reverse();
    const mostrar = verTodos ? lista : lista.slice(0, VISIVEIS);
    const caixa = h("article", { class: "cartao ct-secao inv-hist" },
      h("header", { class: "ct-topo" },
        h("h3", {}, "Histórico"),
        h("span", { class: "inv-qtd" },`${lista.length} ${lista.length === 1 ? "registro" : "registros"}`)),
      h("ul", { class: "ct-lista" }, mostrar.map(linhaMov)),
      lista.length > VISIVEIS
        ? h("button", {
          class: "inv-link inv-mais", type: "button",
          onclick: () => { verTodos = !verTodos; caixa.replaceWith(historico()); }
        }, verTodos ? "Ver menos" : `Ver todos (${lista.length})`)
        : null);
    return caixa;
  }

  function linhaMov(m) {
    const aporte = m.tipo === "aporte";
    return h("li", {},
      h("button", { class: "ct-linha", type: "button", onclick: () => abrirMov(m.tipo, m) },
        h("span", { class: "ct-ico", html: icone(aporte ? "plus" : "invest", 20) }),
        h("span", { class: "ct-info" },
          h("span", { class: "ct-nome" }, aporte ? "Aporte" : "Atualização"),
          h("span", { class: "ct-sub" }, `${DIAS_SEMANA[diaDaSemana(m.data)]}, ${dataComAno(m.data)}` + (m.nota ? ` · ${m.nota}` : ""))),
        h("span", { class: "ct-valor" + (aporte ? " inv-aporte" : "") }, aporte ? `+${reais(m.valorCentavos)}` : reais(m.valorCentavos)),
        h("span", { class: "ct-seta", html: icone("dir", 16) })));
  }

  // ----- Folha: aporte ou valor informado -----
  const erroMov = (msg) => { const el = $("erro-invest"); el.textContent = msg || ""; el.hidden = !msg; };
  const erroMetaMsg = (msg) => { const el = $("erro-meta"); el.textContent = msg || ""; el.hidden = !msg; };

  function fecharFolhas() {
    $("folha-invest").hidden = true;
    $("folha-meta").hidden = true;
    alvoMov = null; alvoMeta = null; confirmandoMov = false; confirmandoMeta = false;
  }

  // Aporte de antes do último valor informado já está contado nesse valor: avisa para não parecer que "não fez nada".
  function atualizarAviso() {
    const el = $("invest-aviso");
    const ult = situacao(movs).ultimoSaldoData;
    const data = $("iv-data").value;
    const antes = tipoMov === "aporte" && ult && /^\d{4}-\d{2}-\d{2}$/.test(data) && data < ult;
    el.hidden = !antes;
    if (antes) el.textContent = `Esta data é anterior ao último valor informado (${dataCurta(ult)}), que já inclui esse dinheiro. O total de hoje não muda.`;
  }

  function abrirMov(tipo, mov) {
    fecharFolhas();
    tipoMov = tipo; alvoMov = mov;
    erroMov("");
    const aporte = tipo === "aporte";
    const primeira = !movs.length;
    $("invest-titulo").textContent = mov ? (aporte ? "Editar aporte" : "Editar atualização")
      : aporte ? "Adicionar aporte" : primeira ? "Quanto você tem investido?" : "Atualizar valor";
    $("invest-dica").textContent = aporte
      ? "Dinheiro novo que você colocou. Ele soma ao total investido."
      : primeira
        ? "Some tudo o que você tem investido hoje (banco, corretora, poupança). Depois é só atualizar quando quiser."
        : "Informe o total que você tem hoje, somando tudo com os rendimentos. O que mudou desde o último valor vira rendimento.";
    $("iv-valor-rotulo").textContent = aporte ? "Valor do aporte" : "Total que você tem";
    $("iv-valor").value = mov ? paraCampo(mov.valorCentavos) : "";
    $("iv-data").value = mov ? mov.data : hojeIso();
    $("iv-data").max = hojeIso();
    $("iv-nota").value = mov ? mov.nota || "" : "";
    const botao = $("btn-excluir-invest");
    botao.hidden = !mov; botao.textContent = "Excluir"; botao.classList.remove("confirmar");
    atualizarAviso();
    $("folha-invest").hidden = false;
    requestAnimationFrame(() => $("iv-valor").focus());
  }

  function salvarMov() {
    const aporte = tipoMov === "aporte";
    const valorCentavos = parseReais($("iv-valor").value);
    const data = $("iv-data").value;
    const nota = $("iv-nota").value.trim();
    if (aporte ? !(valorCentavos > 0) : !(valorCentavos >= 0)) {
      return erroMov(aporte ? "Informe o valor do aporte, por exemplo 500,00." : "Informe quanto você tem, por exemplo 12.500,00.");
    }
    if (valorCentavos > LIMITE) return erroMov("Esse valor está alto demais. Confira os números.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erroMov("Escolha a data.");
    if (data > hojeIso()) return erroMov("A data não pode ser no futuro.");
    const id = alvoMov ? alvoMov.id : null;
    const dados = id ? { valorCentavos, data, nota } : { tipo: tipoMov, valorCentavos, data, nota, ordem: Date.now() };
    fecharFolhas();
    contexto.aviso(id ? "Registro atualizado" : aporte ? "Aporte adicionado" : "Valor atualizado");
    animarProximo = false;
    executar(() => backend().salvarInvestimento(casa(), id, dados));
  }

  function excluirMov() {
    if (!alvoMov) return;
    const botao = $("btn-excluir-invest");
    if (!confirmandoMov) {
      confirmandoMov = true;
      botao.textContent = "Confirmar exclusão";
      botao.classList.add("confirmar");
      return;
    }
    const id = alvoMov.id;
    fecharFolhas();
    contexto.aviso("Registro excluído");
    executar(() => backend().excluirInvestimento(casa(), id));
  }

  // ----- Folha: meta -----
  function abrirMeta(m) {
    fecharFolhas();
    alvoMeta = m;
    erroMetaMsg("");
    $("meta-titulo").textContent = m ? "Editar meta" : "Nova meta";
    $("mt-nome").value = m ? m.nome : "";
    $("mt-valor").value = m ? paraCampo(m.alvoCentavos) : "";
    $("mt-prazo").value = m && m.prazo ? m.prazo : "";
    const botao = $("btn-excluir-meta");
    botao.hidden = !m; botao.textContent = "Excluir"; botao.classList.remove("confirmar");
    $("folha-meta").hidden = false;
    requestAnimationFrame(() => $("mt-nome").focus());
  }

  function salvarMeta() {
    const nome = $("mt-nome").value.trim();
    const alvoCentavos = parseReais($("mt-valor").value);
    const prazo = $("mt-prazo").value || null;
    if (!nome) return erroMetaMsg("Dê um nome para a meta, por exemplo “Reserva de emergência”.");
    if (!(alvoCentavos > 0)) return erroMetaMsg("Informe quanto quer juntar, por exemplo 20.000,00.");
    if (alvoCentavos > LIMITE) return erroMetaMsg("Esse valor está alto demais. Confira os números.");
    if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return erroMetaMsg("Escolha uma data válida para o prazo.");
    if (prazo && prazo < hojeIso() && (!alvoMeta || alvoMeta.prazo !== prazo)) return erroMetaMsg("O prazo precisa ser uma data futura.");
    const id = alvoMeta ? alvoMeta.id : null;
    fecharFolhas();
    contexto.aviso(id ? "Meta atualizada" : "Meta criada");
    executar(() => backend().salvarMeta(casa(), id, { nome, alvoCentavos, prazo }));
  }

  function excluirMeta() {
    if (!alvoMeta) return;
    const botao = $("btn-excluir-meta");
    if (!confirmandoMeta) {
      confirmandoMeta = true;
      botao.textContent = "Confirmar exclusão";
      botao.classList.add("confirmar");
      return;
    }
    const id = alvoMeta.id;
    fecharFolhas();
    contexto.aviso("Meta excluída");
    executar(() => backend().excluirMeta(casa(), id));
  }

  for (const folha of ["folha-invest", "folha-meta"]) {
    $(folha).addEventListener("click", (e) => { if (e.target.closest("[data-fechar]")) fecharFolhas(); });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (!$("folha-invest").hidden || !$("folha-meta").hidden)) fecharFolhas(); });
  $("form-invest").addEventListener("submit", (e) => { e.preventDefault(); salvarMov(); });
  $("form-meta").addEventListener("submit", (e) => { e.preventDefault(); salvarMeta(); });
  $("iv-data").addEventListener("input", atualizarAviso);
  // O erro some assim que a pessoa volta a mexer nos campos.
  $("form-invest").addEventListener("input", () => erroMov(""));
  $("form-meta").addEventListener("input", () => erroMetaMsg(""));
  $("btn-excluir-invest").addEventListener("click", excluirMov);
  $("btn-excluir-meta").addEventListener("click", excluirMeta);

  renderizar();

  return {
    receberInvestimentos(l) { movs = l; pronto.movs = true; renderizar(); },
    receberMetas(l) { metas = l; pronto.metas = true; renderizar(); },
    atualizar() { animarProximo = true; renderizar(); },
    limpar() { movs = []; metas = []; pronto.movs = pronto.metas = false; verTodos = false; fecharFolhas(); renderizar(); }
  };
}
