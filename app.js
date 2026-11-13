// Conexões: ponto de entrada.
// O app conversa com um "backend": o Firebase de verdade, ou uma demonstração em memória
// usada só para pré-visualizar as telas (só na pré-visualização).

import { $, reais, animarValor, mesCurto } from "./js/util.js";
import { rotuloPeriodo } from "./js/periodos.js";
import { montarProximos, montarMinigrafico } from "./js/inicio.js";
import { aplicarIcones } from "./js/icones.js";
import * as dividasUI from "./js/dividas.js";
import { configurarContas } from "./js/contas.js";
import { configurarGastos } from "./js/gastos.js";
import { configurarPainel } from "./js/painel.js";
import { configurarLogo, mostrarConexao } from "./js/logo.js";
import * as assistenteUI from "./js/assistente.js";




// A demonstração só existe na pré-visualização (que define __CONEXOES_DEMO__). O app instalado usa sempre o Firebase.
const DEMO = window.__CONEXOES_DEMO__ === true;

const MAX_MEMBROS = 2;

// Todo formulário em folha ganha o botão de fechar (×) no canto.
document.querySelectorAll(".folha-painel").forEach((p) => {
  const x = document.createElement("button");
  x.type = "button"; x.className = "folha-x"; x.setAttribute("data-fechar", ""); x.setAttribute("aria-label", "Fechar");
  x.innerHTML = '<span data-ico="x" data-tam="18"></span>';
  p.prepend(x);
});

// ---------- Utilidades de tela ----------
configurarLogo();
$("btn-simular-conexao").addEventListener("click", () => backend.simularParceiro && backend.simularParceiro());
assistenteUI.configurar({});
const TELAS = ["tela-carregando", "tela-login", "tela-casa"];

let telaAtual = "tela-carregando";
function mostrarTela(nome) {
  telaAtual = nome;
  for (const t of TELAS) $(t).hidden = t !== nome;
  $("app").hidden = nome !== "app";
  atualizarCorBarra();
}

// Cor das barras do sistema (status e navegação) acompanha a tela: sem "faixas" de outra cor.
function atualizarCorBarra() {
  const meta = document.getElementById("meta-cor");
  if (!meta) return;
  const attr = document.documentElement.getAttribute("data-theme");
  const escuro = attr ? attr === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const heroVermelho = telaAtual === "tela-login" || telaAtual === "tela-casa";
  meta.setAttribute("content", heroVermelho ? "#cd323f" : escuro ? "#141010" : "#f6f3f2");
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", atualizarCorBarra);

function mostrarErro(elId, msg) {
  const el = $(elId);
  el.textContent = msg || "";
  el.hidden = !msg;
}

let avisoTimer;
function aviso(msg) {
  const el = $("aviso");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 2600);
}

