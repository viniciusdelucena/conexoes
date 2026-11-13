// Funções de apoio usadas em todo o app.

export const $ = (id) => document.getElementById(id);

// Cria elementos sem usar innerHTML com texto de usuário (evita injeção de HTML).
// Atributos: class, html (só para conteúdo confiável, como ícones), onclick etc., ou qualquer atributo.
export function h(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    e.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return e;
}

// ---------- Dinheiro (sempre em centavos inteiros) ----------
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const reais = (centavos) => BRL.format(centavos / 100);
// Valor de destaque: "R$" e centavos ficam menores (as classes .rs e .ct), o inteiro domina.
// O texto lido por leitor de tela continua "R$ 3.901,40". Só números e símbolos entram no HTML.
export function reaisHtml(centavos) {
  const t = reais(centavos);
  const m = t.match(/^(-?)R\$[\s\u00a0]*([\d.]+)(,\d+)$/);
  if (!m) return t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `${m[1]}<span class="rs">R$</span>&nbsp;${m[2]}<span class="ct">${m[3]}</span>`;
}
// ----- Movimento dos números e barras -----
// Guardam o último valor mostrado por "chave" (ex.: "contas-hero"), para animar a partir dele.
// Quem pediu menos movimento no sistema recebe o valor final direto.
const semMovimento = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const estadoValores = new Map();
const estadoBarras = new Map();

// Conta de um valor até o outro (centavos) dentro do elemento, em ~0,7 s. Primeira vez: sobe de zero.
export function animarValor(el, chave, centavos, duracao = 700) {
  const est = estadoValores.get(chave) || { mostrado: 0, raf: 0 };
  estadoValores.set(chave, est);
  if (est.raf) cancelAnimationFrame(est.raf);
  const de = est.mostrado;
  if (semMovimento() || de === centavos) { est.mostrado = centavos; est.raf = 0; el.innerHTML = reaisHtml(centavos); return; }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / duracao);
    const suave = 1 - Math.pow(1 - k, 3);
    est.mostrado = Math.round(de + (centavos - de) * suave);
    el.innerHTML = reaisHtml(est.mostrado);
    est.raf = k < 1 ? requestAnimationFrame(passo) : 0;
  };
  el.innerHTML = reaisHtml(de);
  est.raf = requestAnimationFrame(passo);
}

// Barra que cresce do tamanho anterior até o novo (a barra é recriada a cada desenho da tela).
export function animarLargura(span, chave, pct) {
  const de = estadoBarras.has(chave) ? estadoBarras.get(chave) : 0;
  estadoBarras.set(chave, pct);
  if (semMovimento() || de === pct) { span.style.width = `${pct}%`; return; }
  span.style.width = `${de}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => { span.style.width = `${pct}%`; }));
}

export const paraCampo = (centavos) => (centavos / 100).toFixed(2).replace(".", ",");

// Aceita "1.234,56", "1234,56", "150.50", "R$ 90". Devolve centavos ou NaN.
export function parseReais(txt) {
  let s = String(txt ?? "").replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

// ---------- Meses no formato "AAAA-MM" ----------
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];
export const NOMES_MESES = MESES.map((m) => m[0].toUpperCase() + m.slice(1));

export function mesAtual(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function somarMeses(ym, n) {
  const [a, m] = ym.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// Quantos meses de "a" até "b" (positivo se b é depois).
export function diffMeses(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function nomeMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  return `${NOMES_MESES[m - 1]} ${a}`;
}

export function mesCurto(ym) {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1].slice(0, 3)}/${a}`;
}
