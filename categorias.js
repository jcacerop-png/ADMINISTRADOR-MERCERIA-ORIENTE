"use strict";
/* =========================================================
   Categorías del panel: crear, renombrar, ocultar, borrar y
   ordenar (arrastrando la barra ⠿ o con ▲ ▼). Se guardan en la
   tabla tipos. Una categoría oculta no aparece en el catálogo,
   y tampoco sus productos.
   Requiere config.js, comun.js y admin.js (cargados antes).
   ========================================================= */

const slugCategoria = s => normaTexto(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const cantidadDeCategoria = codigo => adm.productos.filter(p => p.tipo === codigo).length;

function categoriasOrdenadas() {
  return [...adm.tipos].sort((a, b) =>
    (Number(a.orden) || 0) - (Number(b.orden) || 0)
    || String(a.nombre || a.codigo).localeCompare(String(b.nombre || b.codigo), "es"));
}

function abrirCategorias() {
  dibujarCategorias();
  abrirModal();
}

function dibujarCategorias() {
  const lista = categoriasOrdenadas();
  const ultimo = lista.length - 1;
  $("#modal .sheet").innerHTML = `
  <div class="stack">
    <div class="sheet-head">
      <h2>Categorías</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <p class="hint">Arrastra la barra ⠿ para cambiar el orden (en el celular usa ▲ ▼). Una categoría oculta no aparece en el catálogo, y tampoco sus productos. Solo se puede borrar una categoría que no tenga productos.</p>

    <ul class="cat-lista" id="catLista">
      ${lista.map((c, i) => {
        const n = cantidadDeCategoria(c.codigo);
        const oculta = c.visible === false;
        return `
        <li class="cat-fila ${oculta ? "oculta" : ""}" data-id="${esc(c.codigo)}">
          <span class="agarre" draggable="true" title="Arrastra para ordenar" aria-hidden="true">⠿</span>
          <input class="cat-nombre" value="${esc(c.nombre || c.codigo)}" maxlength="60" data-cat-nombre="${esc(c.codigo)}" aria-label="Nombre de la categoría">
          <span class="muted small cat-n">${n} producto(s)${oculta ? " · oculta" : ""}</span>
          <button type="button" class="btn sm ghost" data-cat-accion="visible" data-id="${esc(c.codigo)}">${oculta ? "Mostrar" : "Ocultar"}</button>
          <button type="button" class="btn sm ghost" data-cat-accion="subir" data-id="${esc(c.codigo)}" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
          <button type="button" class="btn sm ghost" data-cat-accion="bajar" data-id="${esc(c.codigo)}" ${i === ultimo ? "disabled" : ""} aria-label="Bajar">▼</button>
          <button type="button" class="btn sm peligro" data-cat-accion="borrar" data-id="${esc(c.codigo)}" ${n > 0 ? "disabled" : ""} title="${n > 0 ? "Tiene productos: muévelos o ponla oculta" : "Borrar categoría"}">Borrar</button>
        </li>`;
      }).join("") || `<li class="muted">Aún no hay categorías.</li>`}
    </ul>

    <form id="formCategoria" class="form-nota">
      <input name="nombre" maxlength="60" required placeholder="Nombre de la nueva categoría" autocomplete="off" aria-label="Nombre de la nueva categoría">
      <button class="btn sm" type="submit">+ Agregar</button>
    </form>

    <div class="acciones-sheet"><button type="button" class="btn ghost" data-cerrar>Cerrar</button></div>
  </div>`;
}

// Guarda el orden nuevo: cada categoría recibe su posición (1, 2, 3…)
async function guardarOrdenCategorias(codigos) {
  const resultados = await Promise.all(codigos.map((codigo, i) =>
    sb.from("tipos").update({ orden: i + 1 }).eq("codigo", codigo)));
  if (resultados.some(r => r.error)) toast("No se pudo guardar el orden");
  await cargar();
  dibujarCategorias();
}

async function accionCategoria(accion, codigo) {
  const c = adm.tipos.find(x => x.codigo === codigo);
  if (!c) return;
  const lista = categoriasOrdenadas().map(x => x.codigo);
  const i = lista.indexOf(codigo);

  if (accion === "subir" || accion === "bajar") {
    const j = accion === "subir" ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    return guardarOrdenCategorias(lista);
  }

  if (accion === "visible") {
    const nuevaVisible = c.visible === false;
    const { error } = await sb.from("tipos").update({ visible: nuevaVisible }).eq("codigo", codigo);
    if (error) return toast("No se pudo cambiar: " + error.message);
    toast(nuevaVisible ? "Categoría visible en el catálogo ✔" : "Categoría oculta del catálogo");
    await cargar();
    dibujarCategorias();
    return;
  }

  if (accion === "borrar") {
    if (cantidadDeCategoria(codigo) > 0) return toast("Esta categoría tiene productos. Muévelos o ponla oculta.");
    if (!confirm(`¿Borrar la categoría “${c.nombre || codigo}”? No se puede deshacer.`)) return;
    const { error } = await sb.from("tipos").delete().eq("codigo", codigo);
    if (error) return toast("No se pudo borrar: " + error.message);
    toast("Categoría borrada");
    await cargar();
    dibujarCategorias();
  }
}

async function renombrarCategoria(codigo, valor) {
  const c = adm.tipos.find(x => x.codigo === codigo);
  if (!c) return;
  const nombre = String(valor || "").trim().slice(0, 60);
  if (!nombre) {
    toast("La categoría necesita un nombre");
    return dibujarCategorias();
  }
  if (nombre === (c.nombre || codigo)) return;
  const { error } = await sb.from("tipos").update({ nombre }).eq("codigo", codigo);
  if (error) return toast("No se pudo cambiar el nombre: " + error.message);
  toast("Nombre actualizado ✔");
  await cargar();
  dibujarCategorias();
}

async function agregarCategoria(e) {
  const nombre = String(e.target.elements.nombre.value || "").trim().slice(0, 60);
  if (!nombre) return toast("Escribe el nombre de la categoría");
  const codigo = slugCategoria(nombre);
  if (!codigo) return toast("Usa letras o números en el nombre");
  if (adm.tipos.some(c => c.codigo === codigo || normaTexto(c.nombre) === normaTexto(nombre))) {
    return toast("Ya existe una categoría con ese nombre");
  }
  const orden = categoriasOrdenadas().length + 1;
  const { error } = await sb.from("tipos").insert({ codigo, nombre, orden, visible: true });
  if (error) return toast("No se pudo agregar: " + error.message);
  toast("Categoría agregada ✔");
  await cargar();
  dibujarCategorias();
}

/* ---------- Eventos ---------- */
// La ventana de categorías no se cambia, solo su contenido: por eso el arrastre se engancha una vez
habilitarArrastre($("#modal .sheet"), {
  item: ".cat-fila",
  agarre: ".agarre",
  alSoltar: guardarOrdenCategorias,
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat-accion]");
  if (btn) accionCategoria(btn.dataset.catAccion, btn.dataset.id);
});

document.addEventListener("change", (e) => {
  const input = e.target.closest("[data-cat-nombre]");
  if (input) renombrarCategoria(input.dataset.catNombre, input.value);
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "formCategoria") return;
  e.preventDefault();
  agregarCategoria(e);
});
