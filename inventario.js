"use strict";
/* =========================================================
   Inventario: lista de productos con sus existencias, buscador
   en tiempo real (código, nombre o categoría) e importación desde
   Excel o CSV con vista previa antes de guardar.
   Columnas del archivo: Código, Nombre, Categoría, Stock (o
   Cantidad), Precio Mayor y Precio Detal. Si el archivo trae un
   solo "Precio", se toma como precio detal.
   Requiere config.js, comun.js, admin.js y la librería XLSX.
   ========================================================= */

const COLUMNAS_INVENTARIO = {
  codigo: ["codigo", "cod", "codigoproducto", "referencia"],
  nombre: ["nombre", "producto", "nombreproducto"],
  categoria: ["categoria", "tipo"],
  stock: ["stock", "cantidad", "existencias", "unidades"],
  mayor: ["preciomayor", "mayor"],
  detal: ["preciodetal", "detal", "precio", "preciodeventa", "preciodetalle"],
};

const inv = { q: "" };
let importacionPendiente = null;

const claveColumna = s => normaTexto(s).replace(/[^a-z0-9]/g, "");
const enTrozos = (lista, n) => {
  const salida = [];
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
  return salida;
};

/* ---------- Lista ---------- */
function listaInventario() {
  const q = normaTexto(inv.q);
  return [...adm.productos]
    .filter(p => !q || normaTexto(`${p.codigo || ""} ${p.nombre || ""} ${CATEGORIAS[p.tipo] || ""}`).includes(q))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
}

