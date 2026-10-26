// Calendário: feriados e dias úteis. Dia útil = segunda a sábado, menos os feriados.
// Feriados nacionais: BrasilAPI quando há internet; se falhar, o app calcula sozinho.

const dois = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const dataLocal = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };

export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const diaDaSemana = (data) => dataLocal(data).getDay();

export function diasNoMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  return new Date(a, m, 0).getDate();
}

// datasFeriado: datas "AAAA-MM-DD" que não contam como dia útil.
export function diasUteisDoMes(ym, datasFeriado = []) {
  const folgas = new Set(datasFeriado);
  let n = 0;
  for (let d = 1; d <= diasNoMes(ym); d++) {
    const data = `${ym}-${dois(d)}`;
    if (diaDaSemana(data) === 0) continue; // domingo
    if (folgas.has(data)) continue;
    n++;
  }
  return n;
}

// ---------- Feriados nacionais ----------
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

// Reserva: calculado aqui mesmo, sem internet. Retorna { "AAAA-MM-DD": "Nome" }.
export function feriadosNacionaisCalculados(ano) {
  const fixos = {
    "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
    "09-07": "Independência do Brasil", "10-12": "Nossa Senhora Aparecida", "11-02": "Finados",
    "11-15": "Proclamação da República", "12-25": "Natal"
  };
  if (ano >= 2024) fixos["11-20"] = "Dia da Consciência Negra";
  const mapa = {};
  for (const [md, nome] of Object.entries(fixos)) mapa[`${ano}-${md}`] = nome;
  const p = pascoa(ano);
  const dePascoa = (dias, nome) => { mapa[iso(new Date(p.getFullYear(), p.getMonth(), p.getDate() + dias))] = nome; };
  dePascoa(-48, "Carnaval");
  dePascoa(-47, "Carnaval");
  dePascoa(-2, "Sexta-feira Santa");
  dePascoa(60, "Corpus Christi");
  return mapa;
}

// Busca na BrasilAPI. Retorna o mapa ou null se não conseguir.
export async function buscarFeriadosApi(ano) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const lista = await res.json();
    if (!Array.isArray(lista) || !lista.length) return null;
    const mapa = {};
    for (const f of lista) if (f && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) mapa[f.date] = String(f.name || "Feriado");
    return Object.keys(mapa).length ? mapa : null;
  } catch {
    return null;
  }
}

// ---------- Feriados de um mês ----------
// manuais: { "AAAA-MM-DD": { nome, tipo: "extra" | "removido" } }
//   extra    = feriado/folga adicionado por vocês (municipal, ponte...)
//   removido = feriado nacional que vocês não querem descontar
// Retorna [{ data, dia, nome, origem: "nacional" | "extra", conta, diaSemana }] em ordem de data.
export function feriadosDoMes(ym, nacionais, manuais) {
  const saida = new Map();
  for (const [data, nome] of Object.entries(nacionais || {})) {
    if (!data.startsWith(ym + "-")) continue;
    const m = manuais && manuais[data];
    saida.set(data, { data, nome, origem: "nacional", conta: !(m && m.tipo === "removido") });
  }
  for (const [data, m] of Object.entries(manuais || {})) {
    if (!data.startsWith(ym + "-") || !m || m.tipo !== "extra") continue;
    saida.set(data, { data, nome: m.nome || "Folga", origem: "extra", conta: true });
  }
  return [...saida.values()]
    .map((f) => ({ ...f, dia: Number(f.data.slice(8)), diaSemana: diaDaSemana(f.data) }))
    .sort((a, b) => (a.data < b.data ? -1 : 1));
}

export const datasQueContam = (lista) => lista.filter((f) => f.conta).map((f) => f.data);

// Feriados que caem de segunda a sexta e vão tirar dias do trabalho.
export const feriadosEmDiaDeSemana = (lista) => lista.filter((f) => f.conta && f.diaSemana >= 1 && f.diaSemana <= 5);

// Grade do mês: semanas começando no domingo; células vazias = null.
export function gradeDoMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  const vazios = new Date(a, m - 1, 1).getDay();
  const celulas = Array(vazios).fill(null);
  for (let d = 1; d <= diasNoMes(ym); d++) celulas.push(d);
  while (celulas.length % 7) celulas.push(null);
  return celulas;
}
