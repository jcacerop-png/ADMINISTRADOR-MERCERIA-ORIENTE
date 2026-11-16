"use strict";
/* =========================================================
   Fotos masivas: sube muchas fotos de una sola vez, o un .zip
   con la carpeta de fotos. Cada foto se relaciona con su producto
   por el nombre del archivo (igual al nombre del producto o a su
   código; no importan tildes, espacios ni mayúsculas). Al subir la
   foto, el producto se publica en el catálogo automáticamente.
   Requiere config.js, comun.js y admin.js. Para leer .zip necesita
   la librería JSZip (se carga desde jsDelivr en Administracion.html).
   ========================================================= */

const fm = { subiendo: false };

// Misma normalización para nombres de archivo y nombres de producto
const claveFoto = s => normaTexto(s).replace(/[^a-z0-9]/g, "");

const esImagenNombre = nombre => /\.(png|jpe?g|webp|gif)$/i.test(nombre);

// Índice de productos por código. Si dos productos comparten la misma clave, se marcan como ambiguos
function indexarProductosFotos() {
  const porCodigo = new Map();
  for (const p of adm.productos) {
    const clave = claveFoto(p.codigo || "");
    if (!clave) continue;
    if (!porCodigo.has(clave)) porCodigo.set(clave, []);
    porCodigo.get(clave).push(p);
  }
  return { porCodigo };
}

// Convierte la selección (imágenes sueltas y/o .zip) en una lista de { nombre, blob }
async function leerSeleccionFotos(lista) {
  const imagenes = [];
  const avisos = [];
  for (const archivo of lista) {
    const esZip = /\.zip$/i.test(archivo.name) || /zip/.test(archivo.type || "");
    if (esZip) {
      if (typeof JSZip === "undefined") {
        avisos.push(`No pude leer ${archivo.name}: el lector de .zip no cargó. Revisa tu conexión o sube las fotos sueltas.`);
        continue;
      }
      const zip = await JSZip.loadAsync(archivo);
      const entradas = Object.values(zip.files).filter(e => {
        const base = e.name.split("/").pop();
        return !e.dir && esImagenNombre(base) && !e.name.startsWith("__MACOSX") && !base.startsWith(".");
      });
      for (const entrada of entradas) {
        const nombre = entrada.name.split("/").pop();
        const bytes = await entrada.async("uint8array");
        const tipo = /\.png$/i.test(nombre) ? "image/png" : /\.webp$/i.test(nombre) ? "image/webp" : "image/jpeg";
        imagenes.push({ nombre, blob: new Blob([bytes], { type: tipo }) });
      }
    } else if ((archivo.type || "").startsWith("image/") || esImagenNombre(archivo.name)) {
      imagenes.push({ nombre: archivo.name, blob: archivo });
    } else {
      avisos.push(`${archivo.name}: no es una imagen (PNG, JPG o WebP)`);
    }
  }
  return { imagenes, avisos };
}

// Muestra el estado mientras se suben las fotos (en el panel del Catálogo)
function estadoFotos(texto) {
  const el = document.getElementById("fotosEstado");
  if (el) el.textContent = texto;
}

// Pinta el resumen final dentro del Catálogo
function resumenFotos(r) {
  const el = document.getElementById("fotosResumen");
  if (!el) return;
  const lista = (titulo, items, max = 80) => items.length ? `
    <details class="fotos-detalle">
      <summary><b>${esc(titulo)} (${items.length})</b></summary>
      <ul class="lista-simple">${items.slice(0, max).map(t => `<li>${esc(t)}</li>`).join("")}</ul>
      ${items.length > max ? `<p class="hint">Y ${items.length - max} más.</p>` : ""}
    </details>` : "";
  el.innerHTML = `
    <div class="kpis">
      ${kpi("Publicados con foto", r.publicados.length)}
      ${kpi("Fotos subidas", r.fotosSubidas)}
      ${kpi("Sin producto", r.sinCoincidencia.length)}
    </div>
    ${lista("Fotos sin producto (renómbralas con el código del producto)", r.sinCoincidencia)}
    ${lista("Nombre repetido (no se subieron)", r.ambiguos)}
    ${lista("Productos que ya tenían el máximo de fotos", r.omitidos)}
    ${lista("Errores", r.errores)}
    ${lista("Avisos", r.avisos)}`;
}

