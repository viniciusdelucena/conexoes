// Calendário: dias úteis do mês. Contam de segunda a sábado.
// Os feriados entram na Fase 4: a função já aceita a lista de datas a descontar.

export function diasNoMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  return new Date(a, m, 0).getDate();
}

// feriados: datas "AAAA-MM-DD" que não contam como dia útil.
export function diasUteisDoMes(ym, feriados = []) {
  const [a, m] = ym.split("-").map(Number);
  const folgas = new Set(feriados);
  let n = 0;
  for (let d = 1; d <= diasNoMes(ym); d++) {
    if (new Date(a, m - 1, d).getDay() === 0) continue; // domingo
    if (folgas.has(`${ym}-${String(d).padStart(2, "0")}`)) continue;
    n++;
  }
  return n;
}