function gerarCodigo(tamanho = 8) {
  // Sem 0/O/1/I para não confundir na hora de digitar.
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

function traduzirErro(e) {
  const c = e && e.code;
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "Login cancelado.";
  if (c === "auth/popup-blocked") return "O navegador bloqueou a janela de login. Libere pop-ups e tente de novo.";
  if (c === "auth/unauthorized-domain") return "Este endereço não está nos domínios autorizados do Firebase.";
  if (c === "auth/network-request-failed") return "Sem conexão com a internet.";
  if (c === "permission-denied") return "Sem permissão. Confira se as regras do Firestore foram publicadas.";
  if (c === "unavailable") return "Sem conexão com o servidor. Tente de novo em instantes.";
  return "Algo deu errado. Tente novamente.";
}

// ---------- Estado ----------
let backend = null;
let usuario = null;
let casaId = null;
let cancelarCasa = null;
let cancelarDividas = null;
let cancelarContas = null;
let cancelarMeses = null;
let cancelarFeriados = null;
let cancelarGastos = null;

function pararObservadores() {
  if (cancelarCasa) { cancelarCasa(); cancelarCasa = null; }
  if (cancelarDividas) { cancelarDividas(); cancelarDividas = null; }
  if (cancelarContas) { cancelarContas(); cancelarContas = null; }
  if (cancelarMeses) { cancelarMeses(); cancelarMeses = null; }
  if (cancelarGastos) { cancelarGastos(); cancelarGastos = null; }
  if (cancelarFeriados) { cancelarFeriados(); cancelarFeriados = null; }
}

// ---------- Login e sessão ----------
$("btn-login").addEventListener("click", async () => {
  if (!backend) return;
  mostrarErro("erro-login", "");
  const btn = $("btn-login");
  btn.disabled = true;
  try {
    await backend.login();
  } catch (e) {
    console.error(e);
    mostrarErro("erro-login", traduzirErro(e));
  } finally {
    btn.disabled = false;
  }
});

async function sair() {
  pararObservadores();
  dividasUI.limpar();
  contasUI.limpar();
  gastosUI.limpar();
  painelUI.limpar();
  assistenteUI.limpar();
  casaId = null;
  if (backend) await backend.sair();
}
$("btn-sair").addEventListener("click", sair);
$("btn-sair-casa").addEventListener("click", sair);

async function aoMudarLogin(u) {
  usuario = u;
  if (!u) {
    mostrarTela("tela-login");
    return;
  }
  mostrarTela("tela-carregando");
  try {
    const id = await backend.casaDoUsuario(u.uid);
    if (id) {
      entrarNoApp(id);
    } else {
      $("nome-usuario").textContent = u.nome || u.email || "";
      mostrarErro("erro-casa", "");
      mostrarTela("tela-casa");
    }
  } catch (e) {
    console.error(e);
    // Sai da conta para o botão de login voltar a funcionar depois de corrigir o problema.
    try { await backend.sair(); } catch (_) { /* ignora */ }
    mostrarTela("tela-login");
    mostrarErro("erro-login", traduzirErro(e));
  }
}

// ---------- Criar / entrar numa casa ----------
$("btn-criar").addEventListener("click", async () => {
  const btn = $("btn-criar");
  const nome = $("nome-casa").value.trim() || "Nossa casa";
  mostrarErro("erro-casa", "");
  btn.disabled = true;
  try {
    const id = gerarCodigo();
    await backend.criarCasa(usuario, nome, id);
    entrarNoApp(id);
  } catch (e) {
    console.error(e);
    mostrarErro("erro-casa", traduzirErro(e));
  } finally {
    btn.disabled = false;
  }
});

$("btn-entrar-casa").addEventListener("click", async () => {
  const btn = $("btn-entrar-casa");
  const codigo = $("codigo-casa").value.trim().toUpperCase();
  mostrarErro("erro-casa", "");
  if (codigo.length < 6) {
    mostrarErro("erro-casa", "Digite o código de convite completo.");
    return;
  }
  btn.disabled = true;
  try {
    const r = await backend.entrarNaCasa(usuario, codigo);
    if (r.erro === "nao-existe") {
      mostrarErro("erro-casa", "Código não encontrado. Confira com quem criou a casa.");
    } else if (r.erro === "cheia") {
      mostrarErro("erro-casa", "Essa casa já tem o número máximo de membros.");
    } else {
      entrarNoApp(codigo, true);
      mostrarConexao(); // quem acabou de entrar também vê a conexão acontecendo
    }
  } catch (e) {
    console.error(e);
    mostrarErro("erro-casa", traduzirErro(e));
  } finally {
    btn.disabled = false;
  }
});

// ---------- App principal ----------
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

let membrosAnterior = null;
function entrarNoApp(id, recemEntrou = false) {
  casaId = id;
  membrosAnterior = null;
  mostrarTela("app");

  const primeiroNome = (usuario.nome || usuario.email || "").split(/[\s@]/)[0];
  $("saudacao-texto").textContent = primeiroNome ? `${saudacao()}, ${primeiroNome}` : saudacao();
  $("saudacao-data").textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long"
  }).format(new Date());

  $("avatar-ini").textContent = iniciais(usuario.nome, usuario.email);
  $("cfg-usuario").textContent = usuario.nome ? `${usuario.nome} (${usuario.email})` : usuario.email;
  $("cfg-codigo").textContent = id;
  $("cfg-teste").hidden = !DEMO;

  pararObservadores();
  cancelarCasa = backend.observarCasa(
    id,
    ({ nome, membros, diasUteis }) => {
      $("titulo-casa").textContent = nome || "Conexões";
      $("cfg-nome").textContent = nome;
      aplicarDiasUteis(diasUteis === true);
      const completa = membros >= MAX_MEMBROS;
      $("cfg-membros").textContent = completa ? "Vocês dois estão conectados" : "Aguardando seu parceiro";
      $("casa-par2").classList.toggle("on", completa);
      $("cfg-convite").hidden = completa;
      // Quem já estava na casa vê a animação no instante em que o parceiro entra.
      if (membrosAnterior === 1 && membros >= MAX_MEMBROS) mostrarConexao();
      membrosAnterior = membros;
    },
    (e) => {
      console.error(e);
      aviso(traduzirErro(e));
    }
  );
  cancelarDividas = backend.observarDividas(
    id,
    (lista) => contasUI.receberDividasAntigas(lista),
    (e) => {
      console.error(e);
      aviso(traduzirErro(e));
    }
  );
  const falhou = (e) => { console.error(e); aviso(traduzirErro(e)); };
  cancelarContas = backend.observarContas(id, (l) => { contasUI.receberContas(l); dividasUI.receberContas(l); assistenteUI.receberContas(l); }, falhou);
  cancelarFeriados = backend.observarFeriados(id, (m) => contasUI.receberFeriados(m), falhou);
  cancelarGastos = backend.observarGastos(id, (l) => { contasUI.receberGastos(l); gastosUI.receberGastos(l); assistenteUI.receberGastos(l); }, falhou);
  cancelarMeses = backend.observarMeses(id, (m) => { contasUI.receberMeses(m); gastosUI.receberMeses(m); dividasUI.receberMeses(m); assistenteUI.receberMeses(m); }, falhou);
  abrirPagina(paginaAtual);
}

