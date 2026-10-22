/* ============================================================================
 * lens-extract.js — v4.0.0 (reescrito de raiz)
 * ----------------------------------------------------------------------------
 * O que estava partido na versão antiga (v8.0) e foi corrigido aqui:
 *   1. Ficheiro NEM sequer carregava: 5x "const input = ..." no mesmo scope
 *      (SyntaxError), seletores CSS inválidos ("textarea[name=\"q\"])" com um
 *      parêntese pendurado), e uma regex com ")?" a mais → o script morria no
 *      parse e a extensão "não fazia nada".
 *   2. As regex usavam \\s / \\d dentro de literais (procuravam um backslash
 *      literal) → nunca faziam match a texto real.
 *   3. QUERY e queryFeida eram usados mas NUNCA declarados (ReferenceError).
 *   4. Tentar "escrever" na caixa de pesquisa do Lens com eventos sintéticos
 *      é frágil (React do Google ignora metade das vezes).
 *
 * Novo fluxo (robusto) — reproduz EXATAMENTE a pesquisa manual:
 *   a) lens.google.com/uploadbyurl?url=<imagem>  → o Google redireciona para
 *      https://www.google.com/search?...&source=lns.web.ukn&vsrid=... (sem q)
 *   b) este script deteta essa sessão e ANEXA a query ao próprio URL:
 *      ...&q=<query>&sclient=multimodal-lens-web  →  location.replace()
 *      (é o mesmo que o Google faz quando escreves na caixa do Lens)
 *   c) a nova página já traz o AI Overview com "nome - quantidade"; o script
 *      extrai as linhas, estabiliza e envia para o background.
 * ==========================================================================*/
