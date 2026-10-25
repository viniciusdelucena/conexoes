import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  // Guarda os dados no aparelho: o app abre offline e sincroniza quando a internet volta.
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const MAX_MEMBROS = 2;

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
let usuario = null;
let casaId = null;
let cancelarCasa = null;

// ---------- Login ----------
$("btn-login").addEventListener("click", async () => {
  mostrarErro("erro-login", "");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    console.error(e);
    mostrarErro("erro-login", traduzirErro(e));
  }
});

async function sair() {
  if (cancelarCasa) { cancelarCasa(); cancelarCasa = null; }
  casaId = null;
  await signOut(auth);
}
$("btn-sair").addEventListener("click", sair);
$("btn-sair-casa").addEventListener("click", sair);

onAuthStateChanged(auth, async (u) => {
  usuario = u;
  if (!u) {
    mostrarTela("tela-login");
    return;
  }
  mostrarTela("tela-carregando");
  try {
    const snap = await getDoc(doc(db, "users", u.uid));
    const id = snap.exists() ? snap.data().casaId : null;
    if (id) {
      entrarNoApp(id);
    } else {
      $("nome-usuario").textContent = u.displayName || u.email || "";
      mostrarErro("erro-casa", "");
      mostrarTela("tela-casa");
    }
  } catch (e) {
    console.error(e);
    mostrarTela("tela-login");
    mostrarErro("erro-login", traduzirErro(e));
  }
});

// ---------- Criar / entrar numa casa ----------
$("btn-criar").addEventListener("click", async () => {
  const btn = $("btn-criar");
  const nome = $("nome-casa").value.trim() || "Nossa casa";
  mostrarErro("erro-casa", "");
  btn.disabled = true;
  try {
    const id = gerarCodigo();
    await setDoc(doc(db, "households", id), {
      nome,
      members: [usuario.uid],
      criadoEm: serverTimestamp()
    });
    await setDoc(doc(db, "users", usuario.uid), {
      casaId: id,
      nome: usuario.displayName || "",
      email: usuario.email || ""
    });
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
    const ref = doc(db, "households", codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      mostrarErro("erro-casa", "Código não encontrado. Confira com quem criou a casa.");
      return;
    }
    const membros = snap.data().members || [];
    if (!membros.includes(usuario.uid)) {
      if (membros.length >= MAX_MEMBROS) {
        mostrarErro("erro-casa", "Essa casa já tem o número máximo de membros.");
        return;
      }
      await updateDoc(ref, { members: arrayUnion(usuario.uid) });
    }
    await setDoc(doc(db, "users", usuario.uid), {
      casaId: codigo,
      nome: usuario.displayName || "",
      email: usuario.email || ""
    });
    entrarNoApp(codigo);
  } catch (e) {
    console.error(e);
    mostrarErro("erro-casa", traduzirErro(e));
  } finally {
    btn.disabled = false;
  }
});

// ---------- App principal ----------
function entrarNoApp(id) {
  casaId = id;
  mostrarTela("app");
  $("cfg-usuario").textContent = usuario.displayName
    ? `${usuario.displayName} (${usuario.email})`
    : usuario.email;
  $("cfg-codigo").textContent = id;

  if (cancelarCasa) cancelarCasa();
  cancelarCasa = onSnapshot(
    doc(db, "households", id),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      $("titulo-casa").textContent = d.nome || "Conexões";
      $("cfg-nome").textContent = d.nome || "";
      const n = (d.members || []).length;
      $("cfg-membros").textContent = `${n} de ${MAX_MEMBROS}` + (n < MAX_MEMBROS ? " (falta convidar)" : "");
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
  el.textContent = on ? "online" : "offline";
  el.classList.toggle("offline", !on);
}
window.addEventListener("online", atualizarRede);
window.addEventListener("offline", atualizarRede);
atualizarRede();

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
  });
}
