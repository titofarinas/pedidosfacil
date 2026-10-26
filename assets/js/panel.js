(function () {
  "use strict";

  var TOKEN_KEY = "pedidos.panel.token";
  var POLL_MS = 12000;

  var ESTADOS = {
    nuevo: "Nuevo",
    preparando: "Preparando",
    listo: "Listo",
    entregado: "Entregado",
    cancelado: "Cancelado"
  };

  var FILTERS = [
    { id: "todos", label: "Todos" },
    { id: "nuevo", label: "Nuevos" },
    { id: "preparando", label: "Preparando" },
    { id: "listo", label: "Listos" },
    { id: "entregado", label: "Entregados" },
    { id: "cancelado", label: "Cancelados" }
  ];

  var NEXT = {
    nuevo: [
      { estado: "preparando", label: "Preparando", primary: true },
      { estado: "cancelado", label: "Cancelar", primary: false }
    ],
    preparando: [
      { estado: "listo", label: "Listo", primary: true },
      { estado: "cancelado", label: "Cancelar", primary: false }
    ],
    listo: [
      { estado: "entregado", label: "Entregado", primary: true },
      { estado: "cancelado", label: "Cancelar", primary: false }
    ],
    entregado: [],
    cancelado: [
      { estado: "nuevo", label: "Reabrir", primary: false }
    ]
  };

  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    pedidos: [],
    knownIds: null,
    filter: "todos",
    query: "",
    loading: false,
    timer: null,
    negocio: { nombre: "Mi negocio", moneda: "C$" },
    demo: false,
    toastTimer: null
  };

  var el = {};

  function $(selector) {
    return document.querySelector(selector);
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function money(value) {
    var number = Number(value) || 0;
    return (state.negocio.moneda || "C$") + number.toLocaleString("es-NI");
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function initials(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var now = new Date();
    var time = date.toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return time;
    return date.toLocaleDateString("es-NI", { day: "2-digit", month: "short" }) + " " + time;
  }

  function isToday(iso) {
    var date = new Date(iso);
    return !isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
  }

  function phoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatPhone(digits) {
    if (digits.length === 11 && digits.indexOf("505") === 0) {
      return "+505 " + digits.slice(3, 7) + " " + digits.slice(7);
    }
    return "+" + digits;
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
  }

  function statusMessage(pedido, estado) {
    var nombre = firstName(pedido.cliente && pedido.cliente.nombre);
    var saludo = nombre ? "Hola " + nombre + ", " : "Hola, ";
    var negocio = state.negocio.nombre || "el negocio";
    var mensaje;

    if (estado === "preparando") {
      mensaje = "tu pedido " + pedido.codigo + " ya está en preparación. Te avisamos cuando esté listo.";
    } else if (estado === "listo") {
      mensaje = pedido.tipo === "delivery"
        ? "tu pedido " + pedido.codigo + " ya está listo y salimos a entregarlo."
        : "tu pedido " + pedido.codigo + " ya está listo para retirar en el local.";
    } else if (estado === "entregado") {
      mensaje = "tu pedido " + pedido.codigo + " fue entregado. ¡Gracias por tu compra!";
    } else if (estado === "cancelado") {
      mensaje = "tu pedido " + pedido.codigo + " fue cancelado. Si tenés alguna duda, escribinos.";
    } else if (estado === "nuevo") {
      mensaje = "reactivamos tu pedido " + pedido.codigo + ". Seguimos coordinando por acá.";
    } else {
      mensaje = "tu pedido " + pedido.codigo + " cambió a " + (ESTADOS[estado] || estado) + ".";
    }

    return saludo + mensaje + "\n\n" + negocio;
  }

  function notifyHref(pedido, estado) {
    var phone = phoneDigits(pedido.cliente && pedido.cliente.telefono);
    if (!phone) return "";
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(statusMessage(pedido, estado));
  }

  function api(pathname, options) {
    options = options || {};
    var headers = options.headers || {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    if (options.body) headers["Content-Type"] = "application/json";

    return fetch(pathname, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(
      function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) {
              if (response.status === 401) logout(true);
              var error = new Error(data.error || "Error del servidor.");
              error.status = response.status;
              throw error;
            }
            return data;
          });
      },
      function () {
        throw new Error("No se pudo conectar con el servidor.");
      }
    );
  }

  function showToast(message, isError, action) {
    el.toast.textContent = message;
    var hasAction = Boolean(action && action.href);
    if (hasAction) {
      var link = node("a", "toast-action", action.label || "Avisar");
      link.href = action.href;
      link.target = "_blank";
      link.rel = "noopener";
      el.toast.appendChild(link);
    }
    el.toast.classList.toggle("is-error", Boolean(isError));
    el.toast.classList.toggle("has-action", hasAction);
    el.toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      el.toast.classList.remove("is-visible");
    }, hasAction ? 8000 : 3200);
  }

  function showLoginError(message) {
    el.loginError.textContent = message;
    el.loginError.hidden = false;
  }

  function showLogin() {
    el.app.hidden = true;
    el.loginScreen.hidden = false;
    el.password.focus();
  }

  function showApp() {
    el.loginScreen.hidden = true;
    el.app.hidden = false;
  }

  function logout(silent) {
    state.token = "";
    state.pedidos = [];
    state.knownIds = null;
    state.loading = false;
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.clearTimeout(state.timer);
    showLogin();
    el.loginError.hidden = true;
    if (silent) {
      showLoginError("La sesión venció. Ingresá de nuevo.");
    } else {
      showToast("Sesión cerrada");
    }
  }

  function loadNegocio() {
    return fetch("/api/negocio")
      .then(function (response) {
        if (!response.ok) throw new Error("No se pudo cargar el negocio.");
        return response.json();
      })
      .then(function (data) {
        state.negocio = data.negocio || state.negocio;
        state.demo = Boolean(data.demo);
        var mark = initials(state.negocio.nombre);
        el.loginMark.textContent = mark;
        el.panelMark.textContent = mark;
        el.panelBizName.textContent = state.negocio.nombre;
        el.loginBiz.textContent = "Ingresá con la clave de " + state.negocio.nombre + ".";
        if (data.trial && data.trialDaysLeft > 0) {
          el.loginHint.textContent = "Demo: " + data.trialDaysLeft + " día" + (data.trialDaysLeft === 1 ? "" : "s") + " restante" + (data.trialDaysLeft === 1 ? "" : "s");
          el.loginHint.hidden = false;
        } else if (state.demo) {
          el.loginHint.textContent = "Clave de demostración: 1234";
          el.loginHint.hidden = false;
        }
        if (state.negocio.colores) applyTheme();
      })
      .catch(function () {
        showLoginError("El panel necesita el servidor. Ejecutá npm start y abrí esta página desde esa dirección.");
      });
  }

  function schedule() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(function () {
      refresh();
    }, POLL_MS);
  }

  function refresh() {
    if (state.loading || !state.token) return;
    state.loading = true;
    el.refreshBtn.classList.add("is-spinning");

    api("/api/pedidos")
      .then(function (data) {
        var nuevos = [];
        var list = Array.isArray(data.pedidos) ? data.pedidos : [];

        if (state.knownIds) {
          list.forEach(function (pedido) {
            if (!state.knownIds[pedido.id]) nuevos.push(pedido);
          });
        }

        state.pedidos = list;
        state.knownIds = {};
        list.forEach(function (pedido) {
          state.knownIds[pedido.id] = true;
        });

        render();
        el.updatedAt.textContent = "Actualizado " + new Date().toLocaleTimeString("es-NI");

        if (nuevos.length === 1) {
          showToast("Nuevo pedido " + nuevos[0].codigo + " de " + nuevos[0].cliente.nombre);
        } else if (nuevos.length > 1) {
          showToast(nuevos.length + " pedidos nuevos");
        }
      })
      .catch(function (error) {
        if (error.status !== 401) showToast(error.message, true);
      })
      .finally(function () {
        state.loading = false;
        el.refreshBtn.classList.remove("is-spinning");
        schedule();
      });
  }

  function visibleOrders() {
    var query = normalize(state.query);
    return state.pedidos.filter(function (pedido) {
      if (state.filter !== "todos" && pedido.estado !== state.filter) return false;
      if (!query) return true;
      var haystack = [
        pedido.codigo,
        pedido.cliente && pedido.cliente.nombre,
        pedido.cliente && pedido.cliente.direccion,
        pedido.cliente && pedido.cliente.pago,
        pedido.cliente && pedido.cliente.notas
      ].concat((pedido.items || []).map(function (item) {
        return item.nombre;
      }));
      return normalize(haystack.join(" ")).indexOf(query) !== -1;
    });
  }

  function renderStats() {
    var today = state.pedidos.filter(function (pedido) {
      return isToday(pedido.creadoEn);
    });
    var counts = { nuevo: 0, preparando: 0, listo: 0, entregado: 0, cancelado: 0 };
    var sales = 0;

    today.forEach(function (pedido) {
      if (counts[pedido.estado] != null) counts[pedido.estado] += 1;
      if (pedido.estado !== "cancelado") sales += Number(pedido.total) || 0;
    });

    el.statPedidos.textContent = today.length;
    el.statNuevos.textContent = counts.nuevo;
    el.statPreparando.textContent = counts.preparando;
    el.statListos.textContent = counts.listo;
    el.statVentas.textContent = money(sales);
  }

  function renderTabs() {
    var counts = { todos: state.pedidos.length };
    state.pedidos.forEach(function (pedido) {
      counts[pedido.estado] = (counts[pedido.estado] || 0) + 1;
    });

    var fragment = document.createDocumentFragment();
    FILTERS.forEach(function (filter) {
      var button = node("button", "tab" + (state.filter === filter.id ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("data-filter", filter.id);
      button.setAttribute("aria-selected", state.filter === filter.id ? "true" : "false");
      button.appendChild(document.createTextNode(filter.label));
      button.appendChild(node("span", "tab-count", String(counts[filter.id] || 0)));
      fragment.appendChild(button);
    });

    el.tabs.innerHTML = "";
    el.tabs.appendChild(fragment);
  }

  function orderCard(pedido) {
    var card = node("article", "order");
    card.setAttribute("data-estado", pedido.estado);
    card.setAttribute("data-id", pedido.id);

    var head = node("div", "order-head");
    var id = node("div", "order-id");
    id.appendChild(node("span", "order-code", pedido.codigo));
    id.appendChild(node("span", "order-time", formatDate(pedido.creadoEn)));
    head.appendChild(id);
    head.appendChild(node("span", "status status-" + pedido.estado, ESTADOS[pedido.estado] || pedido.estado));
    card.appendChild(head);

    var customer = node("div", "order-customer");
    customer.appendChild(node("strong", "", (pedido.cliente && pedido.cliente.nombre) || "Cliente"));
    var pills = node("div", "order-pills");
    pills.appendChild(node("span", "pill" + (pedido.tipo === "delivery" ? " pill-delivery" : ""),
      pedido.tipo === "delivery" ? "Delivery" : "Retiro"));
    if (pedido.cliente && pedido.cliente.pago) {
      pills.appendChild(node("span", "pill", pedido.cliente.pago));
    }
    customer.appendChild(pills);
    card.appendChild(customer);

    var phone = phoneDigits(pedido.cliente && pedido.cliente.telefono);
    if (phone) {
      var phoneLink = node("a", "order-phone", "Avisar por WhatsApp: " + formatPhone(phone));
      phoneLink.href = notifyHref(pedido, pedido.estado);
      phoneLink.target = "_blank";
      phoneLink.rel = "noopener";
      card.appendChild(phoneLink);
    }

    if (pedido.tipo === "delivery" && pedido.cliente && pedido.cliente.direccion) {
      card.appendChild(node("p", "order-address", pedido.cliente.direccion));
    }

    var items = node("ul", "order-items");
    (pedido.items || []).forEach(function (item) {
      var line = node("li");
      line.appendChild(node("span", "", item.cantidad + "x " + item.nombre));
      line.appendChild(node("strong", "", money(item.subtotal)));
      items.appendChild(line);
    });
    card.appendChild(items);

    if (pedido.cliente && pedido.cliente.notas) {
      var notes = node("p", "order-notes");
      notes.appendChild(node("span", "notes-label", "Notas: "));
      notes.appendChild(document.createTextNode(pedido.cliente.notas));
      card.appendChild(notes);
    }

    var totals = node("div", "order-totals");
    var shipping = pedido.tipo === "delivery"
      ? (Number(pedido.envio) > 0 ? money(pedido.envio) : "Gratis")
      : "—";
    totals.appendChild(node("span", "", "Envío: " + shipping));
    var total = node("div", "order-total");
    total.appendChild(node("span", "", "Total"));
    total.appendChild(node("strong", "", money(pedido.total)));
    totals.appendChild(total);
    card.appendChild(totals);

    var actions = node("div", "order-actions");
    var transitions = NEXT[pedido.estado] || [];
    transitions.forEach(function (transition) {
      var button = node("button", "order-action " + (transition.primary ? "is-primary" : "is-ghost"), transition.label);
      button.type = "button";
      button.addEventListener("click", function () {
        changeStatus(pedido, transition.estado, button);
      });
      actions.appendChild(button);
    });

    var notify = notifyHref(pedido, pedido.estado);
    if (notify) {
      var notifyLink = node("a", "order-action is-notify", "Avisar");
      notifyLink.href = notify;
      notifyLink.target = "_blank";
      notifyLink.rel = "noopener";
      notifyLink.title = "Enviar aviso por WhatsApp";
      actions.appendChild(notifyLink);
    }

    if (!transitions.length) {
      actions.appendChild(node("span", "order-done",
        pedido.estado === "cancelado" ? "Pedido cancelado" : "Pedido entregado"));
    }
    card.appendChild(actions);

    return card;
  }

  function renderOrders() {
    var list = visibleOrders();
    var fragment = document.createDocumentFragment();
    list.forEach(function (pedido) {
      fragment.appendChild(orderCard(pedido));
    });
    el.orders.innerHTML = "";
    el.orders.appendChild(fragment);
    el.ordersEmpty.hidden = list.length > 0;
  }

  function render() {
    renderStats();
    renderTabs();
    renderOrders();
  }

  function changeStatus(pedido, estado, button) {
    var previous = button.textContent;
    button.disabled = true;
    button.textContent = "Guardando...";

    api("/api/pedidos/" + encodeURIComponent(pedido.id), {
      method: "PATCH",
      body: { estado: estado }
    })
      .then(function (data) {
        var updated = data.pedido;
        state.pedidos = state.pedidos.map(function (item) {
          return item.id === updated.id ? updated : item;
        });
        render();
        var aviso = notifyHref(updated, estado);
        showToast("Pedido " + updated.codigo + " → " + (ESTADOS[estado] || estado), false,
          aviso ? { href: aviso, label: "Avisar" } : null);
      })
      .catch(function (error) {
        if (error.status !== 401) {
          button.disabled = false;
          button.textContent = previous;
          showToast(error.message, true);
        }
      });
  }

  function login(event) {
    event.preventDefault();
    var password = el.password.value;
    if (!password) {
      showLoginError("Ingresá la clave del negocio.");
      return;
    }

    el.loginError.hidden = true;
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = "Ingresando...";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    })
      .then(
        function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              if (!response.ok) throw new Error(data.error || "No se pudo ingresar.");
              return data;
            });
        },
        function () {
          throw new Error("No se pudo conectar con el servidor.");
        }
      )
      .then(function (data) {
        state.token = data.token;
        window.sessionStorage.setItem(TOKEN_KEY, data.token);
        el.password.value = "";
        el.loginError.hidden = true;
        showApp();
        state.knownIds = null;
        refresh();
      })
      .catch(function (error) {
        showLoginError(error.message);
      })
      .finally(function () {
        el.loginBtn.disabled = false;
        el.loginBtn.textContent = "Ingresar";
      });
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", login);
    el.logoutBtn.addEventListener("click", function () {
      logout(false);
    });
    el.refreshBtn.addEventListener("click", refresh);
    if (el.printBtn) {
      el.printBtn.addEventListener("click", function () { window.print(); });
    }

    el.search.addEventListener("input", function (event) {
      state.query = event.target.value;
      renderOrders();
    });

    el.tabs.addEventListener("click", function (event) {
      var tab = event.target.closest("[data-filter]");
      if (!tab) return;
      state.filter = tab.getAttribute("data-filter");
      render();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && state.token && !el.app.hidden) refresh();
    });
  }

  function applyTheme() {
    var colors = (state.negocio && state.negocio.colores) || {};
    var root = document.documentElement;
    var map = {
      bg: "--bg",
      surface: "--surface",
      surface2: "--surface-2",
      ink: "--ink",
      muted: "--muted",
      line: "--line",
      brand: "--brand",
      brandDark: "--brand-dark",
      brandSoft: "--brand-soft",
      green: "--green",
      greenDark: "--green-dark",
      greenSoft: "--green-soft",
      amber: "--amber",
      amberSoft: "--amber-soft",
      blue: "--blue",
      blueSoft: "--blue-soft",
      shadow: "--shadow",
      shadowLg: "--shadow-lg"
    };
    Object.keys(map).forEach(function (key) {
      if (colors[key]) root.style.setProperty(map[key], colors[key]);
    });
  }

  function init() {
    el.loginScreen = $("#loginScreen");
    el.loginForm = $("#loginForm");
    el.loginMark = $("#loginMark");
    el.loginBiz = $("#loginBiz");
    el.loginHint = $("#loginHint");
    el.loginError = $("#loginError");
    el.loginBtn = $("#loginBtn");
    el.password = $("#password");

    el.app = $("#app");
    el.panelMark = $("#panelMark");
    el.panelBizName = $("#panelBizName");
    el.headerDate = $("#headerDate");
    el.updatedAt = $("#updatedAt");
    el.refreshBtn = $("#refreshBtn");
    el.printBtn = $("#printBtn");
    el.logoutBtn = $("#logoutBtn");
    el.statPedidos = $("#statPedidos");
    el.statNuevos = $("#statNuevos");
    el.statPreparando = $("#statPreparando");
    el.statListos = $("#statListos");
    el.statVentas = $("#statVentas");
    el.tabs = $("#tabs");
    el.search = $("#search");
    el.orders = $("#orders");
    el.ordersEmpty = $("#ordersEmpty");
    el.toast = $("#toast");

    el.headerDate.textContent = new Date().toLocaleDateString("es-NI", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

    bindEvents();
    loadNegocio().finally(function () {
      if (state.token) {
        showApp();
        refresh();
      } else {
        showLogin();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