// Resumo das dívidas no cartão da tela Início.
let resumoVazio = { dividas: null, contas: null };
function atualizarVazio() {
  const vazio = resumoVazio.dividas === 0 && resumoVazio.contas === 0;
  $("ini-vazio").hidden = !vazio;
  $("ini-dados").hidden = vazio || resumoVazio.dividas === null || resumoVazio.contas === null;
}
function barra(id, pct) { $(id).style.width = `${Math.max(0, Math.min(100, pct))}%`; }

function mostrarResumoDividas(r) {
  resumoVazio.dividas = r.quantidade;
  // Com parcelas pela frente o cartão mostra o minigráfico do saldo; sem elas, a barra de progresso.
  let comGrafico = false;
  if (!r.quantidade) {
    animarValor($("stat-divida-num"), "ini-divida", 0);
    $("stat-divida-rot").textContent = "nenhuma dívida";
    $("stat-divida-leg").textContent = "vêm das contas parceladas";
    barra("ini-div-barra", 0);
  } else if (r.parcelasRestantes === 0) {
    animarValor($("stat-divida-num"), "ini-divida", 0);
    $("stat-divida-rot").textContent = "tudo quitado";
    $("stat-divida-leg").textContent = "parabéns!";
    barra("ini-div-barra", 100);
  } else {
    animarValor($("stat-divida-num"), "ini-divida", r.restanteCentavos);
    $("stat-divida-rot").textContent = "falta pagar";
    $("stat-divida-leg").textContent = `${r.quitadoPct}% quitado`;
    barra("ini-div-barra", r.quitadoPct);
    comGrafico = montarMinigrafico($("ini-div-spark"), r.serie);
  }
  if (!comGrafico) montarMinigrafico($("ini-div-spark"), null);
  $("ini-div-barra").parentElement.hidden = comGrafico;
  atualizarVazio();
}
dividasUI.configurar({
  aoResumo: mostrarResumoDividas,
  abrirConta: (id) => { abrirPagina("contas"); contasUI.abrirContaPorId(id); },
  irParaContas: () => abrirPagina("contas")
});

