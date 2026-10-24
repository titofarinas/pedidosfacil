const path = require("path");
const { LocalStore } = require("./store-local");
const { SupabaseStore } = require("./store-supabase");

function createStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (url && key) {
    let detail = url;
    try {
      detail = new URL(url).host;
    } catch (error) {
      detail = "URL inválida";
    }
    return {
      store: new SupabaseStore(url, key, process.env.SUPABASE_TABLE),
      mode: "supabase",
      detail
    };
  }

  const file = process.env.PEDIDOS_DATA
    ? path.resolve(process.env.PEDIDOS_DATA)
    : path.join(__dirname, "data", "pedidos.json");

  return {
    store: new LocalStore(file),
    mode: "local",
    detail: file
  };
}

module.exports = { createStore };
