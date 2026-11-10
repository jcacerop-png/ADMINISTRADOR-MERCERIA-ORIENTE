"use strict";
/* =========================================================
   Panel de administración: login, catálogo, plantillas y notas.
   Requiere config.js y comun.js (cargados antes).
   ========================================================= */

const CUENTAS = {
  "rodolfo019@merceria.com": "Rodolfo",
  "administrador029@merceria.com": "Administrador",
};
const MAX_FOTOS = 8;

const adm = {
  usuaria: null,
  productos: [],
  tipos: [],
  actividad: [],
  notas: [],
  chip: "todos",
  q: "",
  form: null,          // producto abierto en el formulario
  plantilla: "maquina" // tipo que se edita en "Editar plantillas"
};

const stockDe = p => (Array.isArray(p.variantes) ? p.variantes : []).reduce((a, v) => a + (Number(v.stock) || 0), 0);
const fotoDe = p => (Array.isArray(p.fotos) && p.fotos[0]) || "";
const plantillaDe = tipo => adm.tipos.find(t => t.codigo === tipo) || { campos: [], accesorios: [], usos: [] };
const lineasDe = t => String(t || "").split("\n").map(s => s.trim()).filter(Boolean);
const fechaHora = iso => new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const kpi = (titulo, valor) => `<div class="card kpi"><small>${titulo}</small><strong>${valor}</strong></div>`;
const variantesPorDefecto = () => [{ nombre: "Única", stock: 0 }];

/* ---------- Login ---------- */
function actualizarRol() {
  const dueno = $("#selCuenta").value === "rodolfo019@merceria.com";
  $("#rolCuenta").textContent = dueno ? "Dueño" : "Administrador";
}

function mostrarLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#loginForm").elements.password.value = "";
  $("#loginError").hidden = true;
  actualizarRol();
}

async function iniciarSesion(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.elements.cuenta.value;
  const password = form.elements.password.value;
  const btn = $("#btnEntrar");
  const error = $("#loginError");
  let ok = false;

  btn.disabled = true;
  error.hidden = true;
  try {
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) throw err;
    ok = true;
  } catch {
    error.textContent = "Contraseña incorrecta.";
    error.hidden = false;
  } finally {
    btn.disabled = false;
  }

  if (ok) {
    form.elements.password.value = "";
    adm.usuaria = CUENTAS[email] || "Administrador";
    await entrarPanel();
  }
}

async function entrarPanel() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#quien").textContent = `Sesión: ${adm.usuaria}`;
  suscribir();
  irA("inicio");
  await cargar();
}

async function salir() {
  try {
    sb.removeAllChannels();
    await sb.auth.signOut();
  } catch (err) {
    console.error(err);
  }
  adm.usuaria = null;
  adm.form = null;
  cerrarModal();
  mostrarLogin();
}

function suscribir() {
  sb.removeAllChannels();
  const refrescar = () => cargar();
  sb.channel("panel-merceria")
    .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, refrescar)
    .on("postgres_changes", { event: "*", schema: "public", table: "notas" }, refrescar)
    .on("postgres_changes", { event: "*", schema: "public", table: "actividad" }, refrescar)
    .subscribe();
}

/* ---------- Carga y pintado ---------- */
async function cargar() {
  if (!adm.usuaria) return;
  try {
    const [p, t, a, n] = await Promise.all([
      sb.from("productos").select("*").order("nombre"),
      sb.from("tipos").select("*"),
      sb.from("actividad").select("*").order("creado_en", { ascending: false }).limit(40),
      sb.from("notas").select("*").order("creado_en", { ascending: false }).limit(200),
    ]);
    for (const r of [p, t, a, n]) if (r.error) throw r.error;
    adm.productos = p.data || [];
    adm.tipos = t.data || [];
    adm.actividad = a.data || [];
    adm.notas = n.data || [];
    pintarInicio();
    pintarCatalogo();
    pintarNotas();
  } catch (err) {
    toast("No se pudieron cargar los datos: " + (err.message || "error"));
  }
}

function irA(tab) {
  $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== tab));
  $$("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  window.scrollTo(0, 0);
}