// Preferência da casa: mostrar o valor por dia útil (desligada por padrão).
function aplicarDiasUteis(ativo) {
  diasUteisAtivo = ativo;
  $("stat-dia").hidden = !ativo;
  contasUI.definirDiasUteis(ativo);
}
// Easter egg: 5 toques seguidos no símbolo do topo ligam/desligam o valor por dia útil.
let diasUteisAtivo = false;
let toquesLogo = [];
document.querySelector(".topo-marca").addEventListener("click", () => {
  const agora = Date.now();
  toquesLogo = toquesLogo.filter((t) => agora - t < 2500).concat(agora);
  if (toquesLogo.length < 5) return;
  toquesLogo = [];
  const novo = !diasUteisAtivo;
  aplicarDiasUteis(novo);
  aviso(novo ? "Valor por dia útil ligado" : "Valor por dia útil desligado");
  Promise.resolve(backend.salvarPreferencias(casaId, { diasUteis: novo }))
    .catch((e) => { console.error(e); aviso(traduzirErro(e)); aplicarDiasUteis(!novo); });
});

// Resumo do período de hoje nos cartões da tela Início.
function mostrarResumoContas(r) {
  if (!r) {
    resumoVazio.contas = null;
    $("stat-contas-num").textContent = "R$ —";
    montarProximos($("ini-prox"), null, () => abrirPagina("contas"));
    atualizarVazio();
    return;
  }
  resumoVazio.contas = r.quantidadeContas;
  if (r.semPeriodo) {
    $("ini-mes").textContent = "Contas do período";
    $("stat-contas-num").textContent = "R$ —";
    $("stat-contas-leg").textContent = "hoje não está em nenhum período: crie um em Contas";
    $("stat-dia").hidden = true;
    barra("ini-hero-barra", 0);
    montarProximos($("ini-prox"), r, () => abrirPagina("contas"));
    atualizarVazio();
    return;
  }
  $("stat-dia").hidden = !diasUteisAtivo;
  const tudoPago = r.qtdContas > 0 && r.faltaPagar === 0;
  if (r.qtdContas) {
    // O que importa no dia a dia é o que ainda falta pagar; o total do período vai na legenda.
    $("ini-mes").textContent = `${tudoPago ? "Tudo pago" : "Falta pagar"} · ${rotuloPeriodo(r.p)}`;
    animarValor($("stat-contas-num"), "ini-contas", r.faltaPagar);
    $("stat-contas-leg").textContent = `${r.qtdPagas} de ${r.qtdContas} contas pagas · total ${reais(r.contasTotal)}`;
  } else {
    $("ini-mes").textContent = `Contas de ${rotuloPeriodo(r.p)}`;
    animarValor($("stat-contas-num"), "ini-contas", r.total);
    $("stat-contas-leg").textContent = "contas fixas, variáveis e imprevistos do período";
  }
  barra("ini-hero-barra", r.qtdContas ? r.pagoPct : 0);
  $("stat-dia").textContent = `${reais(r.porDia)} por dia útil · ${r.dias} dias úteis` + (r.feriados ? ` · ${r.feriados} feriado${r.feriados > 1 ? "s" : ""}` : "");
  montarProximos($("ini-prox"), r, () => abrirPagina("contas"));
  atualizarVazio();
}
const painelUI = configurarPainel();
const contasUI = configurarContas({
  obterBackend: () => backend,
  obterCasaId: () => casaId,
  aviso,
  abrirTetoPagina: () => abrirPagina("teto"),
  aoSerie: (s) => painelUI.atualizar(s),
  aoResumo: mostrarResumoContas
});

