"use strict";
/* =========================================================
   Calculadora de venta: suma los precios de los productos, aplica
   el IVA si se pide y convierte el total a Bs con la tasa del día.
   "Aplicar tasa y tienda" pasa la tasa, la tienda y la fecha al
   formulario de nueva venta de Cashea. Todo se calcula en el
   navegador: no guarda nada hasta que registres la venta.
   Requiere config.js, comun.js, admin.js y cashea.js.
   ========================================================= */

const calc = {
  filas: [""],         // precios tal como los escribe la persona (texto)
  facturas: [],        // fotos de la factura (Blobs en memoria), se guardan con la venta de Cashea
  tasa: "",            // tasa de cambio (Bs por 1 USD), texto
  tienda: "merceria",  // Mercería Oriente siempre de primera por defecto
  fecha: "",           // fecha de venta, AAAA-MM-DD
  metodo: "",          // método de pago de la inicial (lista de METODOS_PAGO_CASHEA)
  pctInicial: 40,      // porcentaje de inicial preestablecido en 40% (editable)
};

const IVA_TASA = 0.16; // IVA fijo: siempre se suma
const TAB_CASHEA_DE = { merceria: "cashea-merceria", decocintas: "cashea-decocintas", caracas: "cashea-caracas" };

// Formato venezolano: 16.543,76 (punto para miles, coma para decimales)
const formatoBs = n => {
  const fijo = (Math.round(n * 100) / 100).toFixed(2);
  const [entera, decimal] = fijo.split(".");
  return `${entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
};
const formatoUsd = n => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const formatoPct = n => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
};

const fechaLarga = iso => {
  const [a, m, d] = String(iso || "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
};

// Suma, IVA (16%, siempre), total, equivalente en Bs e inicial según el porcentaje elegido
function totalesCalculadora() {
  const suma = Math.round(calc.filas.reduce((a, t) => a + (leerMonto(t, 2) || 0), 0) * 100) / 100;
  const iva = Math.round(suma * IVA_TASA * 100) / 100;
  const total = Math.round((suma + iva) * 100) / 100;
  const tasa = leerMonto(calc.tasa, 4);
  const tasaValida = tasa && tasa > 0 ? tasa : null;
  const bs = tasaValida ? Math.round(total * tasaValida * 100) / 100 : null;
  const pctInicial = Math.min(100, Math.max(0, Number(calc.pctInicial ?? 40)));
  const inicialUsd = Math.round(total * pctInicial) / 100;
  const inicialBs = tasaValida ? Math.round(inicialUsd * tasaValida * 100) / 100 : null;
  return { suma, iva, total, tasa: tasaValida, bs, pctInicial, inicialUsd, inicialBs };
}

// Pinta las filas de precios (solo cuando cambian: agregar, quitar, limpiar)
function pintarFilasCalc() {
  const cont = document.getElementById("calcFilas");
  if (!cont) return;
  cont.innerHTML = calc.filas.map((t, i) => `
    <div class="calc-fila">
      <input class="input calc-precio" data-i="${i}" inputmode="decimal" autocomplete="off"
             placeholder="PRECIO DEL PRODUCTO (USD)" value="${esc(t)}" aria-label="Precio del producto ${i + 1}">
      <button type="button" class="calc-quitar" data-calc="quitar" data-i="${i}" aria-label="Quitar este precio">✕</button>
    </div>`).join("");
  pintarTotalesCalc();
}

// Actualiza solo los números (no toca los campos que la persona está escribiendo)
function pintarTotalesCalc() {
  const { suma, iva, total, bs, pctInicial, inicialUsd, inicialBs } = totalesCalculadora();
  const pctTxt = `${formatoPct(pctInicial)}%`;
  const poner = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
  poner("calcSuma", formatoUsd(suma));
  poner("calcIvaMonto", formatoUsd(iva));
  poner("calcTotal", formatoUsd(total));
  poner("calcUsd", formatoUsd(total));
  poner("calcBs", bs === null ? "Bs —" : `Bs ${formatoBs(bs)}`);
  poner("calcPctTxt", pctTxt);
  poner("calcPctBtnTxt", pctTxt);
  poner("calcIniUsdLbl", `Inicial (${pctTxt}) en USD`);
  poner("calcIniBsLbl", `Inicial (${pctTxt}) en Bs`);
  poner("calcIniUsd", formatoUsd(inicialUsd));
  poner("calcIniBs", inicialBs === null ? "Bs —" : `Bs ${formatoBs(inicialBs)}`);
  document.querySelectorAll("#calcPctRapidos [data-pct]").forEach(b => {
    b.classList.toggle("on", Number(b.dataset.pct) === Number(pctInicial));
  });
}

// Muestra las fotos de la factura elegidas, con opción de quitar cada una
function pintarFotoCalc() {
  const caja = document.getElementById("calcFotoVista");
  if (!caja) return;
  if (!calc.facturas.length) {
    caja.innerHTML = `<p class="muted small">Todavía no hay fotos de la factura.</p>`;
    return;
  }
  caja.innerHTML = `
    <div class="fotos-factura-grid">
      ${calc.facturas.map((blob, idx) => {
        const src = URL.createObjectURL(blob);
        return `
          <div class="foto-factura-item">
            <img src="${esc(src)}" alt="Foto ${idx + 1} de la factura" data-zoom="${esc(src)}">
            <button type="button" class="foto-factura-quitar" data-calc="quitar-foto" data-idx="${idx}" aria-label="Quitar foto ${idx + 1}" title="Quitar foto">✕</button>
            <span class="foto-factura-num">${idx + 1}</span>
          </div>`;
      }).join("")}
    </div>`;
}

// Pone en pantalla la configuración guardada (tienda, fecha, tasa)
function pintarConfigCalc() {
  if (!calc.fecha) calc.fecha = hoyISO();
  const tienda = document.getElementById("calcTienda");
  const fecha = document.getElementById("calcFecha");
  const tasa = document.getElementById("calcTasa");
  if (tienda) tienda.value = calc.tienda;
  if (fecha) fecha.value = calc.fecha;
  if (tasa) tasa.value = calc.tasa;
  const metodo = document.getElementById("calcMetodo");
  if (metodo) {
    metodo.innerHTML = '<option value="">Elige…</option>' +
      METODOS_PAGO_CASHEA.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    metodo.value = calc.metodo;
  }
  const pctInput = document.getElementById("calcPctInput");
  if (pctInput) pctInput.value = calc.pctInicial;
  pintarEstadoAplicado();
}

function pintarEstadoAplicado() {
  const el = document.getElementById("calcAplicado");
  if (!el) return;
  const a = adm.calcAplicado;
  el.textContent = a
    ? `Aplicado a la venta Cashea: ${TIENDAS_CASHEA[a.tienda] || ""} · ${fechaLarga(a.fecha)} · 1 USD = ${formatoBs(a.tasa)} Bs · Inicial ${formatoPct(a.pct_inicial ?? 40)}%`
    : "Todavía no se ha aplicado la tasa ni la tienda.";
}

// Llamado al entrar en la pestaña
function pintarCalculadora() {
  pintarFilasCalc();
  pintarConfigCalc();
  pintarFotoCalc();
}

// Toma la tasa de la venta Cashea más reciente que tenga tasa
async function sincronizarTasaCalc() {
  // Si nunca se abrió una pestaña de Cashea, las ventas aún no están cargadas: se piden ahora
  if (!(adm.cashea || []).length && typeof refrescarCashea === "function") await refrescarCashea();
  const ultima = (adm.cashea || []).find(v => Number(v.tasa) > 0);
  if (!ultima) return toast("Aún no hay una venta Cashea con tasa. Escribe la tasa del día.");
  calc.tasa = formatoBs(Number(ultima.tasa));
  const tasa = document.getElementById("calcTasa");
  if (tasa) tasa.value = calc.tasa;
  pintarTotalesCalc();
  toast(`Tasa tomada de la última venta: ${calc.tasa} Bs`);
}

// Pasa tienda, fecha, tasa, porcentaje de inicial y fotos de la factura a una nueva venta de Cashea
function aplicarCalc() {
  const tasa = leerMonto(calc.tasa, 4);
  if (!tasa || tasa <= 0) return toast("Escribe una tasa de cambio válida antes de aplicar.");
  if (!TIENDAS_CASHEA[calc.tienda]) return toast("Elige una tienda.");
  const { total, pctInicial } = totalesCalculadora();
  adm.calcAplicado = {
    tienda: calc.tienda,
    fecha: calc.fecha || hoyISO(),
    tasa,
    monto: total,
    pct_inicial: pctInicial,
    metodo: calc.metodo || null,
    facturas: [...calc.facturas],
    factura: calc.facturas[0] || null,
  };
  pintarEstadoAplicado();
  limpiarTodoCalc();
  irA(TAB_CASHEA_DE[adm.calcAplicado.tienda]);
  abrirFormCashea(null);
}

// Vacía toda la calculadora: precios, tasa, tienda, fecha, porcentaje y fotos vuelven a su estado inicial
function limpiarTodoCalc() {
  calc.filas = [""];
  calc.tasa = "";
  calc.tienda = "merceria";
  calc.fecha = hoyISO();
  calc.metodo = "";
  calc.pctInicial = 40;
  calc.facturas = [];
  const editor = document.getElementById("calcPctEditor");
  if (editor) editor.hidden = true;
  pintarFilasCalc();
  pintarConfigCalc();
  pintarFotoCalc();
}

// Borra los precios y restablece el porcentaje en 40%. La tienda, la fecha y la tasa se mantienen
function limpiarCalc() {
  calc.filas = [""];
  calc.pctInicial = 40;
  calc.facturas = [];
  const editor = document.getElementById("calcPctEditor");
  if (editor) editor.hidden = true;
  const pctInput = document.getElementById("calcPctInput");
  if (pctInput) pctInput.value = 40;
  pintarFilasCalc();
  pintarFotoCalc();
  toast("Calculadora limpia");
}

/* ---------- Eventos ---------- */
document.addEventListener("input", (e) => {
  if (e.target.classList.contains("calc-precio")) {
    calc.filas[Number(e.target.dataset.i)] = e.target.value;
    return pintarTotalesCalc();
  }
  if (e.target.id === "calcTasa") {
    calc.tasa = e.target.value;
    return pintarTotalesCalc();
  }
  if (e.target.id === "calcPctInput") {
    const limpio = String(e.target.value ?? "").replace(",", ".").trim();
    if (limpio === "") {
      calc.pctInicial = 0;
    } else {
      const n = Number(limpio);
      if (!Number.isNaN(n)) calc.pctInicial = Math.min(100, Math.max(0, Math.round(n * 100) / 100));
    }
    return pintarTotalesCalc();
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "calcFotoSubir") {
    const archivos = [...(e.target.files || [])];
    e.target.value = "";
    if (!archivos.length) return;
    const maxFotos = typeof MAX_FOTOS_CASHEA === "number" ? MAX_FOTOS_CASHEA : 8;
    const cupo = maxFotos - calc.facturas.length;
    if (cupo <= 0) return toast(`Máximo ${maxFotos} fotos por venta.`);
    for (const archivo of archivos.slice(0, cupo)) {
      if (typeof esArchivoImagen === "function" && !esArchivoImagen(archivo)) {
        toast(`"${archivo.name}" no es una imagen válida.`);
        continue;
      }
      try {
        calc.facturas.push(await comprimir(archivo, 1600));
      } catch (err) {
        toast("No se pudo preparar la foto: " + (err.message || "error"));
      }
    }
    pintarFotoCalc();
    return;
  }
  if (e.target.id === "calcTienda") calc.tienda = e.target.value;
  if (e.target.id === "calcMetodo") calc.metodo = e.target.value;
  if (e.target.id === "calcFecha") calc.fecha = e.target.value || hoyISO();
});

document.addEventListener("click", (e) => {
  const boton = e.target.closest("[data-calc]");
  if (!boton) return;
  switch (boton.dataset.calc) {
    case "mas": {
      calc.filas.push("");
      pintarFilasCalc();
      const nuevos = document.querySelectorAll(".calc-precio");
      if (nuevos.length) nuevos[nuevos.length - 1].focus();
      return;
    }
    case "quitar": {
      const i = Number(boton.dataset.i);
      calc.filas.splice(i, 1);
      if (!calc.filas.length) calc.filas = [""];
      return pintarFilasCalc();
    }
    case "pct-toggle": {
      const editor = document.getElementById("calcPctEditor");
      if (!editor) return;
      editor.hidden = !editor.hidden;
      const input = document.getElementById("calcPctInput");
      if (!editor.hidden && input) {
        input.value = calc.pctInicial;
        input.focus();
        input.select();
      }
      return;
    }
    case "pct-set": {
      const pct = Math.min(100, Math.max(0, Number(boton.dataset.pct ?? 40)));
      calc.pctInicial = pct;
      const input = document.getElementById("calcPctInput");
      if (input) input.value = pct;
      pintarTotalesCalc();
      return;
    }
    case "pct-cerrar": {
      const editor = document.getElementById("calcPctEditor");
      if (editor) editor.hidden = true;
      return;
    }
    case "quitar-foto": {
      const idx = Number(boton.dataset.idx);
      if (Number.isInteger(idx) && idx >= 0 && idx < calc.facturas.length) {
        calc.facturas.splice(idx, 1);
      } else {
        calc.facturas = [];
      }
      return pintarFotoCalc();
    }
    case "sync": return sincronizarTasaCalc();
    case "aplicar": return aplicarCalc();
    case "limpiar": return limpiarCalc();
  }
});
