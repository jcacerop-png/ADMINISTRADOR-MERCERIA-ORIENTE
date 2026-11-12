"use strict";
/* =========================================================
   Venta rápida: busca la prenda, elige variante y cantidad,
   y cobra. El cobro lo hace la función "registrar_venta" en
   la base de datos: valida y descuenta existencias de forma
   segura (si dos personas venden lo mismo, no se pasa de stock).
   Requiere config.js, comun.js, admin.js y analitica.js.
   ========================================================= */

const vt = {
  q: "",
  producto: null,   // id del producto elegido
  variante: null,   // nombre de la variante elegida (ej. "Azul" o "Única")
  cantidad: 1,
  carrito: [],      // [{ producto_id, nombre, tipo, variante, cantidad, precio, costo }]
  hoy: [],          // ventas de hoy (para la lista y el total del día)
};

const vtDisp = (p, variante) => {
  const v = (Array.isArray(p.variantes) ? p.variantes : []).find(x => x.nombre === variante);
  if (!v) return 0;
  const enCarrito = vt.carrito
    .filter(l => l.producto_id === p.id && l.variante === variante)
    .reduce((a, l) => a + l.cantidad, 0);
  return Math.max(0, (Number(v.stock) || 0) - enCarrito);
};

const vtTotal = () => vt.carrito.reduce((a, l) => a + (Number(l.precio) || 0) * l.cantidad, 0);
const vtProducto = () => adm.productos.find(p => p.id === vt.producto) || null;

function refrescarVenta() {
  vtBuscador();
  vtSeleccion();
  vtCarrito();
  vtHoy();
}

