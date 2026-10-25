// Conexões
// O app fala com um "backend" (Firebase de verdade, ou uma demonstração em memória
// usada só para pré-visualizar as telas). Para abrir a demonstração: adicione ?demo=1 ao endereço.

const DEMO =
  window.__CONEXOES_DEMO__ === true ||
  new URLSearchParams(location.search).get("demo") === "1";

const MAX_MEMBROS = 2;
const CDN = "https://www.gstatic.com/firebasejs/10.14.1";

// ---------- Backend: Firebase ----------
async function criarBackendFirebase() {
  const [{ initializeApp }, A, F, { firebaseConfig }] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
    import("./firebase-config.js")
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, {
    // Guarda os dados no aparelho: o app abre offline e sincroniza quando a internet volta.
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() })
  });

  const paraUsuario = (u) =>
    u ? { uid: u.uid, nome: u.displayName || "", email: u.email || "" } : null;

  const gravarPerfil = (user, casaId) =>
    F.setDoc(F.doc(db, "users", user.uid), { casaId, nome: user.nome, email: user.email });

  return {
    aoMudarLogin: (cb) => A.onAuthStateChanged(auth, (u) => cb(paraUsuario(u))),
    login: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    sair: () => A.signOut(auth),

    async casaDoUsuario(uid) {
      const snap = await F.getDoc(F.doc(db, "users", uid));
      return snap.exists() ? snap.data().casaId || null : null;
    },

    async criarCasa(user, nome, id) {
      await F.setDoc(F.doc(db, "households", id), {
        nome,
        members: [user.uid],
        criadoEm: F.serverTimestamp()
      });
      await gravarPerfil(user, id);
    },

    async entrarNaCasa(user, codigo) {
      const ref = F.doc(db, "households", codigo);
      const snap = await F.getDoc(ref);
      if (!snap.exists()) return { erro: "nao-existe" };
      const membros = snap.data().members || [];
      if (!membros.includes(user.uid)) {
        if (membros.length >= MAX_MEMBROS) return { erro: "cheia" };
        await F.updateDoc(ref, { members: F.arrayUnion(user.uid) });
      }
      await gravarPerfil(user, codigo);
      return { ok: true };
    },

    observarCasa(id, aoReceber, aoFalhar) {
      return F.onSnapshot(
        F.doc(db, "households", id),
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          aoReceber({ nome: d.nome || "", membros: (d.members || []).length });
        },
        aoFalhar
      );
    }
  };
}

// ---------- Backend: demonstração (sem internet, sem Firebase) ----------
function criarBackendDemo() {
  let ouvinte = null;
  let casaId = null;
  let casa = { nome: "", membros: 0 };
  const espera = (ms = 450) => new Promise((r) => setTimeout(r, ms));
  const USUARIO = { uid: "demo", nome: "Vinicius Demo", email: "demo@exemplo.com" };

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
    }
  };
}

// ---------- Utilidades de tela ----------
const $ = (id) => document.getElementById(id);
const TELAS = ["tela-carregando", "tela-login", "tela-casa"];

function mostrarTela(nome) {
  for (const t of TELAS) $(t).hidden = t !== nome;
  $("app").hidden = nome !== "app";
}

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
  avisoTimer = setTimeout(() => (el.hidden = true), 2500);
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
  if (cancelarCasa) { cancelarCasa(); cancelarCasa = null; }
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

  if (cancelarCasa) cancelarCasa();
  cancelarCasa = backend.observarCasa(
    id,
    ({ nome, membros }) => {
      $("titulo-casa").textContent = nome || "Conexões";
      $("cfg-nome").textContent = nome;
      $("cfg-membros").textContent =
        `${membros} de ${MAX_MEMBROS}` + (membros < MAX_MEMBROS ? " (falta convidar)" : "");
    },
    (e) => {
      console.error(e);
      aviso(traduzirErro(e));
    }
  );
  abrirPagina(paginaAtual);
}

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
  document.querySelectorAll(".aba").forEach((a) => a.classList.toggle("ativa", a.dataset.pagina === nome));
  $("subtitulo-pagina").textContent = TITULOS[nome] || "";
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

// ---------- Estado da rede ----------
function atualizarRede() {
  const el = $("estado-rede");
  const on = navigator.onLine;
  el.textContent = DEMO ? "demonstração" : on ? "online" : "offline";
  el.classList.toggle("offline", !DEMO && !on);
}
window.addEventListener("online", atualizarRede);
window.addEventListener("offline", atualizarRede);
atualizarRede();

// ---------- Início ----------
(async function iniciar() {
  try {
    backend = DEMO ? criarBackendDemo() : await criarBackendFirebase();
  } catch (e) {
    console.error(e);
    mostrarTela("tela-login");
    mostrarErro("erro-login", "Não foi possível carregar o Firebase. Verifique a conexão e recarregue a página.");
    return;
  }
  backend.aoMudarLogin(aoMudarLogin);
})();

// ---------- PWA ----------
if (!DEMO && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
  });
}
