// Backend real: Firebase (login Google + Firestore com cache offline).
// Os módulos do Firebase só são baixados quando este arquivo é usado.

const CDN = "https://www.gstatic.com/firebasejs/10.14.1";
export const MAX_MEMBROS = 2;

export async function criarBackendFirebase() {
  const [{ initializeApp }, A, F, { firebaseConfig }] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
    import("../firebase-config.js")
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

  const colecaoDividas = (casaId) => F.collection(db, "households", casaId, "debts");

  return {
    // ----- Conta e casa -----
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
    },

    // ----- Dívidas -----
    // Documento: { nome, valorCentavos, totalParcelas, mesInicio: "AAAA-MM", pagas: [1, 2, ...] }
    observarDividas(casaId, aoReceber, aoFalhar) {
      return F.onSnapshot(
        colecaoDividas(casaId),
        (snap) => aoReceber(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        aoFalhar
      );
    },

    // Não espera o servidor: com o cache offline a tela atualiza na hora e sincroniza depois.
    salvarDivida(casaId, id, dados) {
      if (id) return F.updateDoc(F.doc(db, "households", casaId, "debts", id), dados);
      const ref = F.doc(colecaoDividas(casaId));
      return F.setDoc(ref, { ...dados, criadoEm: F.serverTimestamp() });
    },

    excluirDivida(casaId, id) {
      return F.deleteDoc(F.doc(db, "households", casaId, "debts", id));
    },

    // arrayUnion/arrayRemove: se vocês dois marcarem ao mesmo tempo, nada se perde.
    marcarParcela(casaId, id, numero, pago) {
      return F.updateDoc(F.doc(db, "households", casaId, "debts", id), {
        pagas: pago ? F.arrayUnion(numero) : F.arrayRemove(numero)
      });
    }
  };
}