function pintarInicio() {
  const publicados = adm.productos.filter(p => p.activo);
  const sinStock = publicados.filter(p => stockDe(p) === 0).length;
  const sinFoto = adm.productos.filter(p => !fotoDe(p)).length;

  $("#saludo").textContent = `Hola, ${adm.usuaria}`;
  $("#kpis").innerHTML = [
    kpi("Publicados", publicados.length),
    kpi("Sin existencias", sinStock),
    kpi("Sin foto", sinFoto),
    kpi("Ocultos", adm.productos.length - publicados.length),
  ].join("");

  const bajos = [];
  adm.productos.forEach(p => (Array.isArray(p.variantes) ? p.variantes : []).forEach(v => {
    if (Number(v.stock) <= 2) bajos.push({ p, v });
  }));
  $("#bajos").innerHTML = bajos.slice(0, 40).map(({ p, v }) => `
    <li class="linea">
      <div><b>${esc(p.nombre)}</b><small>${esc(v.nombre)}</small></div>
      <strong class="${Number(v.stock) <= 0 ? "neg" : ""}">${Number(v.stock) <= 0 ? "Agotado" : `${v.stock} ud.`}</strong>
    </li>`).join("")
    || `<li class="muted">Todo con buena existencia.</li>`;

  $("#feed").innerHTML = adm.actividad.map(a => `
    <li class="linea"><div><b>${esc(a.usuaria)}</b> ${esc(a.texto)}<small>${fechaHora(a.creado_en)}</small></div></li>`).join("")
    || `<li class="muted">Aún no hay actividad.</li>`;
}

