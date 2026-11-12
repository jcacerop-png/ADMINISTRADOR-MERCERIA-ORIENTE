"use strict";
/* =========================================================
   Analítica de ventas: día, semana, mes y año; gráfica,
   rankings y descarga de Excel del periodo que se ve.
   Requiere config.js, comun.js y admin.js (cargados antes).
   Las ventas se leen de la tabla "ventas" (solo panel).
   ========================================================= */

const DEF_N = { dia: 14, semana: 12, mes: 12, anio: 5 };
const an = {
  modo: "dia",
  ref: null,        // inicio del periodo que se está viendo
  n: DEF_N.dia,     // cuántos periodos muestra la gráfica
  ventas: [],       // ventas de los periodos de la gráfica
  chart: null,
};
an.ref = inicioPeriodo(new Date(), an.modo);

const sumar = (lista, f) => lista.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const claveFecha = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const f2 = d => d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });

/* ---------- Fechas de periodos ---------- */
function inicioPeriodo(d, modo) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (modo === "semana") x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // lunes
  if (modo === "mes") x.setDate(1);
  if (modo === "anio") return new Date(x.getFullYear(), 0, 1);
  return x;
}

function avanzar(d, modo, k) {
  const x = new Date(d);
  if (modo === "dia") x.setDate(x.getDate() + k);
  else if (modo === "semana") x.setDate(x.getDate() + 7 * k);
  else if (modo === "mes") x.setMonth(x.getMonth() + k);
  else x.setFullYear(x.getFullYear() + k);
  return x;
}

const finPeriodo = (ini, modo) => avanzar(ini, modo, 1);

function etiquetaPeriodo(ini, modo) {
  if (modo === "dia") return ini.toLocaleDateString("es-VE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  if (modo === "semana") return `Del ${f2(ini)} al ${f2(avanzar(ini, "dia", 6))}`;
  if (modo === "mes") return ini.toLocaleDateString("es-VE", { month: "long", year: "numeric" });
  return String(ini.getFullYear());
}

function etiquetaCorta(ini, modo) {
  if (modo === "dia") return ini.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" });
  if (modo === "semana") return "Sem " + ini.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" });
  if (modo === "mes") return ini.toLocaleDateString("es-VE", { month: "short", year: "2-digit" });
  return String(ini.getFullYear());
}

function etiquetaArchivo(ini, modo) {
  if (modo === "dia") return claveFecha(ini);
  if (modo === "semana") return `Semana_${claveFecha(ini)}`;
  if (modo === "mes") return `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}`;
  return String(ini.getFullYear());
}

/* ---------- Lectura de ventas (por bloques, sin el límite de 1000 filas) ---------- */
async function obtenerVentas(desde, hasta) {
  const filas = [];
  const TAM = 1000;
  for (let inicio = 0; ; inicio += TAM) {
    const { data, error } = await sb.from("ventas").select("*")
      .gte("creado_en", desde.toISOString())
      .lt("creado_en", hasta.toISOString())
      .order("creado_en", { ascending: true })
      .range(inicio, inicio + TAM - 1);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < TAM) break;
  }
  return filas;
}

/* ---------- Cálculos ---------- */
function resumen(ventas) {
  const activas = ventas.filter(v => !v.anulada);
  const lineas = activas.flatMap(v => (Array.isArray(v.items) ? v.items : []).map(it => ({ ...it, venta: v })));
  const ingresos = sumar(activas, v => v.total);
  const costo = sumar(activas, v => v.costo_total);
  return {
    ventas: activas.length,
    anuladas: ventas.length - activas.length,
    unidades: sumar(lineas, l => l.cantidad),
    ingresos,
    costo,
    ganancia: ingresos - costo,
    ticket: activas.length ? ingresos / activas.length : 0,
    lineas,
    activas,
  };
}

function rankingProductos(lineas) {
  const mapa = new Map();
  for (const l of lineas) {
    const clave = l.producto_id || l.nombre;
    if (!mapa.has(clave)) mapa.set(clave, { nombre: l.nombre, unidades: 0, ingresos: 0, ganancia: 0 });
    const r = mapa.get(clave);
    r.unidades += Number(l.cantidad) || 0;
    r.ingresos += (Number(l.precio) || 0) * (Number(l.cantidad) || 0);
    r.ganancia += ((Number(l.precio) || 0) - (Number(l.costo) || 0)) * (Number(l.cantidad) || 0);
  }
  return [...mapa.values()].sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, "es"));
}

