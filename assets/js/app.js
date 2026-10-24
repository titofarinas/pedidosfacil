(function () {
  "use strict";

  var NEGOCIO = window.NEGOCIO || {};
  var PRODUCTOS = Array.isArray(window.PRODUCTOS) ? window.PRODUCTOS : [];
  var CATEGORIAS = Array.isArray(window.CATEGORIAS) ? window.CATEGORIAS : [];
  var STORAGE_KEY = "pedidos.carrito.v1";

  var TINTS = {
    almuerzos: ["#f7b267", "#e0491f"],
    fritos: ["#f2c14e", "#c97b1a"],
    bebidas: ["#7cc6b0", "#1f8a70"],
    postres: ["#e8a0c8", "#b04a7a"]
  };

  var state = {
    cart: [],
    filter: "todos",
    query: "",
    open: false
  };

  var el = {};
  var toastTimer = null;
  var lastFocus = null;

  function $(selector) {
    return document.querySelector(selector);
  }

  function money(value) {
    var number = Number(value) || 0;
    return (NEGOCIO.moneda || "$") + number.toLocaleString("es-NI");
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function initials(name) {
    var words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function tintStyle(category) {
    var tint = TINTS[category] || TINTS.almuerzos;
    return "--tint-a:" + tint[0] + ";--tint-b:" + tint[1];
  }

  function categoryName(id) {
    var found = CATEGORIAS.filter(function (cat) {
      return cat.id === id;
    })[0];
    return found ? found.nombre : id;
  }

  function productById(id) {
    return PRODUCTOS.filter(function (product) {
      return product.id === id;
    })[0];
  }

  function cartSubtotal() {
    return state.cart.reduce(function (total, item) {
      var product = productById(item.id);
      return product ? total + product.precio * item.cantidad : total;
    }, 0);
  }

  function cartQuantity() {
    return state.cart.reduce(function (total, item) {
      return total + item.cantidad;
    }, 0);
  }

  function loadCart() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (item) {
          return item && typeof item.id === "string" && Number(item.cantidad) > 0;
        })
        .map(function (item) {
          return { id: item.id, cantidad: Math.min(99, Math.floor(Number(item.cantidad))) };
        });
    } catch (error) {
      return [];
    }
  }

  function saveCart() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch (error) {
      return;
    }
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value == null ? "" : value;
  }

  function whatsappDigits() {
    return String(NEGOCIO.whatsapp || "").replace(/\D/g, "");
  }

  function whatsappUrl(message) {
    return "https://wa.me/" + whatsappDigits() + "?text=" + encodeURIComponent(message);
  }

  function setupBusiness() {
    var name = NEGOCIO.nombre || "Mi negocio";
    var delivery = NEGOCIO.entrega || {};
    var active = delivery.activa !== false;

    document.title = name + " · Pedidos por WhatsApp";

    setText("brandMark", initials(name));
    setText("ticketBrand", initials(name));
    setText("bizName", name);
    setText("bizTagline", NEGOCIO.eslogan || "");
    setText("heroTitle", NEGOCIO.eslogan || name);
    setText("heroText", NEGOCIO.descripcion || "");
    setText("badgeHorario", NEGOCIO.horario || "");
    setText("badgeEntrega", active ? "Delivery disponible" : "Retiro en local");
    setText("infoHorario", NEGOCIO.horario || "");
    setText(
      "infoEntrega",
      active
        ? "Delivery " + money(delivery.costo) + " (mínimo " + money(delivery.minimo) + ") en " + (delivery.zonas || "la zona") + ". Retiro en local sin costo."
        : "Retiro en local sin costo."
    );
    setText("infoPagos", (NEGOCIO.pagos || []).join(" · ") || "Consultar por WhatsApp");
    setText("footerName", name);
    setText("footerAddress", NEGOCIO.direccion || "");
    setText("footerNote", NEGOCIO.notas || "");

    var headerLink = $("#headerWhatsapp");
    if (whatsappDigits()) {
      headerLink.href = whatsappUrl("Hola " + name + ", quiero hacer un pedido.");
    } else {
      headerLink.hidden = true;
    }

    var paymentSelect = $("#cPago");
    var payments = NEGOCIO.pagos && NEGOCIO.pagos.length ? NEGOCIO.pagos : ["Efectivo"];
    paymentSelect.innerHTML = payments
      .map(function (payment) {
        return '<option value="' + esc(payment) + '">' + esc(payment) + "</option>";
      })
      .join("");

    if (!active) {
      var deliveryInput = $('input[name="tipo"][value="delivery"]');
      var pickupInput = $('input[name="tipo"][value="pickup"]');
      var segmented = $(".segmented");
      if (deliveryInput) {
        deliveryInput.disabled = true;
        deliveryInput.checked = false;
      }
      if (pickupInput) pickupInput.checked = true;
      if (segmented) segmented.hidden = true;
    }
  }

  function renderChips() {
    el.chips.innerHTML = CATEGORIAS.map(function (cat) {
      var active = state.filter === cat.id;
      return (
        '<button class="chip' + (active ? " is-active" : "") + '" type="button" data-filter="' +
        esc(cat.id) + '" aria-pressed="' + (active ? "true" : "false") + '">' +
        esc(cat.nombre) + "</button>"
      );
    }).join("");
  }

  function filteredProducts() {
    var query = normalize(state.query);
    return PRODUCTOS.filter(function (product) {
      var inCategory = state.filter === "todos" || product.categoria === state.filter;
      if (!inCategory) return false;
      if (!query) return true;
      return normalize(product.nombre + " " + (product.descripcion || "")).indexOf(query) !== -1;
    });
  }

  function productCard(product) {
    var out = product.disponible === false;
    var image = product.imagen
      ? '<img src="' + esc(product.imagen) + '" alt="' + esc(product.nombre) + '" loading="lazy">'
      : '<span class="art-initials">' + esc(initials(product.nombre)) + "</span>";
    var tag = product.etiqueta && !out
      ? '<span class="product-tag">' + esc(product.etiqueta) + "</span>"
      : "";
    var outTag = out ? '<span class="product-out">Agotado</span>' : "";

    return (
      '<article class="product' + (out ? " is-out" : "") + '">' +
        '<div class="product-art" style="' + tintStyle(product.categoria) + '">' +
          image + tag + outTag +
        "</div>" +
        '<div class="product-info">' +
          '<div class="product-title">' +
            "<h3>" + esc(product.nombre) + "</h3>" +
            '<span class="price">' + money(product.precio) + "</span>" +
          "</div>" +
          '<p class="product-desc">' + esc(product.descripcion || "") + "</p>" +
          '<div class="product-foot">' +
            '<span class="product-cat">' + esc(categoryName(product.categoria)) + "</span>" +
            '<button class="add" type="button" data-add="' + esc(product.id) + '"' +
              (out ? " disabled" : "") + ">" + (out ? "Agotado" : "Agregar") + "</button>" +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function renderProducts() {
    var products = filteredProducts();
    el.grid.innerHTML = products.map(productCard).join("");
    el.empty.hidden = products.length > 0;
  }

  function renderCart() {
    var quantity = cartQuantity();
    el.cartCount.textContent = quantity;
    el.cartCount.hidden = quantity === 0;

    var items = state.cart.filter(function (item) {
      return Boolean(productById(item.id));
    });

    if (!items.length) {
      el.cartItems.innerHTML = "";
      el.cartEmpty.hidden = false;
      el.checkout.hidden = true;
    } else {
      el.cartEmpty.hidden = true;
      el.checkout.hidden = false;
      el.cartItems.innerHTML = items.map(function (item) {
        var product = productById(item.id);
        return (
          '<div class="cart-item">' +
            '<span class="ci-art" style="' + tintStyle(product.categoria) + '">' +
              esc(initials(product.nombre)) +
            "</span>" +
            '<div class="ci-main">' +
              '<div class="ci-top">' +
                "<strong>" + esc(product.nombre) + "</strong>" +
                '<span class="ci-price">' + money(product.precio * item.cantidad) + "</span>" +
              "</div>" +
              '<div class="ci-bottom">' +
                '<div class="stepper">' +
                  '<button type="button" data-dec="' + esc(item.id) + '" aria-label="Quitar una unidad">-</button>' +
                  "<span>" + item.cantidad + "</span>" +
                  '<button type="button" data-inc="' + esc(item.id) + '" aria-label="Agregar una unidad">+</button>' +
                "</div>" +
                '<button class="ci-remove" type="button" data-remove="' + esc(item.id) + '">Quitar</button>' +
              "</div>" +
            "</div>" +
          "</div>"
        );
      }).join("");
    }

    el.cartSubtitle.textContent = quantity
      ? quantity + (quantity === 1 ? " producto en tu pedido" : " productos en tu pedido")
      : "Revisá los productos antes de enviar.";

    updateTotals();
  }

  function getDeliveryType() {
    var checked = $('input[name="tipo"]:checked');
    return checked ? checked.value : "pickup";
  }

  function computeTotals() {
    var delivery = NEGOCIO.entrega || {};
    var type = getDeliveryType();
    var subtotal = cartSubtotal();
    var minimum = Number(delivery.minimo) || 0;
    var cost = Number(delivery.costo) || 0;
    var missing = type === "delivery" && minimum > 0 && subtotal > 0 && subtotal < minimum
      ? minimum - subtotal
      : 0;
    var shipping = type === "delivery" && subtotal > 0 && !missing ? cost : 0;

    return {
      type: type,
      subtotal: subtotal,
      shipping: shipping,
      missing: missing,
      total: subtotal + shipping
    };
  }

  function updateTotals() {
    var totals = computeTotals();
    var deliveryActive = (NEGOCIO.entrega || {}).activa !== false;

    el.tSubtotal.textContent = money(totals.subtotal);
    el.tEnvio.textContent = totals.type === "delivery"
      ? (totals.subtotal === 0 ? "—" : (totals.shipping ? money(totals.shipping) : "Gratis"))
      : "—";
    el.tTotal.textContent = money(totals.total);

    if (totals.missing > 0) {
      el.minNote.hidden = false;
      el.minNote.textContent = "Te faltan " + money(totals.missing) + " para el mínimo de delivery (" +
        money((NEGOCIO.entrega || {}).minimo) + "). También podés elegir retiro en local.";
    } else if (totals.type === "delivery" && totals.subtotal > 0 && deliveryActive) {
      el.minNote.hidden = false;
      el.minNote.textContent = "Envío en " + ((NEGOCIO.entrega || {}).zonas || "la zona") + ".";
    } else {
      el.minNote.hidden = true;
      el.minNote.textContent = "";
    }

    el.sendOrder.disabled = !state.cart.length || totals.missing > 0;

    var addressField = $("#addressField");
    if (addressField) {
      addressField.hidden = totals.type !== "delivery";
      if (addressField.hidden) clearFieldError("cDireccion");
    }
  }

  function addToCart(id) {
    var product = productById(id);
    if (!product || product.disponible === false) return;

    var item = state.cart.filter(function (entry) {
      return entry.id === id;
    })[0];

    if (item) {
      item.cantidad = Math.min(99, item.cantidad + 1);
    } else {
      state.cart.push({ id: id, cantidad: 1 });
    }

    saveCart();
    renderCart();
    bumpFab();
    showToast(product.nombre + " agregado al pedido");
  }

  function changeQuantity(id, delta) {
    var item = state.cart.filter(function (entry) {
      return entry.id === id;
    })[0];
    if (!item) return;

    item.cantidad += delta;
    if (item.cantidad <= 0) {
      removeFromCart(id);
      return;
    }
    if (item.cantidad > 99) item.cantidad = 99;

    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter(function (item) {
      return item.id !== id;
    });
    saveCart();
    renderCart();
  }

  function bumpFab() {
    el.cartFab.classList.remove("bump");
    void el.cartFab.offsetWidth;
    el.cartFab.classList.add("bump");
  }

  function showToast(message, isError) {
    el.toast.textContent = message;
    el.toast.classList.toggle("is-error", Boolean(isError));
    el.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.toast.classList.remove("is-visible");
    }, 3200);
  }

  function setFieldError(inputId, errorId, show) {
    var input = document.getElementById(inputId);
    var error = document.getElementById(errorId);
    if (!input || !error) return;
    var field = input.closest(".field");
    if (field) field.classList.toggle("has-error", show);
    error.hidden = !show;
  }

  function clearFieldError(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var field = input.closest(".field");
    if (field) field.classList.remove("has-error");
    var error = field ? field.querySelector(".field-error") : null;
    if (error) error.hidden = true;
  }

  function openCart() {
    state.open = true;
    lastFocus = document.activeElement;
    renderCart();
    el.overlay.hidden = false;
    el.cart.classList.add("is-open");
    el.cart.inert = false;
    el.cart.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll", "cart-open");
    window.setTimeout(function () {
      el.cartClose.focus();
    }, 120);
  }

  function closeCart() {
    state.open = false;
    el.cart.classList.remove("is-open");
    el.cart.inert = true;
    el.cart.setAttribute("aria-hidden", "true");
    el.overlay.hidden = true;
    document.body.classList.remove("no-scroll", "cart-open");
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
  }

  function orderCode() {
    return "P-" + Date.now().toString(36).slice(-4).toUpperCase();
  }

  function buildMessage(data) {
    var totals = computeTotals();
    var lines = [];

    lines.push("*NUEVO PEDIDO* " + data.codigo);
    lines.push(NEGOCIO.nombre || "Mi negocio");
    lines.push("");
    lines.push("*Cliente:* " + data.nombre);
    lines.push("*Entrega:* " + (totals.type === "delivery" ? "Delivery" : "Retiro en local"));
    if (totals.type === "delivery") lines.push("*Dirección:* " + data.direccion);
    if (data.pago) lines.push("*Pago:* " + data.pago);
    if (data.notas) lines.push("*Notas:* " + data.notas);
    lines.push("");
    lines.push("*Detalle*");

    state.cart.forEach(function (item) {
      var product = productById(item.id);
      if (!product) return;
      lines.push("- " + item.cantidad + "x " + product.nombre + " - " + money(product.precio * item.cantidad));
    });

    lines.push("");
    lines.push("Subtotal: " + money(totals.subtotal));
    if (totals.type === "delivery") {
      lines.push("Envío: " + (totals.shipping ? money(totals.shipping) : "Gratis"));
    }
    lines.push("*TOTAL: " + money(totals.total) + "*");
    lines.push("");
    lines.push("Pedido generado desde el catálogo web.");

    return lines.join("\n");
  }

  function saveToPanel(pedido) {
    if (!window.fetch || !/^https?:$/.test(window.location.protocol)) return;
    try {
      fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
        keepalive: true
      }).catch(function () {
        return;
      });
    } catch (error) {
      return;
    }
  }

  function submitOrder(event) {
    event.preventDefault();

    if (!state.cart.length) {
      showToast("Agregá productos antes de enviar el pedido.", true);
      return;
    }

    var nombreInput = $("#cNombre");
    var direccionInput = $("#cDireccion");
    var nombre = nombreInput.value.trim();
    var direccion = direccionInput.value.trim();
    var totals = computeTotals();
    var valid = true;

    if (nombre.length < 2) {
      setFieldError("cNombre", "errNombre", true);
      valid = false;
    } else {
      setFieldError("cNombre", "errNombre", false);
    }

    if (totals.type === "delivery" && direccion.length < 5) {
      setFieldError("cDireccion", "errDireccion", true);
      valid = false;
    } else {
      setFieldError("cDireccion", "errDireccion", false);
    }

    if (totals.missing > 0) {
      showToast("Te faltan " + money(totals.missing) + " para el mínimo de delivery.", true);
      return;
    }

    if (!valid) {
      showToast("Revisá los datos marcados en el formulario.", true);
      return;
    }

    if (!whatsappDigits()) {
      showToast("Configurá el número de WhatsApp del negocio.", true);
      return;
    }

    var codigo = orderCode();
    var pago = $("#cPago").value;
    var notas = $("#cNotas").value.trim();

    var message = buildMessage({
      codigo: codigo,
      nombre: nombre,
      direccion: direccion,
      pago: pago,
      notas: notas
    });

    saveToPanel({
      codigo: codigo,
      nombre: nombre,
      tipo: totals.type,
      direccion: direccion,
      pago: pago,
      notas: notas,
      items: state.cart.map(function (item) {
        return { id: item.id, cantidad: item.cantidad };
      })
    });

    window.open(whatsappUrl(message), "_blank", "noopener");

    state.cart = [];
    saveCart();
    renderCart();
    closeCart();
    $("#cDireccion").value = "";
    $("#cNotas").value = "";
    showToast("Pedido listo. Enviá el mensaje en WhatsApp.");
  }

  function trapFocus(event) {
    if (!state.open || event.key !== "Tab") return;
    var focusable = el.cart.querySelectorAll("button, input, select, textarea, a[href]");
    var visible = Array.prototype.filter.call(focusable, function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
    if (!visible.length) return;

    var first = visible[0];
    var last = visible[visible.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && state.open) closeCart();
    trapFocus(event);
  }

  function bindEvents() {
    el.grid.addEventListener("click", function (event) {
      var button = event.target.closest("[data-add]");
      if (!button) return;
      addToCart(button.getAttribute("data-add"));
    });

    el.chips.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-filter]");
      if (!chip) return;
      state.filter = chip.getAttribute("data-filter");
      renderChips();
      renderProducts();
    });

    el.search.addEventListener("input", function (event) {
      state.query = event.target.value;
      renderProducts();
    });

    el.cartItems.addEventListener("click", function (event) {
      var inc = event.target.closest("[data-inc]");
      var dec = event.target.closest("[data-dec]");
      var remove = event.target.closest("[data-remove]");

      if (inc) changeQuantity(inc.getAttribute("data-inc"), 1);
      else if (dec) changeQuantity(dec.getAttribute("data-dec"), -1);
      else if (remove) removeFromCart(remove.getAttribute("data-remove"));
    });

    el.cartFab.addEventListener("click", openCart);
    el.cartClose.addEventListener("click", closeCart);
    el.overlay.addEventListener("click", closeCart);
    document.addEventListener("keydown", handleKeydown);

    el.checkout.addEventListener("submit", submitOrder);
    el.sendOrder.addEventListener("click", function (event) {
      if (el.sendOrder.form === el.checkout) return;
      event.preventDefault();
      el.checkout.requestSubmit();
    });

    el.checkout.addEventListener("input", function (event) {
      if (event.target.id === "cNombre") clearFieldError("cNombre");
      if (event.target.id === "cDireccion") clearFieldError("cDireccion");
    });

    el.checkout.addEventListener("change", function (event) {
      if (event.target.name === "tipo") {
        updateTotals();
        if (getDeliveryType() === "delivery") {
          window.setTimeout(function () {
            $("#cDireccion").focus();
          }, 50);
        }
      }
    });
  }

  function init() {
    el.grid = $("#grid");
    el.empty = $("#empty");
    el.chips = $("#chips");
    el.search = $("#search");
    el.cart = $("#cart");
    el.cartFab = $("#cartFab");
    el.cartCount = $("#cartCount");
    el.cartClose = $("#cartClose");
    el.cartItems = $("#cartItems");
    el.cartEmpty = $("#cartEmpty");
    el.cartSubtitle = $("#cartSubtitle");
    el.checkout = $("#checkout");
    el.sendOrder = $("#sendOrder");
    el.overlay = $("#overlay");
    el.toast = $("#toast");
    el.tSubtotal = $("#tSubtotal");
    el.tEnvio = $("#tEnvio");
    el.tTotal = $("#tTotal");
    el.minNote = $("#minNote");

    if (!el.grid) return;

    var validIds = PRODUCTOS.map(function (product) {
      return product.id;
    });
    state.cart = loadCart().filter(function (item) {
      return validIds.indexOf(item.id) !== -1;
    });

    setupBusiness();
    renderChips();
    renderProducts();
    renderCart();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
