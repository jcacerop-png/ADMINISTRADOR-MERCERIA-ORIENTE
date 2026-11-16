"use strict";
/* =========================================================
   Excel de Cashea por tienda (botón "Exportar Excel" de cada pestaña
   de Cashea). Usa el mismo formato contable que el cierre de mes:
   encabezado azul, bordes, totales con fórmula y filtro en la tabla.
   - Cada tienda sale en su propia hoja, con las ventas que se ven en
     la pantalla (respeta el filtro de estado y la búsqueda).
   - En "Cashea total" salen todas las tiendas que tengan ventas.
   - La hoja "Resumen" trae los totales de cada tienda incluida.
   Requiere cashea.js (datos y cálculos), cierre.js (colores, bordes
   y descarga del Excel contable) y la librería ExcelJS. Si ExcelJS
   no carga, se exporta la versión simple (exportarCasheaSimple).
   ========================================================= */

const COLUMNAS_VENTAS_XL = [
  "Nº", "Fecha", "Factura", "Nombre", "Apellido", "Cédula", "Monto total (US$)", "Tasa BCV de venta (Bs)",
  "Método de pago (inicial)", "Inicial (US$)", "Financiado (US$)", "Descuentos (US$)", "Liquidación (US$)",
  "Estado", "Pago de Cashea (Bs)", "Resultado de la comprobación", "Detalles",
];
const ANCHOS_VENTAS_XL = [6, 12, 14, 16, 16, 14, 15, 15, 18, 13, 14, 14, 15, 12, 16, 22, 46];
const COLUMNAS_RESUMEN_XL = ["Tienda", "Ventas", "Anuladas", "Total (US$)", "Inicial (US$)", "Descuentos (US$)", "Liquidación (US$)"];
const FILTROS_VENTAS_XL = { todas: "Todas", pendiente: "Pendientes", cobrada: "Cobradas", anulada: "Anuladas" };

// Nombre de archivo sin tildes ni espacios: "Mercería de Oriente" → "Merceria_de_Oriente"
const nombreArchivoXL = texto => String(texto)
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Texto del filtro que está en pantalla (estado y búsqueda), para el subtítulo del Excel
function descripcionFiltroXL() {
  const partes = [FILTROS_VENTAS_XL[vistaCashea.filtro] || "Todas"];
  if (String(vistaCashea.q || "").trim()) partes.push(`búsqueda "${String(vistaCashea.q).trim()}"`);
  return partes.join(" · ");
}

// Orden de las filas: por fecha y luego por número de factura
const ordenVentasXL = (a, b) => {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return String(a.factura).localeCompare(String(b.factura), "es");
};

// Totales de una lista de ventas. Las anuladas cuentan solo como anuladas, no suman dinero
function totalesVentasXL(lista) {
  const t = { ventas: 0, anuladas: 0, total: 0, inicial: 0, descuento: 0, liquidacion: 0 };
  lista.forEach(v => {
    if (v.estado === "anulada") { t.anuladas++; return; }
    const c = calculoCashea(v);
    t.ventas++;
    t.total += Number(v.monto_total_usd) || 0;
    t.inicial += c.inicialUsd;
    t.descuento += c.descuentoUsd;
    t.liquidacion += c.liquidacionUsd;
  });
  return {
    ventas: t.ventas, anuladas: t.anuladas,
    total: redondeo2(t.total), inicial: redondeo2(t.inicial),
    descuento: redondeo2(t.descuento), liquidacion: redondeo2(t.liquidacion),
  };
}

// Encabezado de tres líneas (título, subtítulo, quién y cuándo) que usan todas las hojas
function encabezadoVentasXL(ws, titulo, subtitulo, columnas) {
  ws.mergeCells(1, 1, 1, columnas);
  const celdaTitulo = ws.getCell(1, 1);
  celdaTitulo.value = titulo;
  celdaTitulo.font = { bold: true, size: 13, color: { argb: XL.blanco } };
  celdaTitulo.fill = rellenoXL(XL.azul);
  celdaTitulo.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, columnas);
  const celdaSub = ws.getCell(2, 1);
  celdaSub.value = subtitulo;
  celdaSub.font = { bold: true, size: 11, color: { argb: XL.azul } };

  ws.mergeCells(3, 1, 3, columnas);
  const celdaGenerado = ws.getCell(3, 1);
  celdaGenerado.value = `Generado el ${fechaHoraTxt(new Date().toISOString())} por ${adm.usuaria || "—"}`;
  celdaGenerado.font = { italic: true, size: 9, color: { argb: XL.grisTexto } };
}

