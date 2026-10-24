const fsp = require("fs/promises");
const path = require("path");

class LocalStore {
  constructor(file) {
    this.file = file;
    this.pedidos = [];
    this.chain = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fsp.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.pedidos = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("No se pudo leer el archivo de pedidos:", error.message);
      }
    }
  }

  async list(estado) {
    return this.pedidos
      .filter((pedido) => !estado || pedido.estado === estado)
      .slice()
      .sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn)));
  }

  async insert(pedido) {
    if (this.pedidos.some((item) => item.codigo === pedido.codigo)) {
      const error = new Error("Código duplicado.");
      error.code = "23505";
      error.status = 409;
      throw error;
    }
    this.pedidos.push(pedido);
    await this.persist();
    return pedido;
  }

  async update(id, changes) {
    const pedido = this.pedidos.find((item) => item.id === id);
    if (!pedido) return null;
    Object.assign(pedido, changes);
    await this.persist();
    return pedido;
  }

  persist() {
    this.chain = this.chain
      .then(async () => {
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = this.file + ".tmp";
        await fsp.writeFile(tmp, JSON.stringify(this.pedidos, null, 2), "utf8");
        await fsp.rename(tmp, this.file);
      })
      .catch((error) => {
        console.error("No se pudieron guardar los pedidos:", error.message);
      });
    return this.chain;
  }
}

module.exports = { LocalStore };