function porMetodo(activas) {
  const mapa = new Map();
  for (const v of activas) {
    const k = v.metodo || "Otro";
    if (!mapa.has(k)) mapa.set(k, { nombre: k, n: 0, total: 0 });
    const r = mapa.get(k);
    r.n += 1;
    r.total += Number(v.total) || 0;
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

const ventasDeBin = (ventas, ini, modo) => ventas.filter(v => claveFecha(inicioPeriodo(new Date(v.creado_en), modo)) === claveFecha(ini));

/* ---------- Carga y pintado ---------- */
async function refrescarAnalitica() {
  if (!sb) return;
  const bins = Array.from({ length: an.n }, (_, i) => avanzar(an.ref, an.modo, i - (an.n - 1)));
  try {
    an.ventas = await obtenerVentas(bins[0], finPeriodo(an.ref, an.modo));
  } catch (err) {
    an.ventas = [];
    toast("No se pudieron cargar las ventas: " + (err.message || "error"));
  }
  pintarAnalitica();
}

function pintarAnalitica() {
  $$("#segModo button").forEach(b => b.classList.toggle("on", b.dataset.modo === an.modo));
  $("#periodoTxt").textContent = etiquetaPeriodo(an.ref, an.modo);
  $("#zOut").disabled = an.n >= 60;
  $("#zIn").disabled = an.n <= 2;

  const bins = Array.from({ length: an.n }, (_, i) => avanzar(an.ref, an.modo, i - (an.n - 1)));
  const porBin = bins.map(ini => ({ ini, ...resumen(ventasDeBin(an.ventas, ini, an.modo)) }));
  const actual = porBin[porBin.length - 1];

  $("#kpisVenta").innerHTML = [
    tarjetaKpi("Ventas", actual.ventas, `${actual.anuladas} anulada(s)`),
    tarjetaKpi("Artículos vendidos", actual.unidades, "Piezas en el periodo"),
    tarjetaKpi("Ingresos", usd(actual.ingresos), "En dólares"),
    tarjetaKpi("Costo de lo vendido", usd(actual.costo), "Lo que te costó"),
    tarjetaKpi("Ganancia", usd(actual.ganancia), "Ingresos − costo"),
    tarjetaKpi("Ticket promedio", usd(actual.ticket), "Por venta"),
  ].join("");

  pintarGrafico(porBin);
  pintarRankings(actual.lineas);

  $("#ventasPeriodo").innerHTML = actual.activas.slice().reverse().slice(0, 80).map(v => `
    <li class="linea">
      <div><b>${new Date(v.creado_en).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })} · ${esc(v.metodo)}</b>
        <small>${(v.items || []).map(i => `${i.cantidad}× ${esc(i.nombre)} (${esc(i.variante)})`).join(", ")} · ${esc(v.usuaria)}</small></div>
      <strong>${usd(v.total)}</strong>
    </li>`).join("") || `<li class="muted small">No hay ventas en este periodo.</li>`;

  $("#metodosPago").innerHTML = porMetodo(actual.activas).map(m => `
    <li class="linea"><div><b>${esc(m.nombre)}</b><small>${m.n} venta(s)</small></div><strong>${usd(m.total)}</strong></li>`).join("")
    || `<li class="muted small">Sin ventas en este periodo.</li>`;

  // Si la librería de la gráfica no cargó, el aviso de pintarGrafico se conserva
  if (typeof Chart !== "undefined") {
    $("#graficoVacio").textContent = actual.ventas || porBin.some(b => b.ventas) ? "" : "Aún no hay ventas en los periodos que se ven.";
  }
}

function tarjetaKpi(titulo, valor, pie = "") {
  return `<div class="card kpi"><small>${titulo}</small><strong>${valor}</strong>${pie ? `<span>${pie}</span>` : ""}</div>`;
}

function pintarGrafico(porBin) {
  const canvas = $("#grafico");
  if (an.chart) { an.chart.destroy(); an.chart = null; }
  if (typeof Chart === "undefined") {
    $("#graficoVacio").textContent = "La gráfica no cargó. Revisa tu conexión; las cifras de abajo sí están al día.";
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const color = n => css.getPropertyValue(n).trim() || "#888";
  an.chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: porBin.map(b => etiquetaCorta(b.ini, an.modo)),
      datasets: [
        { label: "Ingresos (USD)", data: porBin.map(b => b.ingresos), backgroundColor: "#FACC15", borderRadius: 8, maxBarThickness: 42 },
        { label: "Ganancia (USD)", data: porBin.map(b => b.ganancia), backgroundColor: color("--muted"), borderRadius: 8, maxBarThickness: 42 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: color("--ink") } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${usd(c.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: color("--muted") }, grid: { display: false } },
        y: { ticks: { color: color("--muted"), callback: v => "$" + v }, grid: { color: color("--line") } },
      },
    },
  });
}