function pintarInventario() {
  const total = adm.productos.length;
  const unidades = adm.productos.reduce((a, p) => a + stockDe(p), 0);
  const sinStock = adm.productos.filter(p => stockDe(p) <= 0).length;
  $("#invResumen").textContent = `${total} producto(s) · ${unidades} unidad(es) en total · ${sinStock} sin existencias`;

  const lista = listaInventario();
  if (!lista.length) {
    $("#invTabla").innerHTML = `<p class="muted">${total
      ? "Ningún producto coincide con la búsqueda."
      : "Aún no hay productos. Importa un archivo o crea uno desde Catálogo."}</p>`;
    return;
  }

  $("#invTabla").innerHTML = `
    <table class="tabla-inv">
      <thead>
        <tr>
          <th>Código</th><th>Producto</th><th>Categoría</th><th>Existencias</th>
          <th>Por variante</th><th>Precio detal</th><th>Precio mayor</th><th>Publicado</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map(p => {
          const s = stockDe(p);
          const estado = s <= 0 ? "sin" : s <= 2 ? "bajo" : "ok";
          const txt = s <= 0 ? "Sin existencias" : s <= 2 ? "Poca" : "Bien";
          const porVariante = (Array.isArray(p.variantes) ? p.variantes : [])
            .map(v => `${esc(v.nombre)}: ${Number(v.stock) || 0}`).join(" · ");
          return `
          <tr class="${p.activo ? "" : "oculto"}">
            <td>${p.codigo ? esc(p.codigo) : `<span class="muted">—</span>`}</td>
            <td><b>${esc(p.nombre)}</b></td>
            <td>${esc(CATEGORIAS[p.tipo] || "")}</td>
            <td><span class="pill-stock ${estado}">${s} ud. · ${txt}</span></td>
            <td class="small">${porVariante || "—"}</td>
            <td>${usd(p.precio)}</td>
            <td>${p.precio_mayor != null ? usd(p.precio_mayor) : `<span class="muted">—</span>`}</td>
            <td>${p.activo ? "Sí" : "No"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

/* ---------- Importar: leer el archivo ---------- */
// Revisa cada fila y separa: productos nuevos, cambios a productos existentes y filas con error
function planificarImportacion(matriz) {
  let inicio = -1;
  let columnas = null;
  for (let i = 0; i < Math.min(matriz.length, 15); i++) {
    const claves = (matriz[i] || []).map(claveColumna);
    const hallada = {};
    Object.entries(COLUMNAS_INVENTARIO).forEach(([campo, alias]) => {
      const j = claves.findIndex(c => c && alias.includes(c));
      if (j >= 0) hallada[campo] = j;
    });
    if (hallada.codigo !== undefined && hallada.nombre !== undefined) {
      inicio = i;
      columnas = hallada;
      break;
    }
  }
  if (!columnas) throw new Error("No encontré las columnas Código y Nombre en la primera hoja");

  const existentes = new Map(adm.productos.filter(p => p.codigo).map(p => [p.codigo, p]));
  const categoriasPorNombre = new Map(Object.entries(CATEGORIAS).map(([k, n]) => [claveColumna(n), k]));
  const vistos = new Set();
  const nuevos = [];
  const cambios = [];
  const errores = [];

  for (let i = inicio + 1; i < matriz.length; i++) {
    const fila = matriz[i] || [];
    const num = i + 1;
    const leer = campo => (columnas[campo] !== undefined ? fila[columnas[campo]] : "");
    const codigo = String(leer("codigo") ?? "").trim();
    const nombre = String(leer("nombre") ?? "").trim();
    if (!codigo && !nombre) continue; // fila vacía

    if (!codigo) { errores.push(`Fila ${num}: falta el código`); continue; }
    if (!nombre) { errores.push(`Fila ${num} (${codigo}): falta el nombre`); continue; }
    if (vistos.has(codigo)) { errores.push(`Fila ${num}: el código ${codigo} se repite en el archivo`); continue; }
    vistos.add(codigo);

    const categoriaTexto = String(leer("categoria") ?? "").trim();
    const tipo = categoriasPorNombre.get(claveColumna(categoriaTexto))
      || (CATEGORIAS[categoriaTexto] ? categoriaTexto : null);
    if (!tipo) {
      errores.push(`Fila ${num} (${codigo}): la categoría “${categoriaTexto || "vacía"}” no existe. Créala en Categorías.`);
      continue;
    }

    const stockTexto = String(leer("stock") ?? "").trim();
    const stock = stockTexto === "" ? 0 : parseInt(stockTexto, 10);
    if (!Number.isFinite(stock) || stock < 0) {
      errores.push(`Fila ${num} (${codigo}): las existencias no son válidas`);
      continue;
    }

    const precio = leerPrecio(leer("detal"));
    if (precio === null) {
      errores.push(`Fila ${num} (${codigo}): falta el precio detal o no es válido`);
      continue;
    }

    const mayorTexto = String(leer("mayor") ?? "").trim();
    const precioMayor = mayorTexto === "" ? null : leerPrecio(mayorTexto);
    if (mayorTexto !== "" && precioMayor === null) {
      errores.push(`Fila ${num} (${codigo}): el precio mayor no es válido`);
      continue;
    }

    const datos = { codigo, nombre: nombre.slice(0, 120), tipo, precio, precio_mayor: precioMayor, stock };
    const actual = existentes.get(codigo);
    if (actual) cambios.push({ ...datos, actual });
    else nuevos.push(datos);
  }

  return { nuevos, cambios, errores };
}

async function importarArchivo(input) {
  const archivo = input.files && input.files[0];
  input.value = "";
  if (!archivo) return;
  if (typeof XLSX === "undefined") return toast("El lector de Excel no cargó. Revisa tu conexión.");
  if (archivo.size > 10 * 1024 * 1024) return toast("El archivo pesa más de 10 MB");

  try {
    const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) throw new Error("el archivo está vacío");
    const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: "", blankrows: false });
    dibujarImportacion(planificarImportacion(matriz));
    abrirModal();
  } catch (err) {
    toast("No se pudo leer el archivo: " + (err.message || "revisa el formato"));
  }
}

