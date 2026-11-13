// Estado vazio ilustrado, usado em Dívidas e Imprevistos. As ilustrações são desenhos próprios (SVG), sem imagens externas.

import { h } from "./util.js";

const ILUSTRACOES = {
  // Laço do infinito (a marca do app) com brilhos ao redor
  dividas: `<svg viewBox="0 0 160 110" width="150" height="103" aria-hidden="true">
    <defs>
      <linearGradient id="vz-d1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0636a"/><stop offset="1" stop-color="#b52334"/></linearGradient>
      <radialGradient id="vz-d2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0636a" stop-opacity=".28"/><stop offset="1" stop-color="#f0636a" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="80" cy="58" rx="74" ry="46" fill="url(#vz-d2)"/>
    <path d="M80 55c9-19 18-26 28-26a26 26 0 0 1 0 52c-10 0-19-7-28-26Zm0 0c-9 19-18 26-28 26a26 26 0 0 1 0-52c10 0 19 7 28 26Z" fill="none" stroke="url(#vz-d1)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M80 55c9-19 18-26 28-26" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>
    <g fill="#f0636a"><circle cx="22" cy="22" r="3" opacity=".55"/><circle cx="140" cy="94" r="3.5" opacity=".45"/><circle cx="144" cy="26" r="2.4" opacity=".4"/></g>
    <g stroke="#f0636a" stroke-linecap="round" stroke-width="2.2" opacity=".5"><path d="M130 14v10M125 19h10"/><path d="M26 86v8M22 90h8"/></g>
  </svg>`,
  // Guarda-chuva com gotas: os imprevistos
  teto: `<svg viewBox="0 0 160 110" width="150" height="103" aria-hidden="true">
    <defs>
      <linearGradient id="vz-t1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0636a"/><stop offset="1" stop-color="#b52334"/></linearGradient>
      <radialGradient id="vz-t2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0636a" stop-opacity=".26"/><stop offset="1" stop-color="#f0636a" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="80" cy="58" rx="72" ry="46" fill="url(#vz-t2)"/>
    <path d="M32 58a48 40 0 0 1 96 0c-8-7-16-7-24 0-8-7-16-7-24 0-8-7-16-7-24 0-8-7-16-7-24 0Z" fill="url(#vz-t1)"/>
    <path d="M80 18v-6" stroke="#b52334" stroke-width="5" stroke-linecap="round"/>
    <path d="M80 58v26a9 9 0 0 1-18 0" fill="none" stroke="#b52334" stroke-width="5" stroke-linecap="round"/>
    <path d="M44 48c6-12 18-20 30-22" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    <g fill="#f0636a" opacity=".5"><path d="M30 78q3 6 0 9q-3-3 0-9Z"/><path d="M122 74q3 6 0 9q-3-3 0-9Z"/><path d="M136 92q2 5 0 8q-2-3 0-8Z"/></g>
  </svg>`
};

// opcoes: { ilustracao, titulo, texto, passos: ["...", "..."], botao: { texto, aoClicar } }
export function estadoVazio({ ilustracao, titulo, texto, passos, botao }) {
  return h("div", { class: "cartao vazio vazio-ilustrado" },
    h("div", { class: "vazio-arte", html: ILUSTRACOES[ilustracao] || "" }),
    h("h3", {}, titulo),
    h("p", { class: "sub" }, texto),
    passos && passos.length ? h("ol", { class: "vazio-passos" }, passos.map((t, i) => h("li", {}, h("span", { class: "vazio-n" }, String(i + 1)), h("span", {}, t)))) : null,
    botao ? h("button", { class: "btn primario", type: "button", onclick: botao.aoClicar }, botao.texto) : null
  );
}