function pintarRankings(lineas) {
  const r = rankingProductos(lineas);
  if (!r.length) {
    $("#rankings").innerHTML = `<div class="card"><p class="muted">Cuando registres ventas en este periodo, aquí verás el ranking.</p></div>`;
    return;
  }
  const mejor = r[0];
  const peor = r[r.length - 1];
  const medio = r.slice(1, -1);
  $("#rankings").innerHTML = `
    <div class="card">
      <p class="eyebrow">Más vendido</p>
      <div class="rank-big">${esc(mejor.nombre)}<small>${mejor.unidades} unidad(es) · ${usd(mejor.ingresos)}</small></div>
    </div>
    <div class="card">
      <p class="eyebrow">Menos vendido</p>
      <div class="rank-big">${esc(peor.nombre)}<small>${peor.unidades} unidad(es) · ${usd(peor.ingresos)}</small></div>
    </div>
    <div class="card">
      <p class="eyebrow">Resto de productos</p>
      ${medio.length ? medio.map(x => `<div class="rank-item"><span>${esc(x.nombre)}</span><strong>${x.unidades} ud.</strong></div>`).join("")
        : `<p class="muted small">No hay productos intermedios en este periodo.</p>`}
    </div>`;
}

/* ---------- Navegación ---------- */
function cambiarModo(modo) {
  an.modo = modo;
  an.n = DEF_N[modo];
  an.ref = inicioPeriodo(new Date(), modo);
  refrescarAnalitica();
}

function moverPeriodo(k) {
  const destino = avanzar(an.ref, an.modo, k);
  if (destino > inicioPeriodo(new Date(), an.modo)) return toast("Ese periodo todavía no llega");
  an.ref = destino;
  refrescarAnalitica();
}

function cambiarN(delta) {
  an.n = Math.min(60, Math.max(2, an.n + delta));
  refrescarAnalitica();
}

/* ---------- Excel del periodo ---------- */
const FORMATO_USD = '"$"#,##0.00';
const FORMATO_ENTERO = "#,##0";

function celda(valor, formato, formula) {
  const c = { v: valor, t: typeof valor === "number" ? "n" : "s" };
  if (formato) c.z = formato;
  if (formula) { c.f = formula; c.t = "n"; }
  return c;
}