// Saldo do teto no cartão da tela Início.
function mostrarResumoTeto(r) {
  const tile = $("ini-tile-teto");
  if (!r) { $("stat-teto-num").textContent = "R$ —"; return; }
  if (r.semPeriodo) {
    tile.classList.remove("estourou");
    $("stat-teto-num").textContent = "R$ —";
    $("stat-teto-rot").textContent = "sem período hoje";
    $("stat-teto-leg").textContent = "crie um em Contas";
    barra("ini-teto-barra", 0);
    return;
  }
  tile.classList.toggle("estourou", r.estourou);
  // Barra: verde enquanto sobra folga, âmbar perto do limite, vermelha ao estourar.
  tile.dataset.nivel = r.estourou ? "alto" : r.pct >= 75 ? "atencao" : "ok";
  animarValor($("stat-teto-num"), "ini-teto", Math.abs(r.restante));
  $("stat-teto-rot").textContent = r.estourou ? "passou do limite" : "ainda dá para gastar";
  $("stat-teto-leg").textContent = r.qtdGastos === 1 ? "1 gasto no período" : `${r.qtdGastos || 0} gastos no período`;
  barra("ini-teto-barra", r.teto > 0 ? (r.gasto / r.teto) * 100 : (r.gasto > 0 ? 100 : 0));
}
const gastosUI = configurarGastos({
  obterBackend: () => backend,
  obterCasaId: () => casaId,
  aviso,
  editarTeto: () => contasUI.editarTeto(),
  novoPeriodo: () => contasUI.novoPeriodo(),
  editarPeriodo: (p) => contasUI.editarPeriodo(p),
  aoResumo: mostrarResumoTeto
});

// ---------- Navegação ----------
const ORDEM = ["inicio", "dividas", "contas", "teto", "assistente"]; // abas do dock; "config" abre pelo avatar
const TITULOS = {
  inicio: "Início",
  dividas: "Dívidas",
  contas: "Contas",
  teto: "Imprevistos",
  assistente: "Assistente",
  config: "Casa e conta"
};
let paginaAtual = "inicio";
let ultimaAba = "inicio";

function abrirPagina(nome) {
  paginaAtual = nome;
  document.querySelectorAll(".pagina").forEach((p) => (p.hidden = p.id !== `pagina-${nome}`));
  document.querySelectorAll(".aba").forEach((a) => {
    const ativa = a.dataset.pagina === nome;
    a.classList.toggle("ativa", ativa);
    a.setAttribute("aria-current", ativa ? "page" : "false");
  });
  const naDock = ORDEM.includes(nome);
  if (naDock) { $("dock").style.setProperty("--idx", String(ORDEM.indexOf(nome))); ultimaAba = nome; }
  $("dock").classList.toggle("sem-aba", !naDock);
  const av = $("btn-avatar");
  av.classList.toggle("ativo", nome === "config");
  if (nome === "config") av.setAttribute("aria-current", "page"); else av.removeAttribute("aria-current");
  $("titulo-pagina").textContent = TITULOS[nome] || "";
  if (nome === "inicio" && typeof painelUI !== "undefined") painelUI.animar();
  if (nome === "contas") contasUI.atualizar();
  if (nome === "teto") gastosUI.atualizar();
  if (nome === "assistente") assistenteUI.aoAbrir();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".aba").forEach((a) =>
  a.addEventListener("click", () => abrirPagina(a.dataset.pagina))
);

// Atalhos que levam a outra página (cartões do Início, passos, "Ver todas"): ligados uma única vez.
document.querySelectorAll("[data-ir]").forEach((el) =>
  el.addEventListener("click", () => abrirPagina(el.dataset.ir))
);