function tarjetaAdm(p) {
  const s = stockDe(p);
  const foto = fotoDe(p);
  return `
  <article class="card prod-adm ${p.activo ? "" : "oculto"}">
    <div class="foto">${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}">` : `<span class="sin-foto">Sin foto</span>`}</div>
    <div class="cuerpo">
      <span class="tipo">${esc(TIPOS[p.tipo] || "")}${p.activo ? "" : " · oculto"}${p.destacado ? " · ★ destacado" : ""}</span>
      <h3>${esc(p.nombre)}</h3>
      <div class="fila-precio">
        <strong>${usd(p.precio)}</strong>
        <span class="pill ${s > 0 ? "ok" : "agotado"}">${s} ud.</span>
      </div>
      <div class="acciones-card">
        <button class="btn sm" data-action="editar" data-id="${esc(p.id)}">Editar</button>
        <button class="btn sm ghost" data-action="activo" data-id="${esc(p.id)}">${p.activo ? "Ocultar" : "Publicar"}</button>
        <button class="btn sm peligro" data-action="borrar" data-id="${esc(p.id)}">Eliminar</button>
      </div>
    </div>
  </article>`;
}

function pintarCatalogo() {
  $("#chipsAdm").innerHTML = [["todos", "Todos"], ...Object.entries(TIPOS)]
    .map(([k, l]) => `<button class="chip ${adm.chip === k ? "on" : ""}" data-chip="${k}">${esc(l)}</button>`)
    .join("");

  const q = adm.q.trim().toLowerCase();
  const lista = adm.productos.filter(p =>
    (adm.chip === "todos" || p.tipo === adm.chip) &&
    (!q || `${p.nombre} ${TIPOS[p.tipo] || ""}`.toLowerCase().includes(q)));

  $("#gridAdm").innerHTML = lista.map(tarjetaAdm).join("")
    || `<p class="muted">Aún no hay productos. Usa “+ Nuevo producto” para empezar.</p>`;
}

function pintarNotas() {
  const orden = [...adm.notas].sort((a, b) =>
    (Number(a.hecha) - Number(b.hecha)) || String(b.creado_en).localeCompare(String(a.creado_en)));
  $("#listaNotas").innerHTML = orden.map(n => `
    <li class="nota-item ${n.hecha ? "hecho" : ""}">
      <button class="check" data-action="nota-toggle" data-id="${esc(n.id)}" aria-label="${n.hecha ? "Marcar como pendiente" : "Marcar como hecha"}">${n.hecha ? "✔" : ""}</button>
      <span>${esc(n.texto)}<small>${esc(n.usuaria)} · ${fechaHora(n.creado_en)}</small></span>
      <button class="x" data-action="nota-borrar" data-id="${esc(n.id)}" aria-label="Eliminar nota">✕</button>
    </li>`).join("")
    || `<li class="muted">No hay notas. Escribe tu primer pendiente arriba.</li>`;
}

/* ---------- Producto: datos del formulario ---------- */
function formNuevo(tipo) {
  const t = plantillaDe(tipo);
  return {
    id: null,
    tipo,
    nombre: "",
    descripcion: "",
    precio: "",
    costo: "",
    destacado: false,
    activo: true,
    fotos: [],
    caracteristicas: t.campos.map(c => ({ campo: c, valor: "" })),
    accesorios: [...t.accesorios],
    usos: [...t.usos],
    documentos: [],
    variantes: variantesPorDefecto(),
  };
}

function formDesde(p) {
  return {
    id: p.id,
    tipo: p.tipo || "otro",
    nombre: p.nombre || "",
    descripcion: p.descripcion || "",
    precio: p.precio ?? "",
    costo: p.costo ?? "",
    destacado: !!p.destacado,
    activo: p.activo !== false,
    fotos: [...(p.fotos || [])],
    caracteristicas: (p.caracteristicas || []).map(c => ({ campo: c.campo || "", valor: c.valor || "" })),
    accesorios: [...(p.accesorios || [])],
    usos: [...(p.usos || [])],
    documentos: (p.documentos || []).map(d => ({ nombre: d.nombre || "", url: d.url || "" })),
    variantes: (p.variantes || []).map(v => ({ nombre: v.nombre || "", stock: v.stock ?? 0 })),
  };
}

function abrirFormulario(p) {
  adm.form = p ? formDesde(p) : formNuevo("maquina");
  dibujarFormulario();
  abrirModal();
}

function dibujarFormulario() {
  const f = adm.form;
  if (!f) return;
  const opcionesTipo = Object.entries(TIPOS)
    .map(([k, l]) => `<option value="${k}" ${f.tipo === k ? "selected" : ""}>${esc(l)}</option>`).join("");

  $("#modal .sheet").innerHTML = `
  <form id="formProd" class="stack" novalidate>
    <div class="sheet-head">
      <h2>${f.id ? "Editar producto" : "Nuevo producto"}</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>

    <div>
      <p class="label">Fotos · la primera es la principal (máximo ${MAX_FOTOS})</p>
      <div class="fotos-pf">
        ${f.fotos.map((u, i) => `
          <div class="foto-pf">
            <img src="${esc(u)}" alt="Foto ${i + 1}">
            <div class="acc-foto">
              ${i === 0
                ? `<span class="pill ok">Principal</span>`
                : `<button type="button" class="btn sm ghost" data-action="foto-principal" data-i="${i}">Hacer principal</button>`}
              <button type="button" class="btn sm peligro" data-action="quitar-foto" data-i="${i}">Quitar</button>
            </div>
          </div>`).join("")}
        ${f.fotos.length < MAX_FOTOS
          ? `<label class="subir">+ Subir fotos<input type="file" id="fotosIn" accept="image/*" multiple class="sr"></label>`
          : ""}
      </div>
      <p class="hint">Las fotos se suben en cuanto las eliges.</p>
    </div>

    <div class="grid-form">
      <label>Tipo<select data-b="tipo">${opcionesTipo}</select></label>
      <label>Nombre<input data-b="nombre" maxlength="120" value="${esc(f.nombre)}"></label>
    </div>
    <label>Descripción<textarea data-b="descripcion" rows="3" maxlength="1000">${esc(f.descripcion)}</textarea></label>

    <div class="grid-form">
      <label>Precio de venta (USD)<input data-b="precio" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(f.precio)}"></label>
      <label>Costo (USD) · solo lo ves tú<input data-b="costo" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(f.costo)}"></label>
    </div>

    <div class="tog-row">
      <label class="tog"><input type="checkbox" data-b="destacado" ${f.destacado ? "checked" : ""}> Destacado</label>
      <label class="tog"><input type="checkbox" data-b="activo" ${f.activo ? "checked" : ""}> Publicado en el catálogo</label>
    </div>

    <fieldset class="bloque">
      <legend>Características</legend>
      <p class="hint">Vienen de la plantilla de su tipo. Puedes cambiar el nombre, el valor, o agregar y quitar filas.</p>
      ${f.caracteristicas.map((c, i) => `
        <div class="fila-car">
          <input data-arr="car" data-i="${i}" data-k="campo" value="${esc(c.campo)}" aria-label="Nombre de la característica">
          <input data-arr="car" data-i="${i}" data-k="valor" value="${esc(c.valor)}" placeholder="Valor" aria-label="Valor">
          <button type="button" class="x" data-action="quitar-car" data-i="${i}" aria-label="Quitar">✕</button>
        </div>`).join("")}
      <div><button type="button" class="btn sm ghost" data-action="agregar-car">+ Característica</button></div>
    </fieldset>

    <fieldset class="bloque">
      <legend>Accesorios incluidos</legend>
      <p class="hint">Uno por línea.</p>
      <textarea data-b="accesorios" rows="4">${esc(f.accesorios.join("\n"))}</textarea>
    </fieldset>

    <fieldset class="bloque">
      <legend>Usos</legend>
      <p class="hint">Uno por línea.</p>
      <textarea data-b="usos" rows="3">${esc(f.usos.join("\n"))}</textarea>
    </fieldset>

    <fieldset class="bloque">
      <legend>Existencias por variante</legend>
      <p class="hint">Colores, modelos o “Única”. La clienta solo ve Disponible o Agotado.</p>
      ${f.variantes.map((v, i) => `
        <div class="fila-var">
          <input data-arr="var" data-i="${i}" data-k="nombre" value="${esc(v.nombre)}" aria-label="Nombre de la variante">
          <input data-arr="var" data-i="${i}" data-k="stock" type="number" min="0" step="1" inputmode="numeric" value="${esc(v.stock)}" aria-label="Existencias">
          <button type="button" class="x" data-action="quitar-var" data-i="${i}" aria-label="Quitar">✕</button>
        </div>`).join("")}
      <div><button type="button" class="btn sm ghost" data-action="agregar-var">+ Variante</button></div>
    </fieldset>

    <fieldset class="bloque">
      <legend>Documentos para descargar</legend>
      <p class="hint">Enlace directo a un PDF (opcional). Debe empezar con https://</p>
      ${f.documentos.map((d, i) => `
        <div class="fila-doc">
          <input data-arr="doc" data-i="${i}" data-k="nombre" value="${esc(d.nombre)}" placeholder="Nombre del documento" aria-label="Nombre del documento">
          <input data-arr="doc" data-i="${i}" data-k="url" value="${esc(d.url)}" placeholder="https://..." aria-label="Enlace">
          <button type="button" class="x" data-action="quitar-doc" data-i="${i}" aria-label="Quitar">✕</button>
        </div>`).join("")}
      <div><button type="button" class="btn sm ghost" data-action="agregar-doc">+ Documento</button></div>
    </fieldset>

    <div class="acciones-sheet">
      <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
      <button class="btn" type="submit">Guardar</button>
    </div>
  </form>`;
}

async function subirFotos(files) {
  const f = adm.form;
  if (!f || !files || !files.length) return;
  const libres = MAX_FOTOS - f.fotos.length;
  if (libres <= 0) return toast(`Máximo ${MAX_FOTOS} fotos por producto`);

  for (const file of [...files].slice(0, libres)) {
    if (!file.type.startsWith("image/")) { toast("Solo se pueden subir imágenes"); continue; }
    if (file.size > 15 * 1024 * 1024) { toast("Esa foto pesa más de 15 MB"); continue; }
    try {
      toast("Subiendo foto…");
      const blob = await comprimir(file, 1200);
      const ruta = `productos/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from("catalogo").upload(ruta, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (error) throw error;
      f.fotos.push(sb.storage.from("catalogo").getPublicUrl(ruta).data.publicUrl);
    } catch (err) {
      toast("No se pudo subir la foto: " + (err.message || "error"));
    }
  }
  dibujarFormulario();
}