(function () {
  "use strict";

  var TAG = "[LensExt]";
  var POLL_MS = 800;              // intervalo de varrimento
  var MAX_POLLS = 75;             // ~60s de timeout
  var PENDING_TTL = 3 * 60 * 1000; // sinal "veio da extensão" é válido 3 min

  // A query que provaste manualmente que resulta. É a predefinição; o popup
  // guarda em storage.local uma versão editável (chave "lensQuery").
  var DEFAULT_QUERY =
    "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";

  var isConsent = /(^|\.)consent\.google\.com$/i.test(location.hostname);
  var isLens = /(^|\.)lens\.google\.com$/i.test(location.hostname);
  var isGoogleSearch =
    /(^|\.)www\.google\.com$/i.test(location.hostname) &&
    /^\/search\b/.test(location.pathname);

  /* ---------------------------------------------------------------- utils */

  function log() {
    var args = [].slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }

  function clickConsent() {
    var sels = [
      "#L2AGLb",
      "button[aria-label*='Aceitar']",
      "button[aria-label*='Concordo']",
      "button[aria-label*='Accept']",
      "form[action*='consent'] button",
      "button[form]"
    ];
    for (var i = 0; i < sels.length; i++) {
      var b;
      try { b = document.querySelector(sels[i]); } catch (e) { continue; }
      if (b && b.offsetParent !== null) {
        try { b.click(); log("consentimento aceite:", sels[i]); return true; } catch (e) {}
      }
    }
    return false;
  }

  function getState() {
    return browser.storage.local
      .get(["lensQuery", "lensPending"])
      .then(function (s) {
        var fresh =
          typeof s.lensPending === "number" &&
          Date.now() - s.lensPending < PENDING_TTL;
        return { query: s.lensQuery || DEFAULT_QUERY, fresh: fresh };
      })
      .catch(function () {
        return { query: DEFAULT_QUERY, fresh: false };
      });
  }

  function clearPending() {
    try { browser.storage.local.set({ lensPending: 0 }); } catch (e) {}
  }

  /* ------------------------------------------------- deteção da sessão ---- */

  // Uma página google.com/search é uma "sessão Lens" quando traz os parâmetros
  // de visão (vsrid/vsdim), source=lns.* ou o cliente multimodal.
  function isLensSession(p) {
    var src = (p.get("source") || "").toLowerCase();
    var scl = (p.get("sclient") || "").toLowerCase();
    return (
      src.indexOf("lns") === 0 ||
      scl.indexOf("multimodal") === 0 ||
      p.has("vsrid") ||
      p.has("vsdim")
    );
  }

  /* -------------------------------------------------- extração de itens --- */

  // bullets/numeração/markdown à esquerda
  var RE_BULLETS = /^[\s•●○◦▪‣·*+\-–—>›»#~]*(?:\d{1,3}[.)]\s*)?/;
  // linhas que NUNCA são itens (UI do Google / AI Overview)
  var RE_JUNK = new RegExp(
    "^(ai overview|vis[aã]o geral|criada por ia|overview|sobre (a |as )?fontes?|" +
      "mostrar mais|saber mais|learn more|show more|more|feedback|experimental|" +
      "descartar|dismiss|imagens|images|v[ií]deos|videos|not[ií]cias|news|" +
      "ferramentas|tools|todos|all|mapas|maps|compras|shopping|finanças|" +
      "pesquisas relacionadas|related searches|people also|tamb[eé]m|" +
      "resultados|aproximadamente|about [\\d.,]+|guardado|saved|copiar|copy|" +
      "partilhar|share|exportar|export|a pensar|thinking|gerar|generating)",
    "i"
  );

  function hasLetter(s) {
    return /[a-záàâãäéèêëíìîïóòôõöúùûüçñ]/i.test(s);
  }

  function fmt(name, qty) {
    name = (name || "")
      .replace(/[\s]*[-–—:;(]+$/, "")
      .replace(/^["'«]+|["'»]+$/g, "")
      .trim();
    if (name.length < 2 || name.length > 90) return null;
    if (!hasLetter(name)) return null;
    return name + " - " + qty;
  }

  // Devolve "Nome - qtd" normalizado, ou null se a linha não for um item.
  function parseItemLine(raw) {
    var line = String(raw || "")
      .replace(/\*\*/g, "")       // markdown bold
      .replace(/__+/g, "")
      .replace(/​/g, "")
      .trim();
    if (line.length < 3 || line.length > 140) return null;
    line = line.replace(RE_BULLETS, "").trim();
    if (line.length < 2) return null;
    if (RE_JUNK.test(line)) return null;
    if (/https?:\/\//i.test(line)) return null;
    if (!hasLetter(line)) return null;

    var m;
    // "Nome - 12" | "Nome – 12" | "Nome: 12"
    if ((m = line.match(/^(.+?)\s*[-–—:]\s*(\d{1,6})\s*$/))) return fmt(m[1], m[2]);
    // "Nome (x12)" | "Nome x12" | "Nome × 12"
    if ((m = line.match(/^(.+?)\s*\(?\s*[x×]\s*(\d{1,6})\s*\)?\s*$/i))) return fmt(m[1], m[2]);
    // "12x Nome" | "12 × Nome"
    if ((m = line.match(/^(\d{1,6})\s*[x×]\s*(.+)$/i))) return fmt(m[2], m[1]);
    return null;
  }

  function extractItems() {
    var body = document.body ? document.body.innerText || "" : "";
    if (!body) return [];
    var out = [];
    var seen = {};
    var lines = body.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var item = parseItemLine(lines[i]);
      if (item) {
        var key = item.toLowerCase();
        if (!seen[key]) {
          seen[key] = 1;
          out.push(item);
        }
      }
      if (out.length >= 120) break;
    }
    return out;
  }

  /* -------------------------------------------------------- loops principais */

  // Página de consentimento separada (consent.google.com) — aceita e segue.
  function consentLoop() {
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (clickConsent()) clearInterval(iv);
      if (n > 30) clearInterval(iv);
    }, 700);
  }

  // Em lens.google.com só precisamos de aceitar cookies e esperar que o Google
  // redirecione sozinho para google.com/search (sessão de visão).
  function lensLoop() {
    var n = 0;
    var iv = setInterval(function () {
      n++;
      clickConsent();
      if (n > 30) clearInterval(iv); // o redirect navega para outra página
    }, 800);
    log("sessão Lens iniciada, à espera do redirect para /search…");
  }

  // google.com/search com a query presente → modo "extrair do AI Overview".
  function extractLoop() {
    log("modo extrair — à procura de itens (nome - quantidade)…");
    var tries = 0;
    var lastText = "";
    var stable = 0;
    var sent = false;

    var iv = setInterval(function () {
      tries++;
      clickConsent(); // porreiro se aparecer tarde

      var items = extractItems();
      var text = items.length >= 1 ? items.join("\n") : "";

      if (text && text === lastText) stable++;
      else stable = 0;
      lastText = text;

      // envia quando o conteúdo fica estável (2 leituras iguais) e não é
      // demasiado cedo (o AI Overview vai "escrevendo" aos poucos)
      if (!sent && text && stable >= 2 && tries >= 3) {
        sent = true;
        clearInterval(iv);
        clearPending();
        log("EXTRAÍDOS " + items.length + " itens:\n" + text);
        try {
          browser.runtime.sendMessage({ type: "LENS_TEXT_EXTRACTED", text: text, count: items.length });
        } catch (e) { log("sendMessage falhou:", e); }
        return;
      }

      if (tries % 10 === 0) {
        log("…" + Math.round((tries * POLL_MS) / 1000) + "s — itens encontrados: " + items.length);
      }

      if (!sent && tries >= MAX_POLLS) {
        clearInterval(iv);
        clearPending();
        log("TIMEOUT: AI Overview não apareceu ou sem itens no formato pedido.");
        try { browser.runtime.sendMessage({ type: "LENS_TEXT_FAILED" }); } catch (e) {}
      }
    }, POLL_MS);
  }

  /* ----------------------------------------------------------------- boot --- */

  function boot() {
    log("v4.0.0 em", location.hostname + location.pathname);

    if (isConsent) { consentLoop(); return; }
    if (isLens) { lensLoop(); return; }
    if (!isGoogleSearch) return;

    var params = new URLSearchParams(location.search);
    var hasQ = !!(params.get("q") || "").trim();
    var injected = params.get("extq") === "1";

    clickConsent();

    getState().then(function (st) {
      var lensSession = isLensSession(params);

      // (b) sessão Lens SEM query e com sinal fresco do popup/menu
      //     → anexamos a query ao URL (igual à pesquisa manual) e recarrega.
      if (!hasQ && !injected && lensSession && st.fresh) {
        params.set("q", st.query);
        params.set("extq", "1"); // marca p/ não entrar em loop
        if (!params.get("sclient")) params.set("sclient", "multimodal-lens-web");
        var url =
          location.origin + location.pathname + "?" + params.toString() + location.hash;
        log("a anexar query multimodal ao URL da sessão…");
        location.replace(url);
        return;
      }

      // (c) já com query (veio do passo anterior ou o utilizador colou um URL
      //     completo no popup) → extrair.
      if (hasQ && (injected || (lensSession && st.fresh))) {
        extractLoop();
        return;
      }

      log("nada a fazer aqui (q=" + hasQ + ", sessão Lens=" + lensSession + ", pendente=" + st.fresh + ")");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
