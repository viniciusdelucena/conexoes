// Esqueleto de página: blocos com brilho no lugar do spinner, na forma do que vai aparecer (um cartão de destaque e uma lista).

import { h } from "./util.js";

const barra = (largura, altura, extra = "") =>
  h("span", { class: `esq ${extra}`.trim(), style: `width:${largura};height:${altura}px` });

export function esqueletoPagina() {
  const item = () => h("div", { class: "esq-item" },
    h("span", { class: "esq esq-bolha" }),
    h("div", { class: "esq-texto" }, barra("62%", 13), barra("38%", 11)),
    barra("18%", 14));
  return h("div", { class: "esq-pagina", role: "status", "aria-label": "Carregando" },
    h("div", { class: "cartao esq-cartao" }, barra("34%", 12), barra("58%", 34, "esq-forte"), barra("100%", 10, "esq-trilho"), barra("46%", 12)),
    h("div", { class: "cartao esq-cartao" }, item(), item(), item()));
}
