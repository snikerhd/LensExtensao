/* ============================================================================
 * lens-extract.js — v5.2.0
 * Content script do Google Lens / Pesquisa Google / consentimento.
 * ----------------------------------------------------------------------------
 * NOVO em v5.2.0 (o caso real reportado: «tá lá o texto mas falta clicar o
 * botão de search»):
 *  [NEW] O botão de pesquisa do Lens não tem aria-label: é identificado pelo
 *        PRÓPRIO SVG Material de search (path "M784-120…"), primeiro dentro
 *        do contentor da caixa e depois globalmente na página.
 *  [NEW] Submissão com RETENTATIVA (até 10×): se o primeiro clique não
 *        navegar, tenta outra vez a cada ~1 s.
 *  [NEW] O compositor certo: preferência ao campo cujo antepassado partilha
 *        o botão de lupa (evita textareas ocultas de outros widgets).
 *  [NEW] Se a URL da página ganhar "q" sem transição para /search (Lens pré-
 *        -anexa), a extração arranca na mesma.
 *
 * Mantido de v5.1.0:
 *  [NEW] Na página do Lens, a query é escrita na caixa E SUBMETIDA SOZINHA —
 *        clica o botão de pesquisa e, em fallback, envia Enter sintético e
 *        form.requestSubmit(). Já não precisas de carregar Enter à mão.
 *  [NEW] Se o Google pré-preencher a caixa com o texto, submete na mesma.
 *  [NEW] Fluxo SPA: se o Lens navegar para /search dentro da mesma página,
 *        a extração começa na hora, sem recarregar.
 *  [NEW] Gate de extração alargado: uma /search com q == query pendente e
 *        sinal fresco também é extraída (URLs de Enter sem &source=lns).
 *
 * Mantido de v5.0.0: sinal {at, url, query} com TTL de 15 min, document_start,
 * heurística tolerante de sessão Lens, parciais em timeout, parser multi-formato.
 * ==========================================================================*/
