/* =========================================================
   Cierre de mes de Cashea (solo panel de administración).
   - Totales de cada caja (DECOCINTAS, Mercería de Oriente, Caracas) del mes elegido.
   - Cierre manual con el botón "Cerrar mes". El cierre automático lo corre la base de
     datos a las 11:59 p. m. del último día (hora de Caracas). Si ya se cerró a mano,
     el automático no hace nada: el manual tiene prioridad.
   - Un mes cerrado guarda su resumen y deja de admitir cambios en los datos de sus ventas.
   - Exporta un Excel contable: hoja "Resumen" y una hoja por caja, con encabezados
     azul marino, bordes y totales. Si ExcelJS no carga, se exporta un Excel simple.
   Requiere cashea.js (datos) y la librería ExcelJS (opcional).
   ========================================================= */

const CAJAS_CIERRE = [
  { clave: "decocintas", nombre: "DECOCINTAS", hoja: "Decocintas" },
  { clave: "merceria", nombre: "MERCERÍA DE ORIENTE", hoja: "Mercería de Oriente" },
  { clave: "caracas", nombre: "CARACAS", hoja: "Caracas" },
];
const MESES_CIERRE = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const cierreVista = { periodo: null };
let cierreEnCurso = false;

const nombreMesCierre = periodo => {
  const [anio, mes] = String(periodo).split("-");
  return `${MESES_CIERRE[Number(mes) - 1]} ${anio}`;
};

// Meses que tienen ventas o cierre, más el mes actual. Del más nuevo al más viejo.
function periodosCierre() {
  const conjunto = new Set([mesActualPeriodo()]);
  adm.cashea.forEach(v => { if (v.fecha) conjunto.add(periodoDe(v.fecha)); });
  (adm.cierres || []).forEach(c => conjunto.add(c.periodo));
  return [...conjunto].sort().reverse();
}

// Meses ya terminados que tienen ventas y todavía no se cerraron
function mesesVencidosSinCerrar() {
  const actual = mesActualPeriodo();
  return [...new Set(adm.cashea.map(v => periodoDe(v.fecha)))]
    .filter(p => p && p < actual && !mesCerrado(p))
    .sort();
}

function ventasDelPeriodo(periodo) {
  return adm.cashea.filter(v => periodoDe(v.fecha) === periodo);
}

// Totales por caja. Un mes cerrado usa el resumen guardado; un mes abierto se calcula con las ventas actuales.
function resumenCierre(periodo) {
  const archivo = (adm.cierres || []).find(c => c.periodo === periodo) || null;
  const filas = CAJAS_CIERRE.map(caja => {
    if (archivo) {
      const guardado = (archivo.resumen || []).find(f => f.tienda === caja.clave) || {};
      return {
        caja,
        ventas: Number(guardado.ventas) || 0,
        anuladas: Number(guardado.anuladas) || 0,
        total: redondeo2(guardado.total_usd),
        inicial: redondeo2(guardado.inicial_usd),
        descuento: redondeo2(guardado.descuento_usd),
        liquidacion: redondeo2(guardado.liquidacion_usd),
      };
    }
    const lista = ventasDelPeriodo(periodo).filter(v => v.tienda === caja.clave);
    const activas = lista.filter(v => v.estado !== "anulada").map(v => ({ v, c: calculoCashea(v) }));
    const suma = f => redondeo2(activas.reduce((s, x) => s + f(x), 0));
    return {
      caja,
      ventas: activas.length,
      anuladas: lista.length - activas.length,
      total: suma(x => Number(x.v.monto_total_usd) || 0),
      inicial: suma(x => x.c.inicialUsd),
      descuento: suma(x => x.c.descuentoUsd),
      liquidacion: suma(x => x.c.liquidacionUsd),
    };
  });
  const totales = filas.reduce((t, f) => ({
    ventas: t.ventas + f.ventas,
    anuladas: t.anuladas + f.anuladas,
    total: redondeo2(t.total + f.total),
    inicial: redondeo2(t.inicial + f.inicial),
    descuento: redondeo2(t.descuento + f.descuento),
    liquidacion: redondeo2(t.liquidacion + f.liquidacion),
  }), { ventas: 0, anuladas: 0, total: 0, inicial: 0, descuento: 0, liquidacion: 0 });
  return { archivo, filas, totales };
}