/* ---------- Buscador de prendas ---------- */
function vtBuscador() {
  const q = vt.q.trim().toLowerCase();
  const lista = adm.productos
    .filter(p => !q || `${p.nombre} ${CATEGORIAS[p.tipo] || ""}`.toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  $("#resVenta").innerHTML = lista.map(p => {
    const stock = stockDe(p);
    const foto = fotoDe(p);
    return `
    <button type="button" class="pick" data-vpick="${esc(p.id)}" ${stock <= 0 ? "disabled" : ""}>
      <span class="thumbn">${foto ? `<img src="${esc(foto)}" alt="">` : `<span class="sin-foto">Sin foto</span>`}</span>
      <b>${esc(p.nombre)}</b>
      <small>${usd(p.precio)} · ${stock <= 0 ? "agotado" : stock + " ud."}</small>
    </button>`;
  }).join("") || `<p class="muted small">${q ? "No encontramos esa prenda." : "Aún no hay prendas en el catálogo."}</p>`;
}

/* ---------- Elegir variante y cantidad ---------- */
function vtSeleccion() {
  const box = $("#selVenta");
  const p = vtProducto();
  if (!p) { box.innerHTML = ""; return; }

  const variantes = Array.isArray(p.variantes) ? p.variantes : [];
  if (vt.variante && vtDisp(p, vt.variante) <= 0) vt.variante = null;
  const max = vt.variante ? vtDisp(p, vt.variante) : 0;
  if (vt.cantidad > max) vt.cantidad = Math.max(1, max);

  box.innerHTML = `
    <div class="sel-box">
      <div>
        <h4>${esc(p.nombre)}</h4>
        <small class="muted">${usd(p.precio)} · ${esc(CATEGORIAS[p.tipo] || "")}</small>
      </div>
      ${variantes.length ? `
        <div>
          <small class="muted">Variante (disponibles)</small>
          <div class="opts" style="margin-top:6px">
            ${variantes.map(v => {
              const d = vtDisp(p, v.nombre);
              return `<button type="button" class="opt ${vt.variante === v.nombre ? "on" : ""}" data-vvar="${esc(v.nombre)}" ${d <= 0 ? "disabled" : ""}>${esc(v.nombre)} · ${d}</button>`;
            }).join("")}
          </div>
        </div>` : `<p class="muted small">Este producto no tiene variantes. Agrega una en Catálogo para poder venderlo.</p>`}
      <div class="stepper-fila">
        <div class="stepper">
          <button type="button" data-vcant="-1" ${vt.cantidad <= 1 ? "disabled" : ""} aria-label="Quitar uno">−</button>
          <span>${vt.cantidad}</span>
          <button type="button" data-vcant="1" ${!vt.variante || vt.cantidad >= max ? "disabled" : ""} aria-label="Agregar uno">+</button>
        </div>
        <small class="muted">${vt.variante ? `Disponibles: ${max}` : "Elige una variante"}</small>
      </div>
      <button type="button" class="btn" data-vagregar ${vt.variante && max > 0 ? "" : "disabled"}>Agregar a la venta</button>
    </div>`;
}

function vtAgregar() {
  const p = vtProducto();
  if (!p || !vt.variante) return;
  const cant = Math.min(vt.cantidad, vtDisp(p, vt.variante));
  if (cant <= 0) return toast("No hay existencias de esa variante");

  const linea = vt.carrito.find(l => l.producto_id === p.id && l.variante === vt.variante);
  if (linea) linea.cantidad += cant;
  else vt.carrito.push({
    producto_id: p.id, nombre: p.nombre, tipo: p.tipo, variante: vt.variante,
    cantidad: cant, precio: Number(p.precio) || 0, costo: Number(p.costo) || 0,
  });

  vt.producto = null;
  vt.variante = null;
  vt.cantidad = 1;
  vt.q = "";
  $("#buscarVenta").value = "";
  refrescarVenta();
  toast("Agregado a la venta");
}

/* ---------- Venta actual ---------- */
function vtCarrito() {
  $("#lineasVenta").innerHTML = vt.carrito.map((l, i) => {
    const p = adm.productos.find(x => x.id === l.producto_id);
    const max = p ? vtDisp(p, l.variante) : 0;
    return `
    <li class="linea-venta">
      <div>
        <b>${esc(l.nombre)}</b>
        <small>${esc(l.variante)} · ${l.cantidad} × ${usd(l.precio)}</small>
      </div>
      <div class="linea-r">
        <input type="text" class="precio-in" inputmode="decimal" autocomplete="off" value="${esc(escribirPrecio(l.precio))}" data-vprecio="${i}" aria-label="Precio de ${esc(l.nombre)}">
        <div class="stepper">
          <button type="button" data-vlc="${i}" data-d="-1" ${l.cantidad <= 1 ? "disabled" : ""} aria-label="Quitar uno">−</button>
          <span>${l.cantidad}</span>
          <button type="button" data-vlc="${i}" data-d="1" ${max <= 0 ? "disabled" : ""} aria-label="Agregar uno">+</button>
        </div>
        <strong>${usd((Number(l.precio) || 0) * l.cantidad)}</strong>
        <button type="button" class="x" data-vquitar="${i}" aria-label="Quitar">✕</button>
      </div>
    </li>`;
  }).join("") || `<li class="muted small">Aún no hay prendas en la venta.</li>`;

  $("#totalVenta").textContent = usd(vtTotal());
  $("#btnCobrar").disabled = !vt.carrito.length;
}

function vtCambiarCantidad(i, delta) {
  const l = vt.carrito[i];
  if (!l) return;
  const p = adm.productos.find(x => x.id === l.producto_id);
  if (delta > 0 && (!p || vtDisp(p, l.variante) <= 0)) return toast("No hay más existencias de esa variante");
  l.cantidad += delta;
  if (l.cantidad <= 0) vt.carrito.splice(i, 1);
  refrescarVenta();
}

async function vtCobrar() {
  if (!vt.carrito.length) return;
  const items = vt.carrito.map(l => ({
    producto_id: l.producto_id, variante: l.variante, cantidad: l.cantidad, precio: Number(l.precio) || 0,
  }));
  if (items.some(i => !(i.precio >= 0))) return toast("Revisa los precios");

  const btn = $("#btnCobrar");
  btn.disabled = true;
  try {
    const { error } = await sb.rpc("registrar_venta", {
      p_items: items,
      p_metodo: $("#metodoVenta").value,
      p_nota: $("#notaVenta").value.trim(),
    });
    if (error) throw error;
    vt.carrito = [];
    $("#notaVenta").value = "";
    toast("Venta registrada ✔");
    await cargar();
  } catch (err) {
    toast("No se pudo registrar: " + (err.message || "error"));
    btn.disabled = !vt.carrito.length;
  }
}

/* ---------- Ventas de hoy ---------- */
async function vtHoy() {
  if (!sb) return;
  const ini = inicioPeriodo(new Date(), "dia");
  const fin = finPeriodo(ini, "dia");
  try {
    vt.hoy = await obtenerVentas(ini, fin);
  } catch (err) {
    toast("No se pudieron cargar las ventas de hoy");
    return;
  }
  const activas = vt.hoy.filter(v => !v.anulada);
  $("#totalHoy").textContent = `${activas.length} venta(s) · ${usd(sumar(activas, v => v.total))}`;

  $("#ventasHoy").innerHTML = [...vt.hoy].reverse().map(v => {
    const hora = new Date(v.creado_en).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
    const detalle = (Array.isArray(v.items) ? v.items : [])
      .map(i => `${i.cantidad}× ${esc(i.nombre)} (${esc(i.variante)})`).join(", ");
    return `
    <li class="linea ${v.anulada ? "anulada" : ""}">
      <div>
        <b>${hora} · ${esc(v.metodo)}</b>
        <small>${detalle}${v.nota ? ` · ${esc(v.nota)}` : ""} · ${esc(v.usuaria)}</small>
      </div>
      <div class="linea-r">
        <strong>${usd(v.total)}</strong>
        ${v.anulada
          ? `<span class="pill agotado">Anulada</span>`
          : `<button type="button" class="btn sm ghost" data-vanular="${esc(v.id)}">Anular</button>`}
      </div>
    </li>`;
  }).join("") || `<li class="muted small">Todavía no hay ventas hoy.</li>`;
}

async function vtAnular(id) {
  if (!confirm("¿Anular esta venta? Las existencias vuelven al catálogo.")) return;
  const { error } = await sb.rpc("anular_venta", { p_id: id });
  if (error) return toast("No se pudo anular: " + error.message);
  toast("Venta anulada");
  await cargar();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  let n;
  if ((n = t.closest("[data-vpick]"))) {
    const p = adm.productos.find(x => x.id === n.dataset.vpick);
    vt.producto = n.dataset.vpick;
    vt.cantidad = 1;
    vt.variante = p ? ((p.variantes || []).find(v => vtDisp(p, v.nombre) > 0) || {}).nombre || null : null;
    return vtSeleccion();
  }
  if ((n = t.closest("[data-vvar]"))) { vt.variante = n.dataset.vvar; vt.cantidad = 1; return vtSeleccion(); }
  if ((n = t.closest("[data-vcant]"))) { vt.cantidad += Number(n.dataset.vcant); return vtSeleccion(); }
  if (t.closest("[data-vagregar]")) return vtAgregar();
  if ((n = t.closest("[data-vlc]"))) return vtCambiarCantidad(Number(n.dataset.vlc), Number(n.dataset.d));
  if ((n = t.closest("[data-vquitar]"))) { vt.carrito.splice(Number(n.dataset.vquitar), 1); return refrescarVenta(); }
  if (t.closest("#btnCobrar")) return vtCobrar();
  if (t.closest("#btnVaciar")) { vt.carrito = []; return refrescarVenta(); }
  if ((n = t.closest("[data-vanular]"))) return vtAnular(n.dataset.vanular);
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "buscarVenta") {
    vt.q = t.value;
    return vtBuscador();
  }
  if (t.dataset && t.dataset.vprecio !== undefined) {
    const l = vt.carrito[Number(t.dataset.vprecio)];
    if (!l) return;
    const precio = leerPrecio(t.value);
    l.precio = precio === null ? 0 : precio;
    $("#totalVenta").textContent = usd(vtTotal());
  }
});