function descargarExcel() {
  if (typeof XLSX === "undefined") return toast("El generador de Excel no cargó. Revisa tu conexión.");
  if (!sb) return toast("Falta configurar Supabase en config.js");

  const ini = an.ref;
  const modo = an.modo;
  const periodo = etiquetaPeriodo(ini, modo);
  const delPeriodo = an.ventas.filter(v => claveFecha(inicioPeriodo(new Date(v.creado_en), modo)) === claveFecha(ini));
  const r = resumen(delPeriodo);
  const libro = XLSX.utils.book_new();

  /* Hoja 1: resumen */
  const filasResumen = [
    [celda("MERCERÍA DE ORIENTE · REPORTE DE VENTAS")],
    [celda("Periodo"), celda(periodo)],
    [celda("Generado"), celda(new Date().toLocaleString("es-VE"))],
    [],
    [celda("Indicador"), celda("Valor")],
    [celda("Ventas realizadas"), celda(r.ventas, FORMATO_ENTERO)],
    [celda("Artículos vendidos"), celda(r.unidades, FORMATO_ENTERO)],
    [celda("Ingresos (USD)"), celda(r.ingresos, FORMATO_USD)],
    [celda("Costo de lo vendido (USD)"), celda(r.costo, FORMATO_USD)],
    [celda("Ganancia (USD)"), celda(r.ganancia, FORMATO_USD)],
    [celda("Ticket promedio (USD)"), celda(r.ticket, FORMATO_USD)],
    [celda("Ventas anuladas (no se incluyen)"), celda(r.anuladas, FORMATO_ENTERO)],
    [],
    [celda("Método de pago"), celda("Ventas"), celda("Ingresos (USD)")],
    ...porMetodo(r.activas).map(m => [celda(m.nombre), celda(m.n, FORMATO_ENTERO), celda(m.total, FORMATO_USD)]),
  ];
  const hojaResumen = XLSX.utils.aoa_to_sheet(filasResumen);
  hojaResumen["!cols"] = [{ wch: 36 }, { wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(libro, hojaResumen, "Resumen");

  /* Hoja 2: por producto (con totales en fórmula) */
  const prod = rankingProductos(r.lineas);
  const cabProd = ["Producto", "Tipo", "Unidades", "Ingresos (USD)", "Costo (USD)", "Ganancia (USD)"].map(t => celda(t));
  const filasProd = [cabProd];
  prod.forEach(p => {
    const costo = r.lineas.filter(l => l.nombre === p.nombre).reduce((a, l) => a + (Number(l.costo) || 0) * (Number(l.cantidad) || 0), 0);
    const tipo = (r.lineas.find(l => l.nombre === p.nombre) || {}).tipo;
    filasProd.push([
      celda(p.nombre), celda(CATEGORIAS[tipo] || "—"),
      celda(p.unidades, FORMATO_ENTERO), celda(p.ingresos, FORMATO_USD),
      celda(costo, FORMATO_USD), celda(p.ganancia, FORMATO_USD),
    ]);
  });
  const ultimaProd = filasProd.length + 1;
  if (prod.length) {
    const sumaCol = (col, valor) => celda(valor, col === "C" ? FORMATO_ENTERO : FORMATO_USD, `SUM(${col}2:${col}${ultimaProd - 1})`);
    filasProd.push([
      celda("TOTAL"), celda(""),
      sumaCol("C", prod.reduce((a, p) => a + p.unidades, 0)),
      sumaCol("D", prod.reduce((a, p) => a + p.ingresos, 0)),
      sumaCol("E", r.costo),
      sumaCol("F", prod.reduce((a, p) => a + p.ganancia, 0)),
    ]);
  }
  const hojaProd = XLSX.utils.aoa_to_sheet(filasProd);
  hojaProd["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(libro, hojaProd, "Por producto");

  /* Hoja 3: detalle de cada venta (una fila por prenda) */
  const cabDet = ["Fecha", "Hora", "N° venta", "Método de pago", "Producto", "Tipo", "Variante", "Cantidad",
    "Precio unitario (USD)", "Subtotal (USD)", "Costo unitario (USD)", "Ganancia (USD)", "Registró", "Nota"].map(t => celda(t));
  const filasDet = [cabDet];
  const ordenadas = [...r.activas].sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
  ordenadas.forEach((v, idx) => {
    const d = new Date(v.creado_en);
    (Array.isArray(v.items) ? v.items : []).forEach(it => {
      const cant = Number(it.cantidad) || 0;
      const precio = Number(it.precio) || 0;
      const costo = Number(it.costo) || 0;
      filasDet.push([
        celda(f2(d)), celda(d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })),
        celda(idx + 1, FORMATO_ENTERO), celda(v.metodo || ""), celda(it.nombre || ""), celda(CATEGORIAS[it.tipo] || ""),
        celda(it.variante || ""), celda(cant, FORMATO_ENTERO), celda(precio, FORMATO_USD),
        celda(precio * cant, FORMATO_USD), celda(costo, FORMATO_USD), celda((precio - costo) * cant, FORMATO_USD),
        celda(v.usuaria || ""), celda(v.nota || ""),
      ]);
    });
  });
  if (filasDet.length > 1) {
    const ultima = filasDet.length;
    const sumaDet = (col, valor) => celda(valor, col === "H" ? FORMATO_ENTERO : FORMATO_USD, `SUM(${col}2:${col}${ultima})`);
    filasDet.push([
      celda("TOTAL"), celda(""), celda(""), celda(""), celda(""), celda(""), celda(""),
      sumaDet("H", r.unidades),
      celda(""),
      sumaDet("J", r.ingresos),
      celda(""),
      sumaDet("L", r.ganancia),
      celda(""), celda(""),
    ]);
  }
  const hojaDet = XLSX.utils.aoa_to_sheet(filasDet);
  hojaDet["!cols"] = [
    { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 10 },
    { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 30 },
  ];
  hojaDet["!autofilter"] = { ref: `A1:N${Math.max(1, filasDet.length - 1)}` };
  XLSX.utils.book_append_sheet(libro, hojaDet, "Detalle de ventas");

  XLSX.writeFile(libro, `Ventas_${modo}_${etiquetaArchivo(ini, modo)}.xlsx`);
  toast("Excel descargado ✔");
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  const modo = t.closest("[data-modo]");
  if (modo && t.closest("#segModo")) return cambiarModo(modo.dataset.modo);
  if (t.closest("#pAtras")) return moverPeriodo(-1);
  if (t.closest("#pAdel")) return moverPeriodo(1);
  if (t.closest("#zIn")) return cambiarN(-1);
  if (t.closest("#zOut")) return cambiarN(1);
  if (t.closest("#btnExcel")) return descargarExcel();
});

// Rueda del mouse sobre la gráfica (PC): acercar o alejar periodos
document.addEventListener("wheel", (e) => {
  if (!e.target.closest || !e.target.closest(".chart-wrap")) return;
  e.preventDefault();
  cambiarN(e.deltaY > 0 ? 1 : -1);
}, { passive: false });