// Ações rápidas do Início.
document.querySelectorAll("[data-acao]").forEach((b) => b.addEventListener("click", () => {
  const a = b.dataset.acao;
  if (a === "gasto") { abrirPagina("teto"); gastosUI.abrirNovo(); }
  else if (a === "pagar") abrirPagina("contas");
  else abrirPagina("assistente");
}));

// Avatar no topo: abre "Casa e conta"; tocar de novo volta para a aba de onde veio.
$("btn-avatar").addEventListener("click", () => abrirPagina(paginaAtual === "config" ? ultimaAba : "config"));

function iniciais(nome, email) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length) return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
  return ((email || "?")[0] || "?").toUpperCase();
}

// Topo que encolhe ao rolar: título grande vira barra compacta (com folga para não ficar piscando).
let topoCompacto = false;
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  const novo = topoCompacto ? y > 12 : y > 44;
  if (novo === topoCompacto) return;
  topoCompacto = novo;
  document.body.classList.toggle("topo-compacto", novo);
}, { passive: true });

$("btn-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(casaId);
    aviso("Código copiado");
  } catch {
    aviso("Selecione o código e copie manualmente");
  }
});

// ---------- Tema (por aparelho) ----------
function temaSalvo() {
  try { const t = localStorage.getItem("conexoes-tema"); return t === "escuro" || t === "auto" ? t : "claro"; } catch { return "claro"; }
}
function aplicarTema(modo) {
  const raiz = document.documentElement;
  if (modo === "auto") {
    if (raiz.hasAttribute("data-tema-app")) { raiz.removeAttribute("data-theme"); raiz.removeAttribute("data-tema-app"); }
  } else {
    raiz.setAttribute("data-theme", modo === "escuro" ? "dark" : "light");
    raiz.setAttribute("data-tema-app", "1");
  }
  atualizarCorBarra();
  document.querySelectorAll("#seletor-tema [data-tema]").forEach((b) => {
    const ativo = b.dataset.tema === modo;
    b.classList.toggle("ativo", ativo);
    b.setAttribute("aria-pressed", String(ativo));
  });
}
document.querySelectorAll("#seletor-tema [data-tema]").forEach((b) =>
  b.addEventListener("click", () => {
    try { localStorage.setItem("conexoes-tema", b.dataset.tema); } catch (_) { /* sem armazenamento */ }
    aplicarTema(b.dataset.tema);
  })
);
aplicarTema(temaSalvo());

// ---------- Estado da rede ----------
function atualizarRede() {
  // Só aparece quando importa: sem internet (os dados ficam salvos no aparelho) ou na demonstração.
  const el = $("estado-rede");
  const on = navigator.onLine;
  el.hidden = on && !DEMO;
  el.textContent = DEMO ? "Demonstração" : "Sem internet";
  el.title = DEMO ? "Dados de exemplo, nada é salvo" : "Suas alterações ficam salvas no aparelho e sincronizam quando a internet voltar";
  el.classList.toggle("offline", !DEMO && !on);
}
window.addEventListener("online", atualizarRede);
window.addEventListener("offline", atualizarRede);
atualizarRede();

// ---------- Início ----------
aplicarIcones();

(async function iniciar() {
  try {
    backend = DEMO
      ? (await import("./js/backend-demo.js")).criarBackendDemo()
      : await (await import("./js/backend-firebase.js")).criarBackendFirebase();
  } catch (e) {
    console.error(e);
    mostrarTela("tela-login");
    mostrarErro("erro-login", "Não foi possível carregar o Firebase. Verifique a conexão e recarregue a página.");
    return;
  }
  abrirPagina("inicio");
  backend.aoMudarLogin(aoMudarLogin);
})();

// ---------- PWA ----------
if (!DEMO && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
  });
}
