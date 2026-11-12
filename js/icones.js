// Conjunto de ícones do app: traço arredondado + vidro (preenchimento translúcido) na cor do texto.
// O preenchimento usa --ico-fill quando a tela define uma (ex.: aba do dock), senão a própria cor do traço.

const F = (d, extra = "") => `<path d="${d}" fill="currentColor" fill-opacity=".16" stroke="none" style="fill:var(--ico-fill,currentColor)" data-vidro ${extra}/>`;

const CAMINHOS = {
  home: F("M5.5 10 12 4.6l6.5 5.4v9a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19Z") +
    '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.8V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9.8"/><path d="M10 20.5v-4.2a2 2 0 0 1 4 0v4.2"/>',
  dividas: F("M3 7.5l6 6 4-4 8 7.5V20.5H3Z") +
    '<path d="M3 7.5l6 6 4-4 8 7.5"/><path d="M16 17h5v-5"/>',
  contas: F("M4.5 3v18l2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5V3l-2.5 1.5L14.5 3 12 4.5 9.5 3 7 4.5Z") +
    '<path d="M4.5 3v18l2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5V3l-2.5 1.5L14.5 3 12 4.5 9.5 3 7 4.5Z"/><path d="M15.5 8.5h-5a1.75 1.75 0 1 0 0 3.5h3a1.75 1.75 0 1 1 0 3.5h-5"/><path d="M12.5 7v1.5M12.5 15.5V17"/>',
  teto: F("M2.5 12.5a9.5 9.5 0 0 1 19 0Z") +
    '<path d="M2.5 12.5a9.5 9.5 0 0 1 19 0Z"/><path d="M12 12.5v6.5a2 2 0 0 0 4 0"/><path d="M12 3V2"/>',
  casa: F("M2.5 20.5V19A4.5 4.5 0 0 1 7 14.5h4a4.5 4.5 0 0 1 4.5 4.5v1.5Z") + F("M9 3.7a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z") +
    '<path d="M2.5 20.5V19A4.5 4.5 0 0 1 7 14.5h4a4.5 4.5 0 0 1 4.5 4.5v1.5"/><circle cx="9" cy="7.5" r="3.8"/><path d="M16.2 3.9a3.8 3.8 0 0 1 0 7.2"/><path d="M21.5 20.5V19a4.5 4.5 0 0 0-3.1-4.3"/>',
  calendario: F("M6.5 4.5h11A3 3 0 0 1 20.5 7.5v10a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3Z") +
    '<rect x="3.5" y="4.5" width="17" height="16" rx="3.5"/><path d="M8 2.5v4M16 2.5v4M3.5 10h17"/><path d="M8 14.2h.01M12 14.2h.01M16 14.2h.01M8 17.4h.01M12 17.4h.01" stroke-width="2.4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  esq: '<path d="m15 18-6-6 6-6"/>',
  dir: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  editar: F("M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z") + '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  infinito: F("M12 12c2-4.5 4-6 6-6a6 6 0 0 1 0 12c-2 0-4-1.5-6-6Zm0 0c-2 4.5-4 6-6 6A6 6 0 0 1 6 6c2 0 4 1.5 6 6Z") +
    '<path d="M12 12c2-4.5 4-6 6-6a6 6 0 0 1 0 12c-2 0-4-1.5-6-6Zm0 0c-2 4.5-4 6-6 6A6 6 0 0 1 6 6c2 0 4 1.5 6 6Z"/>'
};

export function icone(nome, tam = 22) {
  const traco = tam <= 18 ? 2.2 : 1.75;
  return `<svg class="svg-ico" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAMINHOS[nome] || ""}</svg>`;
}

// Troca <span data-ico="nome" data-tam="20"></span> pelo ícone.
export function aplicarIcones(raiz = document) {
  raiz.querySelectorAll("[data-ico]").forEach((el) => {
    if (!el.firstChild) el.innerHTML = icone(el.dataset.ico, Number(el.dataset.tam) || 22);
  });
}