function dibujarImportacion(plan) {
  importacionPendiente = plan;
  const { nuevos, cambios, errores } = plan;
  const total = nuevos.length + cambios.length;
  const conVarias = cambios.filter(c => Array.isArray(c.actual.variantes) && c.actual.variantes.length > 1).length;

  $("#modal .sheet").innerHTML = `
  <div class="stack">
    <div class="sheet-head">
      <h2>Importar inventario</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <p class="hint">Los productos se buscan por su código. Los nuevos se crean <b>ocultos</b> (sin publicar) hasta que les pongas fotos y los publiques. A los que ya existen se les actualizan nombre, categoría y precios; las existencias solo cambian si tienen una sola opción o ninguna.</p>

    <div class="kpis">
      ${kpi("Nuevos", nuevos.length)}
      ${kpi("Se actualizan", cambios.length)}
      ${kpi("Con error", errores.length)}
    </div>
    ${conVarias ? `<p class="hint">${conVarias} producto(s) tienen varias opciones: sus existencias no se cambian; ajústalas en Editar.</p>` : ""}

    ${errores.length ? `
      <div class="card">
        <b>Filas que no se importan</b>
        <ul class="lista-simple">${errores.slice(0, 60).map(e => `<li>${esc(e)}</li>`).join("")}</ul>
        ${errores.length > 60 ? `<p class="hint">Y ${errores.length - 60} más.</p>` : ""}
      </div>` : ""}

    <div class="acciones-sheet">
      <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
      <button type="button" class="btn" id="btnConfirmarImport" ${total ? "" : "disabled"}>Importar ${total} producto(s)</button>
    </div>
  </div>`;
}

// Guarda el plan revisado: primero los nuevos, luego los cambios
async function confirmarImportacion() {
  const plan = importacionPendiente;
  if (!plan) return;
  const btn = $("#btnConfirmarImport");
  if (btn) btn.disabled = true;

  try {
    const ahora = new Date().toISOString();
    const filasNuevas = plan.nuevos.map(n => ({
      codigo: n.codigo,
      nombre: n.nombre,
      tipo: n.tipo,
      descripcion: "",
      precio: n.precio,
      precio_mayor: n.precio_mayor,
      costo: 0,
      destacado: false,
      activo: false,
      fotos: [],
      caracteristicas: [],
      accesorios: [],
      usos: [],
      documentos: [],
      variantes: [{ nombre: "Única", stock: n.stock }],
      actualizado_en: ahora,
    }));
    for (const bloque of enTrozos(filasNuevas, 100)) {
      const { error } = await sb.from("productos").insert(bloque);
      if (error) throw error;
    }

    for (const bloque of enTrozos(plan.cambios, 20)) {
      const resultados = await Promise.all(bloque.map(c => {
        const cambio = {
          nombre: c.nombre,
          tipo: c.tipo,
          precio: c.precio,
          precio_mayor: c.precio_mayor,
          actualizado_en: ahora,
        };
        const vars = Array.isArray(c.actual.variantes) ? c.actual.variantes : [];
        if (vars.length === 0) cambio.variantes = [{ nombre: "Única", stock: c.stock }];
        else if (vars.length === 1) cambio.variantes = [{ ...vars[0], stock: c.stock }];
        return sb.from("productos").update(cambio).eq("id", c.actual.id);
      }));
      const fallo = resultados.find(r => r.error);
      if (fallo) throw fallo.error;
    }

    importacionPendiente = null;
    cerrarModal();
    toast(`Inventario importado: ${plan.nuevos.length} nuevo(s), ${plan.cambios.length} actualizado(s) ✔`);
    await cargar();
  } catch (err) {
    const repetido = err && err.code === "23505";
    toast(repetido
      ? "Hay códigos que ya existen en otro producto. Revisa el archivo; puede que algunas filas sí se hayan guardado."
      : "No se importó todo: " + (err.message || "error") + ". Puede que algunas filas sí se hayan guardado; revisa el inventario.");
    if (btn) btn.disabled = false;
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("input", (e) => {
  if (e.target.id !== "buscarInv") return;
  inv.q = e.target.value;
  pintarInventario();
});

document.addEventListener("change", (e) => {
  if (e.target.id === "invIn") importarArchivo(e.target);
});

document.addEventListener("click", (e) => {
  if (e.target.closest("#btnConfirmarImport")) confirmarImportacion();
});