/* ---------- Pantalla ---------- */
function pintarCierre() {
  const selector = $("#cierrePeriodo");
  if (!selector) return;
  const periodos = periodosCierre();
  if (!cierreVista.periodo || !periodos.includes(cierreVista.periodo)) cierreVista.periodo = mesActualPeriodo();
  const p = cierreVista.periodo;

  selector.innerHTML = periodos.map(x =>
    `<option value="${x}" ${x === p ? "selected" : ""}>${nombreMesCierre(x)}${mesCerrado(x) ? " · cerrado" : ""}</option>`).join("");

  const { archivo, filas, totales } = resumenCierre(p);
  const esFuturo = p > mesActualPeriodo();

  $("#cierreEstado").innerHTML = archivo
    ? `<p><span class="pill-estado cobrada">Cerrado</span> <strong>${esc(nombreMesCierre(p))}</strong> · cerrado el ${esc(fechaHoraTxt(archivo.cerrado_en))} por ${esc(archivo.cerrado_por)} (${archivo.tipo === "manual" ? "a mano" : "automático, 11:59 p. m."}). Sus ventas ya no admiten cambios de datos: solo cobrar, anular y comprobar.</p>`
    : `<p><span class="pill-estado pendiente">Abierto</span> <strong>${esc(nombreMesCierre(p))}</strong> · se cierra a las 11:59 p. m. del último día, o cuando lo cierres aquí.</p>`;

  const cuerpo = filas.map(f => `
    <tr>
      <td><strong>${esc(f.caja.nombre)}</strong></td>
      <td>${f.ventas}</td>
      <td>${f.anuladas}</td>
      <td>${usd(f.total)}</td>
      <td>${usd(f.inicial)}</td>
      <td>${usd(f.descuento)}</td>
      <td>${usd(f.liquidacion)}</td>
    </tr>`).join("");
  $("#cierreCajas").innerHTML = `
    <div class="tabla-scroll">
      <table class="tabla-inv">
        <thead><tr><th>Caja</th><th>Ventas</th><th>Anuladas</th><th>Total US$</th><th>Inicial US$</th><th>Descuentos US$</th><th>Liquidación US$</th></tr></thead>
        <tbody>${cuerpo}
          <tr class="fila-total"><td><strong>TOTAL</strong></td><td><strong>${totales.ventas}</strong></td><td><strong>${totales.anuladas}</strong></td><td><strong>${usd(totales.total)}</strong></td><td><strong>${usd(totales.inicial)}</strong></td><td><strong>${usd(totales.descuento)}</strong></td><td><strong>${usd(totales.liquidacion)}</strong></td></tr>
        </tbody>
      </table>
    </div>`;

  const pendientes = mesesVencidosSinCerrar();
  $("#cierrePendientes").innerHTML = pendientes.length
    ? `<div class="card cierre-aviso">
        <p><strong>Hay meses terminados sin cerrar:</strong> ${pendientes.map(nombreMesCierre).map(esc).join(", ")}. Ciérralos para guardar su resumen y bloquear sus datos.</p>
        <button class="btn ghost sm" data-cierre="vencidos">Cerrar meses vencidos</button>
      </div>`
    : "";

  const boton = $("#btnCerrarMes");
  if (boton) {
    boton.hidden = Boolean(archivo) || esFuturo;
    boton.textContent = `Cerrar ${nombreMesCierre(p)}`;
  }

  const historial = adm.cierres || [];
  $("#cierreArchivo").innerHTML = historial.length
    ? `<div class="tabla-scroll"><table class="tabla-inv">
        <thead><tr><th>Mes</th><th>Tipo</th><th>Cerrado por</th><th>Cerrado el</th><th>Ventas</th><th>Total US$</th></tr></thead>
        <tbody>${historial.map(c => `<tr>
          <td><strong>${esc(nombreMesCierre(c.periodo))}</strong></td>
          <td>${c.tipo === "manual" ? "A mano" : "Automático"}</td>
          <td>${esc(c.cerrado_por)}</td>
          <td>${esc(fechaHoraTxt(c.cerrado_en))}</td>
          <td>${Number(c.ventas) || 0}</td>
          <td>${usd(c.total_usd)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`
    : `<p class="muted" style="padding:14px 8px">Todavía no hay meses cerrados.</p>`;
}

/* ---------- Cierre ---------- */
async function cerrarMesManual() {
  const p = cierreVista.periodo;
  if (!p || cierreEnCurso) return;
  if (!confirm(`¿Cerrar ${nombreMesCierre(p)}?\n\nSe guarda el resumen del mes. Después, las ventas de ese mes ya no podrán cambiar sus datos: solo se podrán cobrar, anular y comprobar.`)) return;
  cierreEnCurso = true;
  try {
    const { data, error } = await sb.rpc("cerrar_mes", { p_periodo: p });
    if (error) throw error;
    toast(data && data.ya_cerrado
      ? "Ese mes ya estaba cerrado."
      : `${nombreMesCierre(p)} cerrado: ${data.ventas} venta(s), ${usd(data.total_usd)}.`);
    await refrescarCashea();
  } catch (err) {
    toast("No se pudo cerrar el mes: " + (err.message || "error"));
  } finally {
    cierreEnCurso = false;
  }
}

async function cerrarMesesVencidos() {
  if (cierreEnCurso) return;
  const pendientes = mesesVencidosSinCerrar();
  if (!pendientes.length) return toast("No hay meses vencidos sin cerrar.");
  if (!confirm(`¿Cerrar estos meses terminados?\n\n${pendientes.map(nombreMesCierre).join("\n")}`)) return;
  cierreEnCurso = true;
  try {
    const { data, error } = await sb.rpc("cerrar_meses_vencidos");
    if (error) throw error;
    toast(`Meses cerrados: ${data.cerrados}.`);
    await refrescarCashea();
  } catch (err) {
    toast("No se pudieron cerrar los meses: " + (err.message || "error"));
  } finally {
    cierreEnCurso = false;
  }
}

/* ---------- Excel contable ---------- */
const XL = {
  azul: "FF1F3864",
  gris: "FFD9D9D9",
  grisTexto: "FF595959",
  blanco: "FFFFFFFF",
  linea: "FF8C8C8C",
  formato: "#,##0.00",
};
const bordeXL = {
  top: { style: "thin", color: { argb: XL.linea } },
  left: { style: "thin", color: { argb: XL.linea } },
  bottom: { style: "thin", color: { argb: XL.linea } },
  right: { style: "thin", color: { argb: XL.linea } },
};
const rellenoXL = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function encabezadoBloqueXL(ws, periodo, columnas) {
  ws.mergeCells(1, 1, 1, columnas);
  const titulo = ws.getCell(1, 1);
  titulo.value = "MERCERÍA DE ORIENTE · CASHEA";
  titulo.font = { bold: true, size: 13, color: { argb: XL.blanco } };
  titulo.fill = rellenoXL(XL.azul);
  titulo.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, columnas);
  const subtitulo = ws.getCell(2, 1);
  subtitulo.value = `Cierre de ventas · ${nombreMesCierre(periodo)} (${periodo})`;
  subtitulo.font = { bold: true, size: 11, color: { argb: XL.azul } };

  ws.mergeCells(3, 1, 3, columnas);
  const generado = ws.getCell(3, 1);
  generado.value = `Generado el ${fechaHoraTxt(new Date().toISOString())} por ${adm.usuaria || "—"}`;
  generado.font = { italic: true, size: 9, color: { argb: XL.grisTexto } };
}

function encabezadoTablaXL(ws, fila, titulos) {
  const fijas = ws.getRow(fila);
  titulos.forEach((titulo, i) => {
    const celda = fijas.getCell(i + 1);
    celda.value = titulo;
    celda.font = { bold: true, size: 10, color: { argb: XL.blanco } };
    celda.fill = rellenoXL(XL.azul);
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    celda.border = bordeXL;
  });
  fijas.height = 32;
}

function hojaResumenXL(libro, periodo, filas, totales) {
  const ws = libro.addWorksheet("Resumen");
  const columnas = ["Caja", "Ventas", "Anuladas", "Total (US$)", "Inicial (US$)", "Descuentos (US$)", "Liquidación (US$)"];
  encabezadoBloqueXL(ws, periodo, columnas.length);
  encabezadoTablaXL(ws, 5, columnas);
  ws.columns = [{ width: 26 }, { width: 10 }, { width: 11 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }];

  filas.forEach((f, i) => {
    const fila = 6 + i;
    const valores = [f.caja.nombre, f.ventas, f.anuladas, f.total, f.inicial, f.descuento, f.liquidacion];
    valores.forEach((valor, j) => {
      const celda = ws.getRow(fila).getCell(j + 1);
      celda.value = valor;
      celda.border = bordeXL;
      if (j >= 3) celda.numFmt = XL.formato;
      if (j === 0) celda.font = { bold: true };
    });
  });

  const ultima = 6 + filas.length - 1;
  const filaTotal = ultima + 1;
  const celdas = [
    { valor: "TOTAL", formula: null },
    { valor: totales.ventas, formula: `SUM(B6:B${ultima})` },
    { valor: totales.anuladas, formula: `SUM(C6:C${ultima})` },
    { valor: totales.total, formula: `SUM(D6:D${ultima})` },
    { valor: totales.inicial, formula: `SUM(E6:E${ultima})` },
    { valor: totales.descuento, formula: `SUM(F6:F${ultima})` },
    { valor: totales.liquidacion, formula: `SUM(G6:G${ultima})` },
  ];
  celdas.forEach((c, j) => {
    const celda = ws.getRow(filaTotal).getCell(j + 1);
    celda.value = c.formula ? { formula: c.formula, result: c.valor } : c.valor;
    celda.font = { bold: true };
    celda.fill = rellenoXL(XL.gris);
    celda.border = bordeXL;
    if (j >= 3) celda.numFmt = XL.formato;
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
}

function hojaCajaXL(libro, periodo, caja) {
  const ws = libro.addWorksheet(caja.hoja);
  const columnas = [
    "Nº", "Fecha", "Factura", "Nombre", "Apellido", "Cédula", "Monto total (US$)", "Tasa BCV de venta (Bs)",
    "Método de pago (inicial)", "Inicial (US$)", "Financiado (US$)", "Descuentos (US$)", "Liquidación (US$)",
    "Estado", "Pago de Cashea (Bs)", "Resultado de la comprobación", "Detalles",
  ];
  encabezadoBloqueXL(ws, periodo, columnas.length);
  encabezadoTablaXL(ws, 5, columnas);
  ws.columns = [
    { width: 6 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 },
    { width: 15 }, { width: 15 }, { width: 18 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 15 },
    { width: 12 }, { width: 16 }, { width: 22 }, { width: 46 },
  ];

  const lista = ventasDelPeriodo(periodo)
    .filter(v => v.tienda === caja.clave)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.factura).localeCompare(String(b.factura), "es")));

  if (!lista.length) {
    ws.mergeCells(6, 1, 6, columnas.length);
    const vacio = ws.getCell(6, 1);
    vacio.value = "Sin ventas en este mes";
    vacio.font = { italic: true, color: { argb: XL.grisTexto } };
    vacio.alignment = { horizontal: "center" };
    vacio.border = bordeXL;
  }

  let sumas = { total: 0, inicial: 0, financiado: 0, descuento: 0, liquidacion: 0, pagado: 0 };
  lista.forEach((v, i) => {
    const fila = 6 + i;
    const c = calculoCashea(v);
    const r = compararCashea(v);
    const anulada = v.estado === "anulada";
    const detalles = [`Registrada por ${v.registrado_por || "—"}`];
    if (v.liq_fecha) detalles.push(`Pagada por Cashea el ${fechaTxt(v.liq_fecha)} a tasa ${numeroVE(v.liq_tasa)}`);
    if (v.liq_nota) detalles.push(`Nota: ${v.liq_nota}`);
    if (anulada) detalles.push("Anulada (no suma en los totales)");

    const valores = [
      i + 1,
      v.fecha ? new Date(`${v.fecha}T00:00:00`) : "",
      v.factura,
      v.nombre,
      v.apellido,
      v.cedula || "",
      Number(v.monto_total_usd) || 0,
      Number(v.tasa) || 0,
      v.metodo_pago || "",
      c.inicialUsd,
      c.financiadoUsd,
      c.descuentoUsd,
      c.liquidacionUsd,
      ESTADOS_CASHEA[v.estado] || v.estado,
      r ? r.recibidoBs : "",
      r ? RESULTADO_CASHEA[r.estado] : "Sin comprobar",
      detalles.join(" · "),
    ];
    valores.forEach((valor, j) => {
      const celda = ws.getRow(fila).getCell(j + 1);
      celda.value = valor;
      celda.border = bordeXL;
      celda.alignment = { vertical: "middle", wrapText: j === 16 };
      if (j === 1) celda.numFmt = "dd/mm/yyyy";
      if ([6, 7, 9, 10, 11, 12, 14].includes(j)) celda.numFmt = XL.formato;
      if (anulada) celda.font = { italic: true, color: { argb: XL.grisTexto } };
    });

    if (!anulada) {
      sumas.total += Number(v.monto_total_usd) || 0;
      sumas.inicial += c.inicialUsd;
      sumas.financiado += c.financiadoUsd;
      sumas.descuento += c.descuentoUsd;
      sumas.liquidacion += c.liquidacionUsd;
      sumas.pagado += r ? r.recibidoBs : 0;
    }
  });

  // Fila de totales: suma solo las ventas que no están anuladas
  const filaTotal = 6 + Math.max(lista.length, 1);
  const ultima = filaTotal - 1;
  ws.mergeCells(filaTotal, 1, filaTotal, 6);
  const etiqueta = ws.getCell(filaTotal, 1);
  etiqueta.value = `TOTAL ${caja.nombre} (sin anuladas)`;
  etiqueta.font = { bold: true };
  const formulaSuma = col => `SUMIFS(${col}6:${col}${ultima},N6:N${ultima},"<>Anulada")`;
  const totales = [
    { col: 7, letra: "G", valor: redondeo2(sumas.total) },
    { col: 10, letra: "J", valor: redondeo2(sumas.inicial) },
    { col: 11, letra: "K", valor: redondeo2(sumas.financiado) },
    { col: 12, letra: "L", valor: redondeo2(sumas.descuento) },
    { col: 13, letra: "M", valor: redondeo2(sumas.liquidacion) },
    { col: 15, letra: "O", valor: redondeo2(sumas.pagado) },
  ];
  for (let j = 1; j <= columnas.length; j++) {
    const celda = ws.getRow(filaTotal).getCell(j);
    celda.fill = rellenoXL(XL.gris);
    celda.border = bordeXL;
    celda.font = { bold: true };
  }
  totales.forEach(t => {
    const celda = ws.getRow(filaTotal).getCell(t.col);
    celda.value = lista.length ? { formula: formulaSuma(t.letra), result: t.valor } : 0;
    celda.numFmt = XL.formato;
  });

  ws.views = [{ state: "frozen", ySplit: 5, xSplit: 3 }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, 5 + lista.length), column: columnas.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Respaldo sin formato, por si ExcelJS no cargó
function exportarCierreSimple(periodo) {
  const libro = XLSX.utils.book_new();
  const { filas, totales } = resumenCierre(periodo);
  const resumen = [
    ["Caja", "Ventas", "Anuladas", "Total (US$)", "Inicial (US$)", "Descuentos (US$)", "Liquidación (US$)"],
    ...filas.map(f => [f.caja.nombre, f.ventas, f.anuladas, f.total, f.inicial, f.descuento, f.liquidacion]),
    ["TOTAL", totales.ventas, totales.anuladas, totales.total, totales.inicial, totales.descuento, totales.liquidacion],
  ];
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(resumen), "Resumen");
  CAJAS_CIERRE.forEach(caja => {
    const filasCaja = ventasDelPeriodo(periodo).filter(v => v.tienda === caja.clave).map(v => {
      const c = calculoCashea(v);
      const r = compararCashea(v);
      return [fechaTxt(v.fecha), v.factura, v.nombre, v.apellido, v.cedula || "", Number(v.monto_total_usd) || 0,
        v.metodo_pago || "", c.inicialUsd, c.financiadoUsd, c.descuentoUsd, c.liquidacionUsd,
        ESTADOS_CASHEA[v.estado] || v.estado, r ? r.recibidoBs : "", v.registrado_por || ""];
    });
    const cab = ["Fecha", "Factura", "Nombre", "Apellido", "Cédula", "Monto total (US$)", "Método de pago",
      "Inicial (US$)", "Financiado (US$)", "Descuentos (US$)", "Liquidación (US$)", "Estado", "Pago de Cashea (Bs)", "Registrada por"];
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([cab, ...filasCaja]), caja.hoja);
  });
  XLSX.writeFile(libro, `Cierre_Cashea_${periodo}.xlsx`);
}

async function exportarCierre() {
  const periodo = cierreVista.periodo;
  if (!periodo) return;
  if (typeof ExcelJS === "undefined") {
    toast("No cargó el formato contable de Excel: se exporta una versión simple.");
    return exportarCierreSimple(periodo);
  }
  try {
    const libro = new ExcelJS.Workbook();
    libro.creator = "Mercería de Oriente";
    libro.created = new Date();
    const { filas, totales } = resumenCierre(periodo);
    hojaResumenXL(libro, periodo, filas, totales);
    CAJAS_CIERRE.forEach(caja => hojaCajaXL(libro, periodo, caja));
    const buffer = await libro.xlsx.writeBuffer();
    descargarArchivo(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Cierre_Cashea_${periodo}.xlsx`
    );
    toast(`Excel de ${nombreMesCierre(periodo)} listo.`);
  } catch (err) {
    toast("No se pudo crear el Excel: " + (err.message || "error"));
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("change", (e) => {
  if (e.target.id !== "cierrePeriodo") return;
  cierreVista.periodo = e.target.value;
  pintarCierre();
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cierre]");
  if (!b) return;
  if (b.dataset.cierre === "exportar") return exportarCierre();
  if (b.dataset.cierre === "cerrar") return cerrarMesManual();
  if (b.dataset.cierre === "vencidos") return cerrarMesesVencidos();
});