function cambiarTipo(tipo) {
  const f = adm.form;
  if (!f) return;
  if (f.id) {
    // Producto existente: solo cambia el tipo, sin reemplazar lo que ya escribiste
    f.tipo = tipo;
    return dibujarFormulario();
  }
  // Producto nuevo: carga la plantilla de ese tipo
  const base = formNuevo(tipo);
  Object.assign(f, {
    tipo,
    caracteristicas: base.caracteristicas,
    accesorios: base.accesorios,
    usos: base.usos,
  });
  dibujarFormulario();
}

async function guardarProducto(e) {
  e.preventDefault();
  const f = adm.form;
  if (!f) return;
  const btn = $("#formProd [type=submit]");

  const nombre = String(f.nombre || "").trim();
  if (!nombre) return toast("Escribe el nombre del producto");
  if (!TIPOS[f.tipo]) return toast("Elige el tipo de producto");
  if (String(f.precio).trim() === "" || !(Number(f.precio) >= 0)) return toast("Revisa el precio en dólares");
  const costo = String(f.costo).trim() === "" ? 0 : Number(f.costo);
  if (!(costo >= 0)) return toast("Revisa el costo");

  const documentos = f.documentos
    .map(d => ({ nombre: String(d.nombre || "").trim(), url: String(d.url || "").trim() }))
    .filter(d => d.nombre || d.url)
    .map(d => ({ nombre: d.nombre || "Descargar", url: d.url }));
  if (documentos.some(d => !/^https:\/\//i.test(d.url))) {
    return toast("Los documentos necesitan un enlace que empiece con https://");
  }

  const fila = {
    nombre: nombre.slice(0, 120),
    tipo: f.tipo,
    descripcion: String(f.descripcion || "").trim().slice(0, 1000),
    precio: Math.round(Number(f.precio) * 100) / 100,
    costo: Math.round(costo * 100) / 100,
    destacado: !!f.destacado,
    activo: !!f.activo,
    fotos: f.fotos,
    caracteristicas: f.caracteristicas
      .map(c => ({ campo: String(c.campo || "").trim(), valor: String(c.valor || "").trim() }))
      .filter(c => c.campo),
    accesorios: f.accesorios,
    usos: f.usos,
    documentos,
    variantes: f.variantes
      .map(v => ({ nombre: String(v.nombre || "").trim(), stock: Math.max(0, parseInt(v.stock, 10) || 0) }))
      .filter(v => v.nombre),
    actualizado_en: new Date().toISOString(),
  };

  btn.disabled = true;
  const consulta = f.id
    ? sb.from("productos").update(fila).eq("id", f.id)
    : sb.from("productos").insert(fila);
  const { error } = await consulta;

  if (error) {
    toast("No se pudo guardar: " + error.message);
    btn.disabled = false;
    return;
  }
  adm.form = null;
  cerrarModal();
  toast("Producto guardado ✔");
  await cargar();
}

async function alternarPublicado(id) {
  const p = adm.productos.find(x => x.id === id);
  if (!p) return;
  const { error } = await sb.from("productos")
    .update({ activo: !p.activo, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  if (error) return toast("No se pudo cambiar: " + error.message);
  toast(p.activo ? "Producto oculto del catálogo" : "Producto publicado ✔");
  await cargar();
}

async function borrarProducto(id) {
  const p = adm.productos.find(x => x.id === id);
  if (!p || !confirm(`¿Eliminar “${p.nombre}”? No se puede deshacer.`)) return;
  const { error } = await sb.from("productos").delete().eq("id", id);
  if (error) return toast("No se pudo eliminar: " + error.message);
  toast("Producto eliminado");
  await cargar();
}

/* ---------- Plantillas por tipo ---------- */
function dibujarPlantillas() {
  const t = plantillaDe(adm.plantilla);
  $("#modal .sheet").innerHTML = `
  <form id="formPlantillas" class="stack">
    <div class="sheet-head">
      <h2>Plantillas por tipo</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <p class="hint">Al crear un producto de este tipo se cargan estos campos, accesorios y usos. Cada producto puede cambiarlos.</p>
    <label>Tipo
      <select id="plTipo">
        ${Object.entries(TIPOS).map(([k, l]) => `<option value="${k}" ${k === adm.plantilla ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
    </label>
    <label>Campos de características (uno por línea)
      <textarea name="campos" rows="6">${esc(t.campos.join("\n"))}</textarea>
    </label>
    <label>Accesorios sugeridos (uno por línea)
      <textarea name="accesorios" rows="5">${esc(t.accesorios.join("\n"))}</textarea>
    </label>
    <label>Usos sugeridos (uno por línea)
      <textarea name="usos" rows="4">${esc(t.usos.join("\n"))}</textarea>
    </label>
    <div class="acciones-sheet">
      <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
      <button class="btn" type="submit">Guardar plantilla</button>
    </div>
  </form>`;
}

async function guardarPlantilla(e) {
  e.preventDefault();
  const f = e.target;
  const fila = {
    codigo: adm.plantilla,
    campos: lineasDe(f.elements.campos.value),
    accesorios: lineasDe(f.elements.accesorios.value),
    usos: lineasDe(f.elements.usos.value),
  };
  const { error } = await sb.from("tipos").upsert(fila, { onConflict: "codigo" });
  if (error) return toast("No se pudo guardar la plantilla: " + error.message);
  cerrarModal();
  toast("Plantilla guardada ✔");
  await cargar();
}

/* ---------- Notas ---------- */
async function agregarNota(e) {
  e.preventDefault();
  const input = e.target.elements.texto;
  const texto = input.value.trim();
  if (!texto) return;
  const { error } = await sb.from("notas").insert({ texto });
  if (error) return toast("No se pudo guardar la nota");
  input.value = "";
  await cargar();
}

async function alternarNota(id) {
  const n = adm.notas.find(x => x.id === id);
  if (!n) return;
  const { error } = await sb.from("notas").update({ hecha: !n.hecha }).eq("id", id);
  if (error) return toast("No se pudo actualizar la nota");
  await cargar();
}

async function borrarNota(id) {
  const { error } = await sb.from("notas").delete().eq("id", id);
  if (error) return toast("No se pudo eliminar la nota");
  await cargar();
}

/* ---------- Acciones (botones) ---------- */
async function accion(nombre, el) {
  const id = el.dataset.id;
  const i = Number(el.dataset.i);
  const f = adm.form;

  switch (nombre) {
    case "salir": return salir();
    case "nuevo": return abrirFormulario(null);
    case "editar": return abrirFormulario(adm.productos.find(p => p.id === id));
    case "activo": return alternarPublicado(id);
    case "borrar": return borrarProducto(id);
    case "plantillas":
      adm.plantilla = "maquina";
      dibujarPlantillas();
      return abrirModal();
    case "nota-toggle": return alternarNota(id);
    case "nota-borrar": return borrarNota(id);
  }

  if (!f) return;
  switch (nombre) {
    case "agregar-car": f.caracteristicas.push({ campo: "", valor: "" }); return dibujarFormulario();
    case "quitar-car": f.caracteristicas.splice(i, 1); return dibujarFormulario();
    case "agregar-var": f.variantes.push({ nombre: "", stock: 0 }); return dibujarFormulario();
    case "quitar-var": f.variantes.splice(i, 1); return dibujarFormulario();
    case "agregar-doc": f.documentos.push({ nombre: "", url: "" }); return dibujarFormulario();
    case "quitar-doc": f.documentos.splice(i, 1); return dibujarFormulario();
    case "quitar-foto": f.fotos.splice(i, 1); return dibujarFormulario();
    case "foto-principal": {
      const [u] = f.fotos.splice(i, 1);
      f.fotos.unshift(u);
      return dibujarFormulario();
    }
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest("[data-tab]");
  if (tab) return irA(tab.dataset.tab);
  const chip = t.closest("[data-chip]");
  if (chip) {
    adm.chip = chip.dataset.chip;
    return pintarCatalogo();
  }
  const btn = t.closest("[data-action]");
  if (btn) return accion(btn.dataset.action, btn);
});

// Escribir en el formulario: se guarda en memoria, sin volver a dibujar (no pierde el foco)
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "buscarAdm") {
    adm.q = t.value;
    return pintarCatalogo();
  }
  const f = adm.form;
  if (!f || !t.closest("#formProd")) return;

  if (t.dataset.arr) {
    const lista = { car: f.caracteristicas, doc: f.documentos, var: f.variantes }[t.dataset.arr];
    const fila = lista && lista[Number(t.dataset.i)];
    if (fila) fila[t.dataset.k] = t.value;
    return;
  }

  const b = t.dataset.b;
  if (b === "accesorios" || b === "usos") f[b] = lineasDe(t.value);
  else if (b && b !== "tipo" && b !== "destacado" && b !== "activo") f[b] = t.value;
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fotosIn") return subirFotos(t.files);
  if (t.id === "selCuenta") return actualizarRol();
  if (t.id === "plTipo") {
    adm.plantilla = t.value;
    return dibujarPlantillas();
  }
  const f = adm.form;
  if (!f || !t.closest("#formProd") || !t.dataset.b) return;
  if (t.dataset.b === "tipo") return cambiarTipo(t.value);
  if (t.type === "checkbox") f[t.dataset.b] = t.checked;
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "loginForm") return iniciarSesion(e);
  if (id === "formProd") return guardarProducto(e);
  if (id === "formPlantillas") return guardarPlantilla(e);
  if (id === "formNota") return agregarNota(e);
});

/* ---------- Arranque ---------- */
function iniciar() {
  if (!CONFIGURADO) {
    toast("Falta configurar Supabase en config.js");
    return;
  }
  mostrarLogin();
}

iniciar();
