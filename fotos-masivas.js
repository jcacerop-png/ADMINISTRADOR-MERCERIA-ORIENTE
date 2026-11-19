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

// Limpia extensiones de imagen (incluso dobles como .png.png) y sufijos de copia como " (1)" o "- copia"
const limpiarNombreArchivoFoto = nombre => String(nombre || "")
  .replace(/(\.(png|jpe?g|jfif|webp|gif|bmp|avif|svg|heic|heif))+$/i, "")
  .replace(/\s*(\(\d+\)|-\s*copia(\s*\(\d+\))?)$/i, "")
  .trim();

// Clave exacta (conserva guiones, guiones bajos y puntos para distinguir COR-TRE-5MM de COR_TRE_5MM)
const claveExactaFoto = s => normaTexto(s).replace(/\s+/g, "");
// Clave alfanumérica flexible (ignora guiones, espacios y signos)
const claveFoto = s => normaTexto(s).replace(/[^a-z0-9]/g, "");
// Clave sin ceros a la izquierda en bloques numéricos (ej. HI-COS-03 ↔ HI-COS-3)
const claveSinCerosFoto = s => normaTexto(s)
  .replace(/0+(\d+)/g, "$1")
  .replace(/[^a-z0-9]/g, "");

const esImagenNombre = nombre => /\.(png|jpe?g|jfif|webp|gif|bmp|avif|svg|heic|heif)$/i.test(String(nombre || ""));

// Índice de productos por código exacto, código flexible, código sin ceros y nombre
function indexarProductosFotos() {
  const porCodigoExacto = new Map();
  const porCodigo = new Map();
  const porCodigoSinCeros = new Map();
  const porNombre = new Map();
  const agregar = (mapa, clave, p) => {
    if (!clave) return;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(p);
  };
  for (const p of adm.productos) {
    if (p.codigo) {
      agregar(porCodigoExacto, claveExactaFoto(p.codigo), p);
      agregar(porCodigo, claveFoto(p.codigo), p);
      agregar(porCodigoSinCeros, claveSinCerosFoto(p.codigo), p);
    }
    if (p.nombre) {
      agregar(porNombre, claveFoto(p.nombre), p);
    }
  }
  return { porCodigoExacto, porCodigo, porCodigoSinCeros, porNombre };
}

function buscarProductoParaFoto(nombreArchivo, indices) {
  const base = limpiarNombreArchivoFoto(nombreArchivo);
  const cExacta = claveExactaFoto(base);
  const cFlex = claveFoto(base);
  const cSinCeros = claveSinCerosFoto(base);

  const intentos = [
    indices.porCodigoExacto.get(cExacta),
    indices.porCodigo.get(cFlex),
    indices.porCodigoSinCeros.get(cSinCeros),
    indices.porNombre.get(cFlex),
  ];

  for (const lista of intentos) {
    if (lista && lista.length === 1) return { candidatos: lista };
  }
  // Si hay varios candidatos (ej. dos variantes con código similar), prioriza los que aún no tienen foto
  for (const lista of intentos) {
    if (lista && lista.length > 1) {
      const sinFoto = lista.filter(p => !Array.isArray(p.fotos) || p.fotos.length === 0);
      if (sinFoto.length === 1) return { candidatos: sinFoto };
      return { candidatos: lista };
    }
  }
  return { candidatos: [] };
}

// Convierte la selección (imágenes sueltas y/o .zip) en una lista de { nombre, blob }
async function leerSeleccionFotos(lista) {
  const imagenes = [];
  const avisos = [];
  for (const archivo of lista) {
    const esZip = /\.zip$/i.test(archivo.name) || /zip/i.test(archivo.type || "");
    if (esZip) {
      if (typeof JSZip === "undefined") {
        avisos.push(`No pude leer ${archivo.name}: el lector de .zip no cargó. Revisa tu conexión o sube las fotos sueltas.`);
        continue;
      }
      try {
        const zip = await JSZip.loadAsync(archivo);
        const entradas = Object.values(zip.files).filter(e => {
          const base = e.name.split("/").pop();
          return !e.dir && esImagenNombre(base) && !e.name.startsWith("__MACOSX") && !base.startsWith(".");
        });
        for (const entrada of entradas) {
          const nombre = entrada.name.split("/").pop();
          const bytes = await entrada.async("uint8array");
          const tipo = /\.png$/i.test(nombre)
            ? "image/png"
            : /\.webp$/i.test(nombre)
              ? "image/webp"
              : /\.gif$/i.test(nombre)
                ? "image/gif"
                : "image/jpeg";
          imagenes.push({ nombre, blob: new Blob([bytes], { type: tipo }) });
        }
      } catch (err) {
        avisos.push(`No se pudo descomprimir ${archivo.name}: ${err.message || "archivo dañado"}`);
      }
    } else if ((typeof esArchivoImagen === "function" && esArchivoImagen(archivo)) || (archivo.type || "").startsWith("image/") || esImagenNombre(archivo.name)) {
      imagenes.push({ nombre: archivo.name, blob: archivo });
    } else {
      avisos.push(`${archivo.name}: no es una imagen válida (PNG, JPG o WebP)`);
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
    ${lista("Fotos sin producto (renómbralas con el código o nombre del producto)", r.sinCoincidencia)}
    ${lista("Nombre repetido (asociadas a varios productos)", r.ambiguos)}
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

    // Agrupa cada foto con su(s) producto(s)
    const indices = indexarProductosFotos();
    const grupos = new Map();
    for (const img of imagenes) {
      const { candidatos } = buscarProductoParaFoto(img.nombre, indices);
      if (!candidatos.length) { r.sinCoincidencia.push(img.nombre); continue; }
      if (candidatos.length > 1) {
        r.avisos.push(`${img.nombre}: coincidió con ${candidatos.map(c => c.codigo || c.nombre).join(", ")} y se aplicó a todos.`);
      }
      for (const p of candidatos) {
        if (!grupos.has(p.id)) grupos.set(p.id, { producto: p, imagenes: [] });
        grupos.get(p.id).imagenes.push(img);
      }
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
          const uid = typeof uuidSeguro === "function" ? uuidSeguro() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const ruta = `productos/${uid}.jpg`;
          const { error } = await sb.storage.from("catalogo").upload(ruta, blob, {
            contentType: blob.type || "image/jpeg",
            cacheControl: "31536000",
            upsert: true,
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
  } catch (err) {
    estadoFotos("No se terminó la subida.");
    r.errores.push(err.message || "error inesperado");
    resumenFotos(r);
    toast("No se terminó la subida de fotos: " + (err.message || "error"));
  } finally {
    fm.subiendo = false;
    await cargar();
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("change", (e) => {
  if (e.target.id !== "fotosMasivas") return;
  // Copia la lista antes de vaciar el campo: la selección se pierde si no se copia
  const lista = [...(e.target.files || [])];
  e.target.value = "";
  if (lista.length) subirFotosMasivas(lista);
});
