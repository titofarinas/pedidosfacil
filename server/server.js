const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { createStore } = require("./store");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PASSWORD = process.env.PANEL_PASSWORD || "1234";
const SESSION_MS = 12 * 60 * 60 * 1000;
const ESTADOS = ["nuevo", "preparando", "listo", "entregado", "cancelado"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

const business = loadBusiness();
const sessions = new Map();
const attempts = new Map();
let store = null;

function loadBusiness() {
  const context = vm.createContext({ window: {} });
  ["assets/js/config.js", "assets/js/productos.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  return {
    negocio: context.window.NEGOCIO || {},
    productos: Array.isArray(context.window.PRODUCTOS) ? context.window.PRODUCTOS : []
  };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function readJson(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("El pedido es demasiado grande."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(Object.assign(new Error("JSON inválido."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function bodyOrNull(req, res) {
  try {
    return await readJson(req);
  } catch (error) {
    json(res, error.status || 400, { error: error.message });
    return null;
  }
}

function clientIp(req) {
  return req.socket.remoteAddress || "desconocida";
}

function loginBlocked(ip) {
  const data = attempts.get(ip);
  if (!data) return false;
  if (Date.now() - data.first > 10 * 60 * 1000) {
    attempts.delete(ip);
    return false;
  }
  return data.count >= 8;
}

function registerFailure(ip) {
  const data = attempts.get(ip) || { count: 0, first: Date.now() };
  data.count += 1;
  attempts.set(ip, data);
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}

function authorized(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function generateCode() {
  return "P-" + crypto.randomBytes(2).toString("hex").toUpperCase();
}

function normalizeCode(proposed) {
  const code = String(proposed || "").trim().toUpperCase().slice(0, 12);
  return /^P-[A-Z0-9]{3,8}$/.test(code) ? code : generateCode();
}

function isDuplicate(error) {
  return Boolean(error) && (error.code === "23505" || error.status === 409);
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  const country = String((business.negocio && business.negocio.codigoPais) || "").replace(/\D/g, "");
  if (digits.length === 8 && country) digits = country + digits;
  return digits;
}

function buildOrder(body) {
  if (!body || typeof body !== "object") return { error: "Datos inválidos." };

  const nombre = String(body.nombre || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (nombre.length < 2) return { error: "Ingresá el nombre del cliente." };

  const telefono = normalizePhone(body.telefono);
  if (telefono.length < 8 || telefono.length > 15) {
    return { error: "Ingresá un número de WhatsApp válido." };
  }

  const entrega = business.negocio.entrega || {};
  const tipo = entrega.activa === false || body.tipo === "pickup" ? "pickup" : "delivery";
  const direccion = tipo === "delivery" ? String(body.direccion || "").trim().slice(0, 180) : "";
  if (tipo === "delivery" && direccion.length < 5) {
    return { error: "Ingresá una dirección de entrega válida." };
  }

  const pago = String(body.pago || "").trim().slice(0, 40) || "Efectivo";
  const notas = String(body.notas || "").trim().slice(0, 300);

  if (!Array.isArray(body.items) || !body.items.length) {
    return { error: "El pedido no tiene productos." };
  }

  const items = [];
  body.items.slice(0, 40).forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const product = business.productos.find((item) => item.id === raw.id);
    const quantity = Math.floor(Number(raw.cantidad));
    if (!product || product.disponible === false) return;
    if (!Number.isFinite(quantity) || quantity < 1) return;
    const cantidad = Math.min(99, quantity);
    items.push({
      id: product.id,
      nombre: product.nombre,
      precio: product.precio,
      cantidad,
      subtotal: product.precio * cantidad
    });
  });

  if (!items.length) return { error: "Los productos no están disponibles." };

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const minimum = Number(entrega.minimo) || 0;
  if (tipo === "delivery" && minimum > 0 && subtotal < minimum) {
    return { error: "El pedido no alcanza el mínimo para delivery." };
  }

  const envio = tipo === "delivery" ? Number(entrega.costo) || 0 : 0;
  const now = new Date().toISOString();

  return {
    pedido: {
      id: crypto.randomUUID(),
      codigo: normalizeCode(body.codigo),
      creadoEn: now,
      actualizadoEn: now,
      estado: "nuevo",
      tipo,
      cliente: { nombre, telefono, direccion, pago, notas },
      items,
      subtotal,
      envio,
      total: subtotal + envio
    }
  };
}

function storeFailure(res, error, context) {
  console.error(context + ":", error.message, error.details ? JSON.stringify(error.details) : "");
  json(res, 502, { error: "No se pudo acceder a los pedidos. Intentá de nuevo." });
}

async function api(req, res, url) {
  const route = url.pathname;
  const method = req.method;

  if (route === "/api/negocio" && method === "GET") {
    json(res, 200, {
      negocio: {
        nombre: business.negocio.nombre || "Mi negocio",
        eslogan: business.negocio.eslogan || "",
        moneda: business.negocio.moneda || "C$"
      },
      demo: !process.env.PANEL_PASSWORD
    });
    return true;
  }

  if (route === "/api/login" && method === "POST") {
    const ip = clientIp(req);
    if (loginBlocked(ip)) {
      json(res, 429, { error: "Demasiados intentos. Esperá unos minutos." });
      return true;
    }
    const body = await bodyOrNull(req, res);
    if (body === null) return true;
    if (String(body.password || "") !== PASSWORD) {
      registerFailure(ip);
      json(res, 401, { error: "Clave incorrecta." });
      return true;
    }
    attempts.delete(ip);
    json(res, 200, { token: createSession() });
    return true;
  }

  if (route === "/api/pedidos" && method === "POST") {
    const body = await bodyOrNull(req, res);
    if (body === null) return true;
    const result = buildOrder(body);
    if (result.error) {
      json(res, 400, { error: result.error });
      return true;
    }

    let saved = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        saved = await store.insert(result.pedido);
        break;
      } catch (error) {
        if (isDuplicate(error) && attempt < 3) {
          result.pedido.codigo = generateCode();
          continue;
        }
        storeFailure(res, error, "No se pudo guardar el pedido");
        return true;
      }
    }

    console.log(
      "Pedido " + saved.codigo + " · " + saved.cliente.nombre + " · " + saved.total
    );
    json(res, 201, { pedido: saved });
    return true;
  }

  if (route === "/api/pedidos" && method === "GET") {
    if (!authorized(req)) {
      json(res, 401, { error: "Sesión vencida." });
      return true;
    }
    try {
      const list = await store.list(url.searchParams.get("estado") || null);
      json(res, 200, { pedidos: list });
    } catch (error) {
      storeFailure(res, error, "No se pudieron leer los pedidos");
    }
    return true;
  }

  const match = /^\/api\/pedidos\/([A-Za-z0-9-]+)$/.exec(route);
  if (match && method === "PATCH") {
    if (!authorized(req)) {
      json(res, 401, { error: "Sesión vencida." });
      return true;
    }
    const body = await bodyOrNull(req, res);
    if (body === null) return true;
    if (!ESTADOS.includes(body.estado)) {
      json(res, 400, { error: "Estado inválido." });
      return true;
    }

    try {
      const pedido = await store.update(match[1], {
        estado: body.estado,
        actualizadoEn: new Date().toISOString()
      });
      if (!pedido) {
        json(res, 404, { error: "Pedido no encontrado." });
      } else {
        json(res, 200, { pedido });
      }
    } catch (error) {
      storeFailure(res, error, "No se pudo actualizar el pedido");
    }
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  let relative = url.pathname;
  if (relative === "/") relative = "/index.html";
  else if (relative === "/panel" || relative === "/panel/") relative = "/panel.html";

  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch (error) {
    return false;
  }

  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) return false;
  if (decoded.startsWith("/.")) return false;

  const full = path.join(ROOT, decoded);
  if (!full.startsWith(ROOT + path.sep)) return false;

  const relativeToRoot = path.relative(ROOT, full).split(path.sep).join("/");
  if (relativeToRoot.startsWith("server/") || relativeToRoot === "package.json") return false;

  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext]) return false;

  let stat;
  try {
    stat = await fsp.stat(full);
  } catch (error) {
    return false;
  }
  if (!stat.isFile()) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[ext]);
  res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=300");
  res.setHeader("Content-Length", stat.size);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const content = await fsp.readFile(full);
  res.end(content);
  return true;
}

async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");

  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    const handled = await api(req, res, url);
    if (!handled) json(res, 404, { error: "Ruta no encontrada." });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Método no permitido");
    return;
  }

  const served = await serveStatic(req, res, url);
  if (!served) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("No encontrado");
  }
}

async function start() {
  const config = createStore();
  store = config.store;

  try {
    await store.init();
  } catch (error) {
    console.error("No se pudo conectar con el almacenamiento:", error.message);
    if (config.mode === "supabase") {
      console.error("Revisá SUPABASE_URL, SUPABASE_SERVICE_KEY y ejecutá supabase/schema.sql.");
    }
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error("Error inesperado:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Error interno");
      } else {
        res.end();
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log("Catálogo: http://localhost:" + PORT);
    console.log("Panel:    http://localhost:" + PORT + "/panel");
    console.log("Clave del panel: " + (process.env.PANEL_PASSWORD ? "configurada por variable" : "1234 (demo)"));
    console.log(
      "Datos:    " + (config.mode === "supabase"
        ? "Supabase (" + config.detail + ")"
        : "archivo local (" + config.detail + ")")
    );
    Object.values(os.networkInterfaces())
      .flat()
      .filter((info) => info && info.family === "IPv4" && !info.internal)
      .forEach((info) => {
        console.log("Red:      http://" + info.address + ":" + PORT);
      });
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar el servidor:", error);
  process.exit(1);
});