/* Sube las fotos y publica cada producto encontrado. Un producto con error no detiene al resto */
async function subirFotosMasivas(lista) {
  if (fm.subiendo) return toast("Espera a que termine la subida actual");
  if (!sb) return toast("Sin conexión con la base de datos");
  if (!lista || !lista.length) return;

  fm.subiendo = true;
  // Productos frescos: la relación foto → producto se calcula con la lista actual
  estadoFotos("Leyendo productos…");
  await cargar();
  const r = { publicados: [], fotosSubidas: 0, sinCoincidencia: [], ambiguos: [], omitidos: [], errores: [], avisos: [] };
  try {
    estadoFotos("Leyendo archivos…");
    const { imagenes, avisos } = await leerSeleccionFotos(lista);
    r.avisos.push(...avisos);
    if (!imagenes.length) {
      estadoFotos("No encontré fotos para subir.");
      resumenFotos(r);
      return toast("No encontré fotos (PNG, JPG o WebP) en la selección");
    }

    // Agrupa cada foto con su producto
    const { porCodigo } = indexarProductosFotos();
    const grupos = new Map();
    for (const img of imagenes) {
      const clave = claveFoto(img.nombre.replace(/\.[^.]+$/, ""));
      // Solo por código: el nombre de la foto debe ser el código del producto (ej. ACC-M-037.png)
      const candidatos = porCodigo.get(clave) || [];
      if (!candidatos.length) { r.sinCoincidencia.push(img.nombre); continue; }
      if (candidatos.length > 1) { r.ambiguos.push(img.nombre); continue; }
      const p = candidatos[0];
      if (!grupos.has(p.id)) grupos.set(p.id, { producto: p, imagenes: [] });
      grupos.get(p.id).imagenes.push(img);
    }

    const total = [...grupos.values()].reduce((a, g) => a + g.imagenes.length, 0);
    let hechas = 0;
    for (const { producto: p, imagenes: fotosDelProducto } of grupos.values()) {
      const actuales = Array.isArray(p.fotos) ? [...p.fotos] : [];
      const libres = MAX_FOTOS - actuales.length;
      if (libres <= 0) { r.omitidos.push(`${p.nombre}: ya tiene ${MAX_FOTOS} fotos`); hechas += fotosDelProducto.length; continue; }

      const nuevas = [];
      for (const img of fotosDelProducto.slice(0, libres)) {
        hechas++;
        estadoFotos(`Subiendo foto ${hechas} de ${total}…`);
        try {
          const blob = await comprimir(img.blob, 1200);
          const ruta = `productos/${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from("catalogo").upload(ruta, blob, {
            contentType: "image/jpeg",
            cacheControl: "31536000",
          });
          if (error) throw error;
          nuevas.push(sb.storage.from("catalogo").getPublicUrl(ruta).data.publicUrl);
        } catch (err) {
          r.errores.push(`${img.nombre}: ${err.message || "no se pudo subir"}`);
        }
      }
      if (!nuevas.length) continue;

      // Guarda las fotos y publica el producto en la misma operación
      const { error } = await sb.from("productos")
        .update({ fotos: [...actuales, ...nuevas], activo: true, actualizado_en: new Date().toISOString() })
        .eq("id", p.id);
      if (error) { r.errores.push(`${p.nombre}: ${error.message}`); continue; }
      r.publicados.push(p.nombre);
      r.fotosSubidas += nuevas.length;
    }

    estadoFotos(`Listo: ${r.publicados.length} producto(s) publicados con foto.`);
    resumenFotos(r);
    toast(`${r.publicados.length} producto(s) publicados con foto ✔`);
    await cargar();
  } catch (err) {
    estadoFotos("No se terminó la subida.");
    r.errores.push(err.message || "error inesperado");
    resumenFotos(r);
    toast("No se terminó la subida de fotos: " + (err.message || "error"));
  } finally {
    fm.subiendo = false;
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("change", (e) => {
  if (e.target.id !== "fotosMasivas") return;
  // Copia la lista antes de vaciar el campo: la selección se pierde si no se copia
  const lista = [...e.target.files];
  e.target.value = "";
  subirFotosMasivas(lista);
});
