function mapRow(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
    estado: row.estado,
    tipo: row.tipo,
    cliente: {
      nombre: row.cliente_nombre,
      direccion: row.cliente_direccion || "",
      pago: row.cliente_pago || "",
      notas: row.cliente_notas || ""
    },
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: row.subtotal,
    envio: row.envio,
    total: row.total
  };
}

function mapOrder(order) {
  return {
    codigo: order.codigo,
    estado: order.estado,
    tipo: order.tipo,
    cliente_nombre: order.cliente.nombre,
    cliente_direccion: order.cliente.direccion || null,
    cliente_pago: order.cliente.pago || null,
    cliente_notas: order.cliente.notas || null,
    items: order.items,
    subtotal: order.subtotal,
    envio: order.envio,
    total: order.total
  };
}

class SupabaseStore {
  constructor(url, key, table) {
    this.url = String(url || "").replace(/\/+$/, "");
    this.key = String(key || "");
    this.table = String(table || "pedidos").replace(/[^A-Za-z0-9_]/g, "") || "pedidos";
  }

  async request(query, options) {
    options = options || {};
    const headers = {
      apikey: this.key,
      Authorization: "Bearer " + this.key,
      "Content-Type": "application/json"
    };
    if (options.prefer) headers.Prefer = options.prefer;

    const response = await fetch(this.url + "/rest/v1/" + this.table + "?" + query, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = text;
    }

    if (!response.ok) {
      const error = new Error((data && data.message) || "Error de Supabase.");
      error.status = response.status;
      error.code = data && data.code;
      error.details = data;
      throw error;
    }

    return data;
  }

  async init() {
    await this.request("select=id&limit=1");
  }

  async list(estado) {
    let query = "select=*&order=creado_en.desc";
    if (estado) query += "&estado=eq." + encodeURIComponent(estado);
    const rows = await this.request(query);
    return (rows || []).map(mapRow);
  }

  async insert(order) {
    const rows = await this.request("select=*", {
      method: "POST",
      body: mapOrder(order),
      prefer: "return=representation"
    });
    if (!rows || !rows.length) throw new Error("Supabase no devolvió el pedido guardado.");
    return mapRow(rows[0]);
  }

  async update(id, changes) {
    const patch = {};
    if (changes.estado) patch.estado = changes.estado;
    if (changes.actualizadoEn) patch.actualizado_en = changes.actualizadoEn;

    const rows = await this.request("id=eq." + encodeURIComponent(id) + "&select=*", {
      method: "PATCH",
      body: patch,
      prefer: "return=representation"
    });
    return rows && rows.length ? mapRow(rows[0]) : null;
  }
}

module.exports = { SupabaseStore };