// Hoja "Resumen": una fila por tienda incluida y la fila de TOTAL con fórmulas
function hojaResumenVentasXL(libro, claves, porTienda, filtroTxt) {
  const ws = libro.addWorksheet("Resumen");
  const columnas = COLUMNAS_RESUMEN_XL;
  encabezadoVentasXL(ws, "CASHEA · RESUMEN POR TIENDA", `Ventas · filtro: ${filtroTxt}`, columnas.length);
  encabezadoTablaXL(ws, 5, columnas);
  ws.columns = [{ width: 26 }, { width: 10 }, { width: 11 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }];

  claves.forEach((clave, i) => {
    const t = totalesVentasXL(porTienda[clave]);
    const valores = [TIENDAS_CASHEA[clave], t.ventas, t.anuladas, t.total, t.inicial, t.descuento, t.liquidacion];
    valores.forEach((valor, j) => {
      const celda = ws.getRow(6 + i).getCell(j + 1);
      celda.value = valor;
      celda.border = bordeXL;
      if (j >= 3) celda.numFmt = XL.formato;
      if (j === 0) celda.font = { bold: true };
    });
  });

  const ultima = 6 + claves.length - 1;
  const filaTotal = ultima + 1;
  const totales = claves.reduce((acc, clave) => {
    const t = totalesVentasXL(porTienda[clave]);
    acc.ventas += t.ventas; acc.anuladas += t.anuladas; acc.total += t.total;
    acc.inicial += t.inicial; acc.descuento += t.descuento; acc.liquidacion += t.liquidacion;
    return acc;
  }, { ventas: 0, anuladas: 0, total: 0, inicial: 0, descuento: 0, liquidacion: 0 });
  const celdas = [
    { valor: "TOTAL", formula: null },
    { valor: totales.ventas, formula: `SUM(B6:B${ultima})` },
    { valor: totales.anuladas, formula: `SUM(C6:C${ultima})` },
    { valor: redondeo2(totales.total), formula: `SUM(D6:D${ultima})` },
    { valor: redondeo2(totales.inicial), formula: `SUM(E6:E${ultima})` },
    { valor: redondeo2(totales.descuento), formula: `SUM(F6:F${ultima})` },
    { valor: redondeo2(totales.liquidacion), formula: `SUM(G6:G${ultima})` },
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

// Hoja de una tienda con sus ventas, con la misma disposición que el cierre de mes
function hojaVentasTiendaXL(libro, clave, lista, filtroTxt) {
  const nombre = TIENDAS_CASHEA[clave];
  const ws = libro.addWorksheet(nombre);
  const columnas = COLUMNAS_VENTAS_XL;
  encabezadoVentasXL(ws, `CASHEA · ${nombre.toUpperCase()}`, `Ventas · filtro: ${filtroTxt} · ${lista.length} venta(s)`, columnas.length);
  encabezadoTablaXL(ws, 5, columnas);
  ws.columns = ANCHOS_VENTAS_XL.map(width => ({ width }));

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
  });

  // Fila de totales: suma solo las ventas que no están anuladas
  const filaTotal = 6 + Math.max(lista.length, 1);
  const ultima = filaTotal - 1;
  ws.mergeCells(filaTotal, 1, filaTotal, 6);
  const etiqueta = ws.getCell(filaTotal, 1);
  etiqueta.value = `TOTAL ${nombre} (sin anuladas)`;
  etiqueta.font = { bold: true };
  const t = totalesVentasXL(lista);
  const formulaSuma = col => `SUMIFS(${col}6:${col}${ultima},N6:N${ultima},"<>Anulada")`;
  const totalesCol = [
    { col: 7, letra: "G", valor: redondeo2(lista.reduce((a, v) => a + (v.estado === "anulada" ? 0 : Number(v.monto_total_usd) || 0), 0)) },
    { col: 10, letra: "J", valor: t.inicial },
    { col: 11, letra: "K", valor: redondeo2(lista.reduce((a, v) => a + (v.estado === "anulada" ? 0 : calculoCashea(v).financiadoUsd), 0)) },
    { col: 12, letra: "L", valor: t.descuento },
    { col: 13, letra: "M", valor: t.liquidacion },
    { col: 15, letra: "O", valor: redondeo2(lista.reduce((a, v) => {
      const r = compararCashea(v);
      return a + (v.estado === "anulada" || !r ? 0 : r.recibidoBs);
    }, 0)) },
  ];
  for (let j = 1; j <= columnas.length; j++) {
    const celda = ws.getRow(filaTotal).getCell(j);
    celda.fill = rellenoXL(XL.gris);
    celda.border = bordeXL;
    celda.font = { bold: true };
  }
  totalesCol.forEach(tc => {
    const celda = ws.getRow(filaTotal).getCell(tc.col);
    celda.value = lista.length ? { formula: formulaSuma(tc.letra), result: tc.valor } : 0;
    celda.numFmt = XL.formato;
  });

  ws.views = [{ state: "frozen", ySplit: 5, xSplit: 3 }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, 5 + lista.length), column: columnas.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

// Botón "Exportar Excel" de Cashea: exporta lo que se ve en la pestaña actual
async function exportarCashea() {
  const filas = casheaFiltradas();
  if (!filas.length) return toast("No hay ventas con este filtro para exportar.");
  if (typeof ExcelJS === "undefined") {
    toast("No cargó el formato contable de Excel: se exporta una versión simple.");
    return exportarCasheaSimple(filas);
  }
  try {
    const claves = Object.keys(TIENDAS_CASHEA).filter(k => filas.some(v => v.tienda === k));
    const porTienda = {};
    claves.forEach(k => { porTienda[k] = filas.filter(v => v.tienda === k).sort(ordenVentasXL); });
    const filtroTxt = descripcionFiltroXL();

    const libro = new ExcelJS.Workbook();
    libro.creator = "Mercería de Oriente";
    libro.created = new Date();
    hojaResumenVentasXL(libro, claves, porTienda, filtroTxt);
    claves.forEach(k => hojaVentasTiendaXL(libro, k, porTienda[k], filtroTxt));

    const buffer = await libro.xlsx.writeBuffer();
    const base = vistaCashea.tienda === "todas" ? "Cashea_total" : `Cashea_${nombreArchivoXL(TIENDAS_CASHEA[vistaCashea.tienda])}`;
    descargarArchivo(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${base}_${hoyISO()}.xlsx`
    );
    toast(`Excel de Cashea listo (${filas.length} venta(s)).`);
  } catch (err) {
    toast("No se pudo crear el Excel: " + (err.message || "error"));
  }
}