(function () {
  "use strict";

  var TAG = "[LensExt]";
  var VERSION = "5.2.0";
  var POLL_MS = 800; /* intervalo de varrimento */
  var MAX_POLLS = 100; /* ~80 s de timeout */
  var PENDING_TTL = 15 * 60 * 1000; /* 15 minutos */

  var DEFAULT_QUERY =
    "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";

  /* ---------------------------------------------------------------- utils */

  function log() {
    var args = [].slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }

  function hostMatches(sub, host) {
    return new RegExp("(^|\\.)" + sub + "\\.google\\.[a-z.]{2,7}$", "i").test(
      host
    );
  }

  var host = location.hostname;
  var isConsent = hostMatches("consent", host);
  var isLens = hostMatches("lens", host);
  var isGoogleSearch =
    /(^|\.)www\.google\.[a-z.]{2,7}$/i.test(host) &&
    location.pathname.indexOf("/search") === 0;

  function visible(el) {
    return !!el && el.offsetParent !== null && !el.disabled;
  }

  function clickConsent() {
    if (!document.documentElement) return false;
    var sels = [
      "#L2AGLb",
      "button[aria-label*='Aceitar']",
      "button[aria-label*='Concordo']",
      "button[aria-label*='Accept']",
      "button[aria-label*='Reject']",
      "form[action*='consent'] button",
      "button[form]"
    ];
    for (var i = 0; i < sels.length; i++) {
      var btn = document.querySelector(sels[i]);
      if (btn && visible(btn)) {
        try {
          btn.click();
          log("consentimento tratado (" + sels[i] + ")");
        } catch (e) {}
        return true;
      }
    }
    return false;
  }

  function getState() {
    return browser.storage.local
      .get(["lensQuery", "lensPending"])
      .then(function (s) {
        var q = (s.lensQuery || DEFAULT_QUERY).trim();
        var p = s.lensPending;
        var fresh = !!(p && p.at && Date.now() - p.at < PENDING_TTL);
        return {
          query: p && p.query ? p.query : q,
          fresh: fresh,
          pending: p || null
        };
      })
      .catch(function () {
        return { query: DEFAULT_QUERY, fresh: false, pending: null };
      });
  }

  function clearPending() {
    try {
      browser.storage.local.remove("lensPending");
    } catch (e) {}
  }

  function isLensSession(params) {
    var src = (params.get("source") || "").toLowerCase();
    if (src.indexOf("lns") === 0) return true;
    if (params.has("vsrid") || params.has("ludocid")) return true;
    if (params.get("udm") === "24") return true;
    if (params.has("lns") || params.has("gssid") || params.has("vsi"))
      return true;
    if (/lens\.google\./i.test(document.referrer || "")) return true;
    return false;
  }

  /* ------------------------------------------- escrever & SUBMETER [NEW] */

  /* O ícone de pesquisa do Google (Material "search") é estável: o path do
   * SVG começa sempre por "M784-120" — é assim que encontramos o botão de
   * search do Lens mesmo sem aria-label nem texto. */
  function isSearchIconBtn(btn) {
    if (!btn) return false;
    var svg = btn.querySelector("svg");
    if (!svg) return false;
    var p = svg.querySelector("path");
    var d = p && p.getAttribute && p.getAttribute("d");
    return !!d && (d.indexOf("M784-120") === 0 || d.indexOf("M784-120") !== -1);
  }

  function findSearchButton(nearEl) {
    var i, btns;
    /* 1) âmbito local: primeiro antepassado do compositor com botões */
    if (nearEl) {
      var node = nearEl;
      for (var depth = 0; depth < 8 && node.parentElement; depth++) {
        node = node.parentElement;
        btns = node.querySelectorAll("button");
        if (btns.length) {
          /* 1a) botão com a lupa Material dentro do mesmo contentor */
          for (i = 0; i < btns.length; i++) {
            if (visible(btns[i]) && isSearchIconBtn(btns[i])) return btns[i];
          }
          /* 1b) qualquer botão com SVG nesse contentor (o submit do Lens é
           * sempre um botão-ícone ao lado da caixa) */
          for (i = 0; i < btns.length; i++) {
            if (visible(btns[i]) && btns[i].querySelector("svg"))
              return btns[i];
          }
        }
        if (node === document.body) break;
      }
    }
    /* 2) global: qualquer botão visível com o ícone Material de search */
    btns = document.querySelectorAll("button");
    for (i = 0; i < btns.length; i++) {
      if (visible(btns[i]) && isSearchIconBtn(btns[i])) return btns[i];
    }
    return null;
  }

  function findComposer() {
    var sels = [
      "textarea#APjFqb",
      "textarea[name='q']",
      "textarea[aria-label]",
      "textarea:not([readonly])",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
      "input[type='search']",
      "input[type='text'][name='q']"
    ];
    /* passada 1: campo vazio cujo antepassado partilha o botão de lupa —
     * é a caixa certa do composer (evita textareas ocultas de outros widgets) */
    for (var i = 0; i < sels.length; i++) {
      var all = document.querySelectorAll(sels[i]);
      for (var j = 0; j < all.length; j++) {
        if (visible(all[j]) && findSearchButton(all[j])) return all[j];
      }
    }
    /* passada 2: primeiro campo visível que existir */
    for (var a = 0; a < sels.length; a++) {
      var allA = document.querySelectorAll(sels[a]);
      for (var b = 0; b < allA.length; b++) {
        if (visible(allA[b])) return allA[b];
      }
    }
    return null;
  }

  function textOf(el) {
    if (!el) return "";
    if (el.value !== undefined) return String(el.value || "");
    return (el.textContent || "").toString();
  }

  function setComposerText(el, value) {
    var tag = el.tagName;
    var proto =
      tag === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : tag === "INPUT"
        ? HTMLInputElement.prototype
        : null;
    if (proto) {
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.textContent = value;
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } catch (e) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchEnter(el) {
    try {
      el.focus();
    } catch (e) {}
    var seq = ["keydown", "keypress", "keyup"];
    for (var i = 0; i < seq.length; i++) {
      el.dispatchEvent(
        new KeyboardEvent(seq[i], {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  /* 4 vias de submissão: botão aria/título → botão de lupa (SVG Material)
   * → Enter sintético → form.requestSubmit() */
  function submitComposer(el, attempt) {
    /* 1) botão convencional (aria-label / título / type=submit) */
    var btns = document.querySelectorAll(
      "button[aria-label*='Pesquis'], button[aria-label*='pesquis']," +
        " button[aria-label*='Search'], button[aria-label*='search']," +
        " button[aria-label*='Buscar'], button[title*='Pesquis']," +
        " button[type='submit']"
    );
    for (var i = 0; i < btns.length; i++) {
      if (visible(btns[i])) {
        btns[i].click();
        log(
          "pesquisa SUBMETIDA via botão \"" +
            (btns[i].getAttribute("aria-label") || "submit") +
            "\" (tentativa " +
            attempt +
            ")"
        );
        return;
      }
    }

    /* 2) botão-ícone de pesquisa do Google (SVG Material "M784-120…") —
     *    o botão do Lens que o utilizador indicou, sem aria-label */
    var iconBtn = findSearchButton(el);
    if (iconBtn) {
      iconBtn.click();
      log("pesquisa SUBMETIDA via botão de lupa (tentativa " + attempt + ")");
      return;
    }

    /* 3) Enter sintético no próprio campo */
    dispatchEnter(el);

    /* 4) form nativo */
    var form = el.closest && el.closest("form");
    if (form && form.requestSubmit) {
      try {
        form.requestSubmit();
      } catch (e) {}
    } else if (form && form.submit) {
      try {
        form.submit();
      } catch (e) {}
    }
    log("pesquisa submetida via Enter/form (tentativa " + attempt + ")");
  }

  /* ----------------------------------------------------------- parser ---- */

  var RE_BULLETS = /^[\s>*•·▪◦‣–—-]*(?:\d{1,3}[.)]\s*)?/;

  var RE_JUNK = new RegExp(
    "^(ai overview|vis[aã]o geral|gera[cç][aã]o conclu[ií]da|criada por ia|overview|" +
      "sobre (a |as )?fontes?|mostrar mais|saber mais|learn more|show more|feedback|" +
      "experimental|descartar|dismiss|imagens|images|v[ií]deos|videos|not[ií]cias|" +
      "news|ferramentas|tools|todos|all|mapas|maps|compras|shopping|finan[cç]as|" +
      "pesquisas relacionadas|related searches|people also|tamb[eé]m|resultados|" +
      "aproximadamente|guardado|saved|copiar|copy|exportar|export|partilhar|share|" +
      "pausar|parar|stop|a pensar|thinking|a gerar|generating)",
    "i"
  );

  function hasLetter(s) {
    return /[a-záàâãäéèêëíìîïóòôõöúùûüçñ]/i.test(s);
  }

  function fmt(name, qty) {
    name = String(name || "")
      .replace(/[\s]*[-–—:;(]+$/g, "")
      .replace(/^["'«]+|["'»]+$/g, "")
      .trim();
    var n = parseInt(qty, 10);
    if (!isFinite(n) || n <= 0 || n > 99999) return null;
    if (name.length < 2 || name.length > 90) return null;
    if (!hasLetter(name)) return null;
    if (RE_JUNK.test(name)) return null;
    return name + " - " + n;
  }

  function parseItemLine(raw) {
    var line = String(raw || "")
      .replace(/\*\*/g, "")
      .replace(/__+/g, "")
      .replace(/[​‌‍﻿]/g, "")
      .trim();
    if (!line || line.length > 140) return null;
    line = line.replace(RE_BULLETS, "").trim();
    if (line.length < 2) return null;
    if (RE_JUNK.test(line)) return null;

    var m;

    /* "12x Nome" / "x12 Nome" / "12 x Nome" */
    m = line.match(/^x?\s*(\d{1,5})\s*x\s*[:.\-–—]?\s*(.{2,90})$/i);
    if (m) return fmt(m[2], m[1]);

    /* "Nome (x12)" / "Nome (12)" / "Nome [12]" */
    m = line.match(/^(.{2,90}?)[\s]*[(\[]\s*x?\s*(\d{1,5})\s*[)\]]\.?\s*$/i);
    if (m) return fmt(m[1], m[2]);

    /* "Nome - 12" / "Nome – qtd 12" / "Nome: 12" / "Nome x 12" */
    m = line.match(
      /^(.{2,90}?)[\s]*[-–—:|x]\s*(?:qtd\.?|qde\.?|x)?\s*(\d{1,5})\s*(?:un|pz|pcs)?\.?\s*$/i
    );
    if (m) return fmt(m[1], m[2]);

    return null;
  }

  function linesFrom(el) {
    var txt = "";
    try {
      txt = (el.innerText || el.textContent || "").toString();
    } catch (e) {
      return [];
    }
    return txt.split(/\r?\n+/);
  }

  function parseLines(lines, seen, out) {
    for (var i = 0; i < lines.length; i++) {
      var item = parseItemLine(lines[i]);
      if (item) {
        var key = item.toLowerCase();
        if (!seen[key]) {
          seen[key] = true;
          out.push(item);
        }
      }
      if (out.length >= 30) break;
    }
  }

  function extractItems() {
    var scopes = [
      "#m-x-content",
      "#kp-wp-tab-overview",
      "div[jsname='yp1Ndf']",
      "[data-sgrd]",
      ".Ts92Rd",
      ".xpdopen",
      ".kp-blk",
      "#center_col"
    ];
    for (var s = 0; s < scopes.length; s++) {
      var el = document.querySelector(scopes[s]);
      if (el && el.offsetParent !== null) {
        var seen = {};
        var out = [];
        parseLines(linesFrom(el), seen, out);
        if (out.length >= 2) return out;
      }
    }
    var seenAll = {};
    var outAll = [];
    if (document.body) parseLines(linesFrom(document.body), seenAll, outAll);
    return outAll;
  }

  /* -------------------------------------------------------- loops -------- */

  function consentLoop() {
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (clickConsent() || n > 30) clearInterval(iv);
    }, 700);
  }

  /* Página do Lens: escreve a query na caixa (se vazia) e SUBMETE, com
   * RETENTATIVA até sair — se o primeiro clique não navegar, volta a tentar
   * até 10 vezes. Cuida também do caso SPA (Lens → /search sem recarregar). */
  function lensLoop(st) {
    var n = 0;
    var attempts = 0;

    var iv = setInterval(function () {
      n++;
      clickConsent();

      /* URL com q na mesma página (o Google anexou-o) → tratar como /search */
      var paramsNow = new URLSearchParams(location.search);
      if (paramsNow.get("q") && st.fresh) {
        clearInterval(iv);
        log("URL com q detetado na mesma página → a extrair");
        extractLoop();
        return;
      }

      /* SPA: o Lens mudou para /search dentro do mesmo documento */
      if (location.pathname.indexOf("/search") === 0 && st.fresh) {
        clearInterval(iv);
        log("SPA: /search detetado → a extrair no mesmo documento");
        extractLoop();
        return;
      }

      if (st.fresh && attempts < 10) {
        var el = findComposer();
        if (el) {
          var current = textOf(el).trim();
          if (!current) {
            setComposerText(el, st.query);
            log("query escrita na caixa do Lens (tentativa " + (attempts + 1) + ")");
          }
          (function (target, which) {
            setTimeout(function () {
              /* só retenta se a página ainda não saiu deste estado */
              if (!new URLSearchParams(location.search).get("q")) {
                submitComposer(target, which);
              }
            }, which === 1 ? 450 : 900);
          })(el, attempts + 1);
          attempts++;
        }
      }

      if (n > 130) clearInterval(iv); /* ~105 s */
    }, 800);

    log("sessão Lens — a escrever e a SUBMETER (botão de lupa incluído)…");
  }

  function extractLoop() {
    log("modo extrair — à procura de itens (nome - quantidade)…");
    var tries = 0;
    var lastText = "";
    var stable = 0;
    var sent = false;

    var iv = setInterval(function () {
      tries++;
      clickConsent();

      var items = extractItems();
      var text = items.length ? items.join("\n") : "";

      if (text && text === lastText) stable++;
      else stable = 0;
      lastText = text;

      if (!sent && text && stable >= 2 && tries >= 3) {
        sent = true;
        clearInterval(iv);
        clearPending();
        log("EXTRAÍDOS " + items.length + " itens:\n" + text);
        try {
          browser.runtime.sendMessage({
            type: "LENS_TEXT_EXTRACTED",
            text: text,
            count: items.length
          });
        } catch (e) {
          log("sendMessage falhou:", e);
        }
        return;
      }

      if (tries % 10 === 0)
        log(
          "…" +
            Math.round((tries * POLL_MS) / 1000) +
            "s — itens: " +
            items.length
        );

      if (!sent && tries >= MAX_POLLS) {
        clearInterval(iv);
        clearPending();
        log("TIMEOUT. Itens parciais:", items.length);
        try {
          browser.runtime.sendMessage({
            type: "LENS_TEXT_FAILED",
            text: text,
            count: items.length
          });
        } catch (e) {}
      }
    }, POLL_MS);
  }

  /* ----------------------------------------------------------------- boot */

  function whenDOMReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function boot() {
    log(VERSION + " em", location.hostname + location.pathname);

    if (isConsent) {
      consentLoop();
      return;
    }
    if (isLens) {
      getState().then(function (st) {
        whenDOMReady(function () {
          lensLoop(st);
        });
      });
      return;
    }
    if (!isGoogleSearch) return;

    var params = new URLSearchParams(location.search);
    var hasQ = !!(params.get("q") || "").trim();
    var injected = params.get("extq") === "1";
    var lensSession = isLensSession(params);

    getState().then(function (st) {
      /* [NEW] /search com q igual à nossa query (ex.: navegação via Enter,
       * cujos URLs podem não ter &source=lns) também conta como sessão nossa. */
      var isOurQuery =
        st.pending &&
        st.pending.query &&
        (params.get("q") || "").trim() === st.pending.query.trim();

      /* sessão Lens SEM query + sinal fresco → anexar a query e recarregar */
      if (!hasQ && !injected && lensSession && st.fresh) {
        params.set("q", st.query);
        params.set("extq", "1");
        if (!params.get("sclient"))
          params.set("sclient", "multimodal-lens-web");
        var url =
          location.origin +
          location.pathname +
          "?" +
          params.toString() +
          location.hash;
        log("a anexar a query multimodal ao URL da sessão…");
        location.replace(url);
        return;
      }

      /* já com query → extrair */
      if (hasQ && (injected || (lensSession && st.fresh) || isOurQuery)) {
        clickConsent();
        whenDOMReady(extractLoop);
        return;
      }

      log(
        "nada a fazer (q=" +
          hasQ +
          ", sessãoLens=" +
          lensSession +
          ", nossaQuery=" +
          isOurQuery +
          ", pendente=" +
          st.fresh +
          ")"
      );
    });
  }

  boot();
})();
