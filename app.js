// Conexões: ponto de entrada.
// O app conversa com um "backend": o Firebase de verdade, ou uma demonstração em memória
// usada só para pré-visualizar as telas (abra o endereço com ?demo=1).

import { $, reais, mesCurto, nomeMes, mesAtual } from "./js/util.js";
import { aplicarIcones } from "./js/icones.js";
import * as dividasUI from "./js/dividas.js";
import { configurarContas } from "./js/contas.js";
import { configurarGastos } from "./js/gastos.js";
import { configurarPainel } from "./js/painel.js";




const DEMO =
  window.__CONEXOES_DEMO__ === true ||
  new URLSearchParams(location.search).get("demo") === "1";

const MAX_MEMBROS = 2;

// ---------- Utilidades de tela ----------
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
  meta.setAttribute("content", heroVermelho ? "#ee5154" : escuro ? "#141010" : "#f7f4f4");
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
      entrarNoApp(codigo);
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

function entrarNoApp(id) {
  casaId = id;
  mostrarTela("app");

  const primeiroNome = (usuario.nome || usuario.email || "").split(/[\s@]/)[0];
  $("saudacao-texto").textContent = primeiroNome ? `${saudacao()}, ${primeiroNome}` : saudacao();
  $("saudacao-data").textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long"
  }).format(new Date());

  $("cfg-usuario").textContent = usuario.nome ? `${usuario.nome} (${usuario.email})` : usuario.email;
  $("cfg-codigo").textContent = id;

  pararObservadores();
  cancelarCasa = backend.observarCasa(
    id,
    ({ nome, membros, diasUteis }) => {
      $("titulo-casa").textContent = nome || "Conexões";
      $("cfg-nome").textContent = nome;
      aplicarDiasUteis(diasUteis === true);
      $("cfg-membros").textContent =
        `${membros} de ${MAX_MEMBROS}` + (membros < MAX_MEMBROS ? " (falta convidar)" : "");
    },
    (e) => {
      console.error(e);
      aviso(traduzirErro(e));
    }
  );
  cancelarDividas = backend.observarDividas(
    id,
    (lista) => { dividasUI.receber(lista); contasUI.receberDividas(lista); },
    (e) => {
      console.error(e);
      aviso(traduzirErro(e));
    }
  );
  const falhou = (e) => { console.error(e); aviso(traduzirErro(e)); };
  cancelarContas = backend.observarContas(id, (l) => contasUI.receberContas(l), falhou);
  cancelarFeriados = backend.observarFeriados(id, (m) => contasUI.receberFeriados(m), falhou);
  cancelarGastos = backend.observarGastos(id, (l) => { contasUI.receberGastos(l); gastosUI.receberGastos(l); }, falhou);
  cancelarMeses = backend.observarMeses(id, (m) => { contasUI.receberMeses(m); gastosUI.receberMeses(m); }, falhou);
  abrirPagina(paginaAtual);
}

// Resumo das dívidas no cartão da tela Início.
function mostrarResumoDividas(r) {
  if (!r.quantidade) {
    $("stat-divida-num").textContent = "R$ —";
    $("stat-divida-leg").textContent = "cadastre em Dívidas";
  } else if (r.parcelasRestantes === 0) {
    $("stat-divida-num").textContent = reais(0);
    $("stat-divida-leg").textContent = "tudo quitado";
  } else {
    $("stat-divida-num").textContent = reais(r.restanteCentavos);
    $("stat-divida-leg").textContent = `${r.parcelasRestantes} parcelas · até ${mesCurto(r.fim)}`;
  }
}
dividasUI.configurar({
  obterBackend: () => backend,
  obterCasaId: () => casaId,
  aviso,
  aoResumo: mostrarResumoDividas
});

// Preferência da casa: mostrar o valor por dia útil (desligada por padrão).
function aplicarDiasUteis(ativo) {
  diasUteisAtivo = ativo;
  $("stat-dia").hidden = !ativo;
  $("grade-stats").classList.toggle("sem-dia", !ativo);
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

// Resumo do mês atual nos cartões da tela Início.
function mostrarResumoContas(r) {
  if (!r) {
    $("stat-contas-num").textContent = "R$ —";
    $("stat-contas-leg").textContent = "carregando…";
    $("stat-dia-num").textContent = "R$ —";
    return;
  }
  $("stat-contas-num").textContent = reais(r.total);
  $("stat-contas-leg").textContent = "total deste mês, com o teto";
  $("stat-dia-num").textContent = reais(r.porDia);
  $("stat-dia-leg").textContent = `${nomeMes(mesAtual()).split(" ")[0].toLowerCase()}: ${r.dias} dias úteis` + (r.feriados ? ` · ${r.feriados} feriado${r.feriados > 1 ? "s" : ""}` : "");
}
const painelUI = configurarPainel();
const contasUI = configurarContas({
  obterBackend: () => backend,
  obterCasaId: () => casaId,
  aviso,
  abrirDividas: (ym) => { dividasUI.irParaMes(ym); abrirPagina("dividas"); },
  abrirTetoPagina: () => abrirPagina("teto"),
  aoSerie: (s) => painelUI.atualizar(s),
  aoResumo: mostrarResumoContas
});

// Saldo do teto no cartão da tela Início.
function mostrarResumoTeto(r) {
  if (!r) { $("stat-teto-num").textContent = "R$ —"; $("stat-teto-leg").textContent = "de imprevistos"; return; }
  $("stat-teto-num").textContent = reais(r.restante);
  $("stat-teto-leg").textContent = r.estourou ? `passou do teto de ${reais(r.teto)}` : `de ${reais(r.teto)} · gasto ${reais(r.gasto)}`;
}
const gastosUI = configurarGastos({
  obterBackend: () => backend,
  obterCasaId: () => casaId,
  aviso,
  editarTeto: (ym) => contasUI.editarTeto(ym),
  aoResumo: mostrarResumoTeto
});

// ---------- Navegação ----------
const ORDEM = ["inicio", "dividas", "contas", "teto", "config"];
const TITULOS = {
  inicio: "Início",
  dividas: "Dívidas",
  contas: "Contas do mês",
  teto: "Teto de gastos",
  config: "Casa e conta"
};
let paginaAtual = "inicio";

function abrirPagina(nome) {
  paginaAtual = nome;
  document.querySelectorAll(".pagina").forEach((p) => (p.hidden = p.id !== `pagina-${nome}`));
  document.querySelectorAll(".aba").forEach((a) => {
    const ativa = a.dataset.pagina === nome;
    a.classList.toggle("ativa", ativa);
    a.setAttribute("aria-current", ativa ? "page" : "false");
  });
  $("dock").style.setProperty("--idx", String(ORDEM.indexOf(nome)));
  $("titulo-pagina").textContent = TITULOS[nome] || "";
  if (nome === "inicio" && typeof painelUI !== "undefined") painelUI.animar();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".aba").forEach((a) =>
  a.addEventListener("click", () => abrirPagina(a.dataset.pagina))
);

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
  try { const t = localStorage.getItem("conexoes-tema"); return t === "claro" || t === "escuro" ? t : "auto"; } catch { return "auto"; }
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
    try { if (b.dataset.tema === "auto") localStorage.removeItem("conexoes-tema"); else localStorage.setItem("conexoes-tema", b.dataset.tema); } catch (_) { /* sem armazenamento */ }
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
