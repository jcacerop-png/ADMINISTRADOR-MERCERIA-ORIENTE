/* =========================================================
   Ventas por Cashea Express (solo panel de administración).
   Modelo:
   - Inicial 40%: la clienta la paga en caja, en bolívares a la tasa BCV de la venta.
   - Financiado: el resto. Cashea lo debe al comercio.
   - Cashea descuenta el 8% del monto total: 4% servicio tecnológico + 4% adelanto.
   - Liquidación esperada (USD) = financiado − descuentos.
   - Comprobación: cuando llega el pago de Cashea se anota lo recibido en bolívares,
     la tasa BCV de ese día y la fecha. La app separa la diferencia en la variación
     por tasa BCV y el descuento de más o de menos de Cashea.
   Las ventas no se borran: se anulan.
   ========================================================= */

const ESTADOS_CASHEA = { pendiente: "Pendiente", cobrada: "Cobrada", anulada: "Anulada" };
const CASHEA_PCT = { inicial: 40, comision: 4, adelanto: 4 }; // valores de cada venta nueva (%)
const CASHEA_TOLERANCIA_USD = 0.5; // una diferencia menor a esto se considera "cuadra"
const RESULTADO_CASHEA = { cuadra: "Cuadra", mas: "Le descontó de más", menos: "Le descontó de menos", sin: "Sin comprobar" };
const vistaCashea = { filtro: "todas", q: "" }; // solo lo que se ve en pantalla

// Números en formato venezolano: 1.250,50
const numeroVE = n => {
  const [entero, dec] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dec;
};
const bsTxt = n => "Bs " + numeroVE(n);
const signoBs = n => (n > 0 ? "+" : n < 0 ? "−" : "") + bsTxt(Math.abs(n));
const signoUsd = n => (n > 0 ? "+" : n < 0 ? "−" : "") + usd(Math.abs(n));
const redondeo2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Acepta "1.250,50", "1250,5", "1250.5" y "1.250". Devuelve número o null si no es válido.
function leerMonto(v, decimales = 2) {
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const f = 10 ** decimales;
  return Math.round(Number(s) * f) / f;
}

// Número listo para escribir en un campo: 350 → "350,00", 894.75 → "894,75"
function campoNumero(n, decimales) {
  if (n === null || n === undefined || n === "") return "";
  const [entero, dec = ""] = Number(n).toFixed(decimales).split(".");
  return entero + "," + dec.replace(/0+$/, "").padEnd(2, "0");
}

const hoyISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const fechaTxt = f => {
  const [y, m, d] = String(f || "").split("-");
  return y ? `${d}/${m}/${y}` : "";
};
const fechaHoraTxt = iso => (iso ? new Date(iso).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
function esDelMesActual(iso) {
  if (!iso) return false;
  const d = new Date(iso), h = new Date();
  return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth();
}

/* ---------- Cálculos (las mismas fórmulas que la base de datos) ---------- */
function calculoCashea(v) {
  const total = Number(v.monto_total_usd) || 0;
  const tasa = Number(v.tasa) || 0;
  const pIni = v.pct_inicial ?? CASHEA_PCT.inicial;
  const pCom = v.pct_comision ?? CASHEA_PCT.comision;
  const pAde = v.pct_adelanto ?? CASHEA_PCT.adelanto;
  const inicialUsd = redondeo2(total * Number(pIni) / 100);
  const financiadoUsd = redondeo2(total - inicialUsd);
  const descuentoUsd = redondeo2(redondeo2(total * Number(pCom) / 100) + redondeo2(total * Number(pAde) / 100));
  const liquidacionUsd = redondeo2(financiadoUsd - descuentoUsd);
  return {
    inicialUsd,
    inicialBs: redondeo2(tasa * inicialUsd),
    financiadoUsd,
    descuentoUsd,
    pctDescuento: Number(pCom) + Number(pAde),
    liquidacionUsd,
    liquidacionBsVenta: redondeo2(tasa * liquidacionUsd),
  };
}

/* Compara lo que Cashea debía pagar con lo que llegó. Devuelve null si aún no se comprobó. */
function compararCashea(v) {
  if (v.liq_recibido_bs === null || v.liq_recibido_bs === undefined || !v.liq_tasa) return null;
  const c = calculoCashea(v);
  const total = Number(v.monto_total_usd) || 0;
  const Tv = Number(v.tasa) || 0;
  const TL = Number(v.liq_tasa);
  const R = Number(v.liq_recibido_bs);
  const Lq = c.liquidacionUsd;
  const descuentoRealUsd = redondeo2(c.financiadoUsd - R / TL);
  const diferenciaUsd = redondeo2(descuentoRealUsd - c.descuentoUsd); // + = descontó de más
  const variacionTasaBs = redondeo2((TL - Tv) * Lq);
  const descuentoBs = redondeo2(R - redondeo2(Lq * TL));
  const diferenciaBs = redondeo2(R - c.liquidacionBsVenta);
  const estado = Math.abs(diferenciaUsd) <= CASHEA_TOLERANCIA_USD ? "cuadra" : diferenciaUsd > 0 ? "mas" : "menos";
  return {
    recibidoBs: R,
    tasaLiq: TL,
    esperadoBs: c.liquidacionBsVenta,
    descuentoRealUsd,
    descuentoRealPct: total ? redondeo2(descuentoRealUsd / total * 100) : 0,
    diferenciaUsd,
    variacionTasaBs,
    descuentoBs,
    diferenciaBs,
    cambioTasaPct: Tv ? redondeo2((TL / Tv - 1) * 100) : 0,
    estado,
  };
}

const pillCompCashea = v => {
  const r = compararCashea(v);
  const clave = r ? r.estado : "sin";
  return `<span class="pill-comp ${clave}">${RESULTADO_CASHEA[clave]}</span>`;
};

/* ---------- Lectura ---------- */
async function refrescarCashea() {
  try {
    const { data, error } = await sb.from("cashea_ventas").select("*")
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(2000);
    if (error) throw error;
    adm.cashea = data || [];
    pintarCashea();
  } catch (err) {
    toast("No se pudieron cargar las ventas Cashea: " + (err.message || "error"));
  }
}

function casheaFiltradas() {
  const q = normaTexto(vistaCashea.q);
  return adm.cashea.filter(v =>
    (vistaCashea.filtro === "todas" || v.estado === vistaCashea.filtro) &&
    (!q || normaTexto(`${v.factura} ${v.nombre} ${v.apellido}`).includes(q)));
}

/* ---------- Pantalla ---------- */
function pintarCashea() {
  const sumar = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const todas = adm.cashea.map(v => ({ v, c: calculoCashea(v), r: compararCashea(v) }));
  const porCobrar = todas.filter(x => x.v.estado === "pendiente" && !x.r);
  const delMes = todas.filter(x => x.r && esDelMesActual(x.v.liq_fecha));
  const conDif = todas.filter(x => x.r && x.r.estado !== "cuadra" && x.v.estado !== "anulada");

  $("#casheaKpis").innerHTML = [
    kpi("Por cobrar a Cashea (USD)", usd(redondeo2(sumar(porCobrar, x => x.c.liquidacionUsd)))),
    kpi("Por cobrar a Cashea (Bs, tasa de venta)", bsTxt(redondeo2(sumar(porCobrar, x => x.c.liquidacionBsVenta)))),
    kpi("Recibido de Cashea este mes (Bs)", bsTxt(redondeo2(sumar(delMes, x => x.r.recibidoBs)))),
    kpi("Con diferencia", conDif.length),
  ].join("");

  $$("[data-cfiltro]").forEach(b => b.classList.toggle("on", b.dataset.cfiltro === vistaCashea.filtro));

  const lista = casheaFiltradas().map(v => ({ v, c: calculoCashea(v), r: compararCashea(v) }));
  $("#casheaResumen").textContent = lista.length
    ? `${lista.length} venta(s) · inicial en caja ${bsTxt(redondeo2(sumar(lista, x => x.c.inicialBs)))} · liquidación esperada ${usd(redondeo2(sumar(lista, x => x.c.liquidacionUsd)))}`
    : "";
  $("#casheaTabla").innerHTML = lista.length
    ? `<div class="cs-desk">
        <table class="tabla-inv">
          <thead><tr><th>Factura</th><th>Día</th><th>Cliente</th><th>Total</th><th>Inicial en caja</th><th>Financiado</th><th>Liquidación esperada</th><th>Pago de Cashea</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>${lista.map(x => filaCashea(x.v, x.c, x.r)).join("")}</tbody>
        </table>
      </div>
      <div class="cs-movil">${lista.map(x => tarjetaCashea(x.v, x.c, x.r)).join("")}</div>`
    : `<p class="muted" style="padding:14px 8px">${todas.length
        ? "No hay ventas con este filtro."
        : "Todavía no hay ventas Cashea registradas. Usa “+ Nueva venta”."}</p>`;
}

function botonesCashea(v) {
  const id = esc(v.id);
  const b = [`<button class="btn ghost sm" data-cashea="detalle" data-id="${id}">Detalle</button>`];
  if (v.estado !== "anulada") b.push(`<button class="btn sm" data-cashea="comprobar" data-id="${id}">Comprobar</button>`);
  if (v.estado === "pendiente") b.push(`<button class="btn ghost sm" data-cashea="estado" data-id="${id}" data-estado="cobrada">Marcar cobrada</button>`);
  if (v.estado === "cobrada") b.push(`<button class="btn ghost sm" data-cashea="estado" data-id="${id}" data-estado="pendiente">Dejar pendiente</button>`);
  b.push(`<button class="btn ghost sm" data-cashea="editar" data-id="${id}">Editar</button>`);
  if (v.estado !== "anulada") b.push(`<button class="btn ghost sm anular" data-cashea="estado" data-id="${id}" data-estado="anulada">Anular</button>`);
  return b.join("");
}

function celdaPagoCashea(r) {
  return r
    ? `<strong>${bsTxt(r.recibidoBs)}</strong><br><small class="muted">a tasa ${numeroVE(r.tasaLiq)}</small>`
    : `<span class="muted">Sin comprobar</span>`;
}

function filaCashea(v, c, r) {
  return `<tr class="${v.estado === "anulada" ? "anulada" : ""}">
    <td><strong>${esc(v.factura)}</strong></td>
    <td>${esc(fechaTxt(v.fecha))}</td>
    <td>${esc(v.nombre)} ${esc(v.apellido)}</td>
    <td>${usd(v.monto_total_usd)}</td>
    <td>${usd(c.inicialUsd)}<br><small class="muted">${bsTxt(c.inicialBs)}</small></td>
    <td>${usd(c.financiadoUsd)}</td>
    <td><strong>${usd(c.liquidacionUsd)}</strong><br><small class="muted">${bsTxt(c.liquidacionBsVenta)}</small></td>
    <td>${celdaPagoCashea(r)}<br>${pillCompCashea(v)}</td>
    <td><span class="pill-estado ${esc(v.estado)}">${ESTADOS_CASHEA[v.estado] || esc(v.estado)}</span></td>
    <td><div class="acc-fila">${botonesCashea(v)}</div></td>
  </tr>`;
}

function tarjetaCashea(v, c, r) {
  const estado = esc(v.estado);
  return `<article class="cs-card ${v.estado === "anulada" ? "anulada" : ""}">
    <header class="cs-card-cab">
      <div><strong>${esc(v.factura)}</strong><small>${esc(fechaTxt(v.fecha))}</small></div>
      <span class="pill-estado ${estado}">${ESTADOS_CASHEA[v.estado] || estado}</span>
    </header>
    <p class="cs-cliente">${esc(v.nombre)} ${esc(v.apellido)}</p>
    <dl class="cs-datos">
      <div><dt>Total</dt><dd>${usd(v.monto_total_usd)}</dd></div>
      <div><dt>Inicial en caja (${Number(v.pct_inicial)}%)</dt><dd>${usd(c.inicialUsd)}</dd><dd class="sub">${bsTxt(c.inicialBs)}</dd></div>
      <div><dt>Liquidación esperada</dt><dd>${usd(c.liquidacionUsd)}</dd><dd class="sub">${bsTxt(c.liquidacionBsVenta)}</dd></div>
      <div><dt>Pago de Cashea</dt><dd>${r ? bsTxt(r.recibidoBs) : "Sin comprobar"}</dd><dd class="sub">${pillCompCashea(v)}</dd></div>
    </dl>
    <div class="acc-fila">${botonesCashea(v)}</div>
  </article>`;
}

/* ---------- Detalle (cualquier estado) ---------- */
function abrirDetalleCashea(id) {
  const v = adm.cashea.find(x => x.id === id);
  if (!v) return toast("No encontré esa venta.");
  const c = calculoCashea(v);
  const r = compararCashea(v);
  const fila = (titulo, valor) => `<div><dt>${titulo}</dt><dd>${valor}</dd></div>`;
  const bloqueComp = r ? `
        ${fila("Fecha del pago", esc(fechaTxt(v.liq_fecha)))}
        ${fila("Recibido de Cashea", `${bsTxt(r.recibidoBs)} a tasa ${numeroVE(r.tasaLiq)}`)}
        ${fila("Esperado (tasa de venta)", bsTxt(r.esperadoBs))}
        ${fila("Diferencia total", signoBs(r.diferenciaBs))}
        ${fila("Por variación de la tasa", `${signoBs(r.variacionTasaBs)} (${r.cambioTasaPct >= 0 ? "+" : ""}${numeroVE(r.cambioTasaPct)}%)`)}
        ${fila("Por descuento de Cashea", signoBs(r.descuentoBs))}
        ${fila("Descuento real", `${usd(r.descuentoRealUsd)} (${numeroVE(r.descuentoRealPct)}%) · esperado ${usd(c.descuentoUsd)} (${numeroVE(c.pctDescuento)}%)`)}
        ${fila("Resultado", `${RESULTADO_CASHEA[r.estado]} (${signoUsd(r.diferenciaUsd)})`)}
        ${v.liq_nota ? fila("Nota", esc(v.liq_nota)) : ""}
        ${v.liq_comprobado_por ? fila("Comprobada por", esc(v.liq_comprobado_por) + (v.liq_comprobado_en ? ` · ${esc(fechaHoraTxt(v.liq_comprobado_en))}` : "")) : ""}`
    : fila("Pago de Cashea", "Sin comprobar");
  $("#modal .sheet").innerHTML = `
    <div class="det-cashea">
      <div class="det-cab">
        <div><span class="eyebrow">Factura</span><h2>${esc(v.factura)}</h2></div>
        <span class="pill-estado ${esc(v.estado)}">${ESTADOS_CASHEA[v.estado] || esc(v.estado)}</span>
      </div>
      <dl class="det-lista">
        ${fila("Cliente", esc(`${v.nombre} ${v.apellido}`))}
        ${fila("Día de la venta", esc(fechaTxt(v.fecha)))}
        ${fila("Monto total", usd(v.monto_total_usd))}
        ${fila("Tasa BCV de la venta", numeroVE(v.tasa))}
        ${fila(`Inicial en caja (${Number(v.pct_inicial)}%)`, `${usd(c.inicialUsd)} · ${bsTxt(c.inicialBs)}`)}
        ${fila("Financiado (lo debe Cashea)", usd(c.financiadoUsd))}
        ${fila(`Descuentos Cashea (${Number(v.pct_comision)}% servicio + ${Number(v.pct_adelanto)}% adelanto)`, `−${usd(c.descuentoUsd)}`)}
        ${fila("Liquidación esperada", `${usd(c.liquidacionUsd)} · ${bsTxt(c.liquidacionBsVenta)} a la tasa de venta`)}
        ${bloqueComp}
        ${v.cobrada_en ? fila("Cobrada el", esc(fechaHoraTxt(v.cobrada_en))) : ""}
        ${v.anulada_en ? fila("Anulada el", esc(fechaHoraTxt(v.anulada_en))) : ""}
        ${fila("Registrada por", esc(v.registrado_por || "—") + (v.creado_en ? ` · ${esc(fechaHoraTxt(v.creado_en))}` : ""))}
        ${v.actualizado_por ? fila("Último cambio", esc(v.actualizado_por) + (v.actualizado_en ? ` · ${esc(fechaHoraTxt(v.actualizado_en))}` : "")) : ""}
      </dl>
      <div class="acciones-sheet">
        <button type="button" class="btn ghost" data-cashea="cerrar">Cerrar</button>
        ${v.estado !== "anulada" ? `<button type="button" class="btn" data-cashea="comprobar" data-id="${esc(v.id)}">Comprobar</button>` : ""}
        <button type="button" class="btn ghost" data-cashea="editar" data-id="${esc(v.id)}">Editar</button>
      </div>
    </div>`;
  abrirModal();
}

/* ---------- Comprobar el pago de Cashea ---------- */
function abrirComprobarCashea(id) {
  const v = adm.cashea.find(x => x.id === id);
  if (!v) return toast("No encontré esa venta.");
  if (v.estado === "anulada") return toast("Una venta anulada no se comprueba.");
  const c = calculoCashea(v);
  $("#modal .sheet").innerHTML = `
    <form id="formComprobar" class="form-cashea" data-id="${esc(v.id)}" novalidate>
      <h2>Comprobar pago de Cashea</h2>
      <p class="muted small">${esc(v.factura)} · ${esc(v.nombre)} ${esc(v.apellido)} · debe llegar ${usd(c.liquidacionUsd)} (${bsTxt(c.liquidacionBsVenta)} a la tasa de venta)</p>
      <div class="grid-form">
        <label>Bs que llegaron de Cashea *<input name="recibido" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(campoNumero(v.liq_recibido_bs, 2))}"></label>
        <label>Tasa BCV del día del pago *<input name="tasa_liq" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(campoNumero(v.liq_tasa, 4))}"></label>
        <label>Fecha del pago *<input name="fecha_liq" type="date" value="${esc(v.liq_fecha || hoyISO())}"></label>
        <label>Nota (opcional)<input name="nota" maxlength="200" autocomplete="off" value="${esc(v.liq_nota || "")}"></label>
      </div>
      <div class="cs-calc" id="casheaCompCalc" aria-live="polite"></div>
      <p class="error" id="compError" hidden></p>
      <div class="acciones-sheet">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar comprobación</button>
      </div>
    </form>`;
  abrirModal();
  actualizarComprobarCashea($("#formComprobar"));
}

function actualizarComprobarCashea(form) {
  if (!form) return;
  const v = adm.cashea.find(x => x.id === form.dataset.id);
  if (!v) return;
  const caja = $("#casheaCompCalc");
  const R = leerMonto(form.recibido.value, 2);
  const TL = leerMonto(form.tasa_liq.value, 4);
  if (R === null || !TL) {
    caja.innerHTML = `<p class="muted small">Escribe lo que llegó en bolívares y la tasa BCV de ese día para ver la comparación.</p>`;
    return;
  }
  const r = compararCashea({ ...v, liq_recibido_bs: R, liq_tasa: TL });
  const c = calculoCashea(v);
  caja.innerHTML = `
    <div class="cs-calc-fila"><span>Esperado (a la tasa de venta ${numeroVE(v.tasa)})</span><strong>${bsTxt(r.esperadoBs)}</strong></div>
    <div class="cs-calc-fila"><span>Recibido de Cashea</span><strong>${bsTxt(r.recibidoBs)}</strong></div>
    <div class="cs-calc-fila"><span>Diferencia total</span><strong>${signoBs(r.diferenciaBs)}</strong></div>
    <div class="cs-calc-fila"><span>Por variación de la tasa (${r.cambioTasaPct >= 0 ? "+" : ""}${numeroVE(r.cambioTasaPct)}%)</span><strong>${signoBs(r.variacionTasaBs)}</strong></div>
    <div class="cs-calc-fila"><span>Por descuento de Cashea</span><strong>${signoBs(r.descuentoBs)}</strong></div>
    <div class="cs-calc-fila"><span>Descontó ${usd(r.descuentoRealUsd)} (${numeroVE(r.descuentoRealPct)}%); debía ${usd(c.descuentoUsd)} (${numeroVE(c.pctDescuento)}%)</span><strong>${RESULTADO_CASHEA[r.estado]} ${r.estado === "cuadra" ? "" : signoUsd(r.diferenciaUsd)}</strong></div>`;
}

async function guardarComprobarCashea(e) {
  const form = e.target;
  const id = form.dataset.id;
  const error = $("#compError");
  const v = adm.cashea.find(x => x.id === id);
  if (!v) return toast("No encontré esa venta.");
  const R = leerMonto(form.recibido.value, 2);
  const TL = leerMonto(form.tasa_liq.value, 4);
  const fechaLiq = form.fecha_liq.value;
  let aviso = null;
  if (R === null || R < 0) aviso = "Escribe cuántos bolívares llegaron de Cashea.";
  else if (!TL || TL <= 0) aviso = "Escribe la tasa BCV del día del pago.";
  else if (!fechaLiq) aviso = "Elige la fecha del pago.";
  else if (fechaLiq < v.fecha) aviso = "La fecha del pago no puede ser anterior a la fecha de la venta.";
  if (aviso) {
    error.textContent = aviso;
    error.hidden = false;
    return;
  }
  const boton = form.querySelector("[type=submit]");
  boton.disabled = true;
  try {
    const { error: errorBD } = await sb.from("cashea_ventas").update({
      liq_recibido_bs: R,
      liq_tasa: TL,
      liq_fecha: fechaLiq,
      liq_nota: String(form.nota.value || "").trim() || null,
    }).eq("id", id);
    if (errorBD) throw errorBD;
    cerrarModal();
    toast(`Comprobación de ${v.factura} guardada.`);
    await refrescarCashea();
  } catch (err) {
    error.textContent = err.code === "23514"
      ? "Revisa los datos de la comprobación: la tasa debe ser mayor que cero y la fecha no puede ser anterior a la venta."
      : "No se guardó: " + (err.message || "error");
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

/* ---------- Formulario (nueva o editar) ---------- */
function abrirFormCashea(id) {
  const v = id ? adm.cashea.find(x => x.id === id) : null;
  if (id && !v) return toast("No encontré esa venta.");
  // La tasa sugerida es la de la venta más reciente (se puede cambiar)
  const tasaSugerida = v ? v.tasa : (adm.cashea[0] ? adm.cashea[0].tasa : "");

  $("#modal .sheet").innerHTML = `
    <form id="formCashea" class="form-cashea" data-id="${v ? esc(v.id) : ""}" novalidate>
      <h2>${v ? "Editar venta Cashea" : "Nueva venta Cashea"}</h2>
      <div class="grid-form">
        <label>Factura *<input name="factura" maxlength="40" autocomplete="off" value="${esc(v ? v.factura : "")}"></label>
        <label>Día *<input name="fecha" type="date" value="${esc(v ? v.fecha : hoyISO())}"></label>
        <label>Nombre *<input name="nombre" maxlength="60" autocomplete="off" value="${esc(v ? v.nombre : "")}"></label>
        <label>Apellido *<input name="apellido" maxlength="60" autocomplete="off" value="${esc(v ? v.apellido : "")}"></label>
        <label>Monto total en dólares (USD) *<input name="monto_total_usd" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(campoNumero(v ? v.monto_total_usd : "", 4))}"></label>
        <label>Tasa BCV de la venta *<input name="tasa" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(campoNumero(tasaSugerida, 4))}"></label>
      </div>
      <p class="muted small">Inicial ${CASHEA_PCT.inicial}% en caja. Cashea descuenta ${CASHEA_PCT.comision}% servicio + ${CASHEA_PCT.adelanto}% adelanto.</p>
      <div class="cs-calc" id="casheaCalc" aria-live="polite"></div>
      ${v ? "" : `<label>Estado al guardar<select name="estado"><option value="pendiente">Pendiente</option><option value="cobrada">Cobrada</option></select></label>`}
      <p class="error" id="casheaError" hidden></p>
      <div class="acciones-sheet">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar</button>
      </div>
    </form>`;
  abrirModal();
  actualizarResumenCashea($("#formCashea"));
  $("#formCashea [name=factura]").focus();
}

function actualizarResumenCashea(form) {
  if (!form) return;
  const caja = $("#casheaCalc");
  const total = leerMonto(form.monto_total_usd.value, 4);
  const tasa = leerMonto(form.tasa.value, 4);
  if (!total || !tasa) {
    caja.innerHTML = `<p class="muted small">Escribe el monto en dólares y la tasa BCV para ver el cálculo.</p>`;
    return;
  }
  const c = calculoCashea({ monto_total_usd: total, tasa });
  caja.innerHTML = `
    <div class="cs-calc-fila"><span>Inicial en caja (${CASHEA_PCT.inicial}%)</span><strong>${usd(c.inicialUsd)}</strong><small>${bsTxt(c.inicialBs)}</small></div>
    <div class="cs-calc-fila"><span>Financiado (lo debe Cashea)</span><strong>${usd(c.financiadoUsd)}</strong></div>
    <div class="cs-calc-fila"><span>Descuentos Cashea (${numeroVE(c.pctDescuento)}%)</span><strong>−${usd(c.descuentoUsd)}</strong></div>
    <div class="cs-calc-fila"><span>Liquidación esperada</span><strong>${usd(c.liquidacionUsd)}</strong><small>${bsTxt(c.liquidacionBsVenta)} a la tasa de venta</small></div>`;
}

function validarCashea(d, id) {
  if (!d.factura) return "Escribe el número de factura.";
  if (!d.nombre || !d.apellido) return "Escribe el nombre y el apellido.";
  if (!d.fecha) return "Elige el día de la venta.";
  if (d.monto_total_usd === null || d.monto_total_usd <= 0) return "El monto total en dólares debe ser mayor que cero.";
  if (d.tasa === null || d.tasa <= 0) return "La tasa BCV de la venta debe ser mayor que cero.";
  if (adm.cashea.some(v => v.id !== id && normaTexto(v.factura) === normaTexto(d.factura))) {
    return `Ya existe una venta con la factura ${d.factura}.`;
  }
  return null;
}

async function guardarCashea(e) {
  const form = e.target;
  const id = form.dataset.id || null;
  const error = $("#casheaError");
  const d = {
    factura: String(form.factura.value || "").trim(),
    nombre: String(form.nombre.value || "").trim(),
    apellido: String(form.apellido.value || "").trim(),
    fecha: form.fecha.value,
    monto_total_usd: leerMonto(form.monto_total_usd.value, 4),
    tasa: leerMonto(form.tasa.value, 4),
  };
  const aviso = validarCashea(d, id);
  if (aviso) {
    error.textContent = aviso;
    error.hidden = false;
    return;
  }
  if (!id) {
    // Cada venta nueva guarda sus porcentajes: si después cambian, esta venta no se mueve
    d.pct_inicial = CASHEA_PCT.inicial;
    d.pct_comision = CASHEA_PCT.comision;
    d.pct_adelanto = CASHEA_PCT.adelanto;
    d.estado = form.estado && form.estado.value === "cobrada" ? "cobrada" : "pendiente";
  }

  const boton = form.querySelector("[type=submit]");
  boton.disabled = true;
  try {
    const consulta = id
      ? sb.from("cashea_ventas").update(d).eq("id", id)
      : sb.from("cashea_ventas").insert(d);
    const { error: errorBD } = await consulta;
    if (errorBD) throw errorBD;
    cerrarModal();
    toast(id ? "Venta actualizada." : "Venta registrada.");
    await refrescarCashea();
  } catch (err) {
    error.textContent = err.code === "23505"
      ? `Ya existe una venta con la factura ${d.factura}.`
      : err.code === "23514"
        ? "Revisa los datos: el monto y la tasa deben ser mayores que cero."
        : "No se guardó: " + (err.message || "error");
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

/* ---------- Estado: cobrada, pendiente o anulada ---------- */
async function cambiarEstadoCashea(id, estado) {
  const v = adm.cashea.find(x => x.id === id);
  if (!v) return;
  if (estado === "anulada" && !confirm(`¿Anular la venta ${v.factura}? Quedará como anulada y no se borra.`)) return;
  try {
    const { error } = await sb.from("cashea_ventas").update({ estado }).eq("id", id);
    if (error) throw error;
    toast(`Venta ${v.factura}: ${ESTADOS_CASHEA[estado].toLowerCase()}.`);
    await refrescarCashea();
  } catch (err) {
    toast("No se pudo cambiar el estado: " + (err.message || "error"));
  }
}

/* ---------- Excel de las ventas que se ven ---------- */
function exportarCashea() {
  const filas = casheaFiltradas();
  if (!filas.length) return toast("No hay ventas con este filtro para exportar.");
  try {
    const cab = ["Factura", "Día", "Nombre", "Apellido", "Monto total USD", "Tasa BCV venta", "% inicial",
      "Inicial USD", "Inicial Bs", "Financiado USD", "% descuentos", "Descuentos USD",
      "Liquidación esperada USD", "Liquidación esperada Bs (tasa venta)",
      "Fecha del pago", "Tasa BCV del pago", "Recibido Bs", "Descuento real USD", "Diferencia USD (+ descontó de más)",
      "Diferencia total Bs", "Resultado", "Estado", "Cobrada el", "Anulada el", "Registrada por", "Nota"];
    const cuerpo = filas.map(v => {
      const c = calculoCashea(v);
      const r = compararCashea(v);
      return [
        v.factura, fechaTxt(v.fecha), v.nombre, v.apellido,
        Number(v.monto_total_usd), Number(v.tasa), Number(v.pct_inicial),
        c.inicialUsd, c.inicialBs, c.financiadoUsd, c.pctDescuento, c.descuentoUsd,
        c.liquidacionUsd, c.liquidacionBsVenta,
        r ? fechaTxt(v.liq_fecha) : "", r ? r.tasaLiq : "", r ? r.recibidoBs : "",
        r ? r.descuentoRealUsd : "", r ? r.diferenciaUsd : "", r ? r.diferenciaBs : "",
        RESULTADO_CASHEA[r ? r.estado : "sin"],
        ESTADOS_CASHEA[v.estado], fechaHoraTxt(v.cobrada_en), fechaHoraTxt(v.anulada_en), v.registrado_por,
        v.liq_nota || "",
      ];
    });
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([cab, ...cuerpo]), "Cashea");
    XLSX.writeFile(libro, `Cashea_${hoyISO()}.xlsx`);
  } catch (err) {
    toast("No se pudo crear el Excel: " + (err.message || "error"));
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  const filtro = t.closest("[data-cfiltro]");
  if (filtro) {
    vistaCashea.filtro = filtro.dataset.cfiltro;
    return pintarCashea();
  }
  if (t.closest("[data-cerrar]") && t.closest("#formCashea")) return cerrarModal();
  const b = t.closest("[data-cashea]");
  if (!b) return;
  if (b.dataset.cashea === "nueva") return abrirFormCashea(null);
  if (b.dataset.cashea === "editar") return abrirFormCashea(b.dataset.id);
  if (b.dataset.cashea === "detalle") return abrirDetalleCashea(b.dataset.id);
  if (b.dataset.cashea === "comprobar") return abrirComprobarCashea(b.dataset.id);
  if (b.dataset.cashea === "cerrar") return cerrarModal();
  if (b.dataset.cashea === "estado") return cambiarEstadoCashea(b.dataset.id, b.dataset.estado);
  if (b.dataset.cashea === "exportar") return exportarCashea();
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "buscarCashea") {
    vistaCashea.q = t.value;
    return pintarCashea();
  }
  if (t.closest && t.closest("#formCashea")) actualizarResumenCashea(t.form);
  if (t.closest && t.closest("#formComprobar")) actualizarComprobarCashea(t.form);
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.closest && t.closest("#formCashea")) actualizarResumenCashea(t.form);
  if (t.closest && t.closest("#formComprobar")) actualizarComprobarCashea(t.form);
});
