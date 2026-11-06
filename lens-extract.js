/* ============================================================================
 * lens-extract.js — v5.8.0
 * Base: v5.4.2 aprovada no AMO (multimodal + parser estruturado + acessórios).
 * [FIX PK] Armas com "0 munições" deixam de ser descartadas: saem como
 *          "Nome - 0 munições" e o site conta 1 unidade sem somar munição.
 * [FIX PK] Escolhe o bloco com mais linhas de inventário (":", munições,
 *          acessórios) e filtra lixo de resultados relacionados (apps, guias,
 *          battle pass). Antes, o primeiro bloco com 2 linhas de lixo vencia.
 * [FIX PK] Só considera o texto estável para envio quando há sinal de
 *          inventário (linha forte ou 4+ itens), evitando enviar o lixo antes
 *          de o AI Overview terminar de gerar o inventário.
 * [FIX PK] Quantidades até 1e15 / 15 dígitos (dinheiro em milhões deixava de
 *          ser extraído pelo limite antigo de 99999 e pelos \d{1,5}).
 * [FIX PK] Não deduplica pilhas repetidas (4× "Dinheiro", 2× "Dinheiro -
 *          100000000") — o site soma por nome.
 * [FIX PK] Filtra "Loot Table Config", "Better Loot", "Config" e etiquetas
 *          truncadas com "..." que antes entravam como itens.
 * [FIX PK] Prompt obriga a listar TODAS as pilhas, sem juntar/somar/deduplicar.
 * ==========================================================================*/
(function () {
  "use strict";

  var TAG = "[LensExt]";
  var VERSION = "5.8.0";
  var POLL_MS = 800;
  var MAX_POLLS = 100;
  var PENDING_TTL = 15 * 60 * 1000;

  var DEFAULT_QUERY = `Analisa a imagem deste inventário e extrai TODOS os itens visíveis, um por linha, no formato "Nome: xQuantidade", seguindo rigorosamente estas regras:

1. Itens normais: nome do item e quantidade (ex: "Bifana: x3"). Copia cada pilha tal como aparece — se houver várias pilhas do mesmo item (ex: vários "Dinheiro"), lista TODAS, sem juntar, somar ou eliminar duplicados.
2. Quantidades completas: mantém o número inteiro, mesmo que seja em milhões (ex: "Dinheiro: x100000000"). Não uses separadores de milhares.
3. Armas: nome da arma, número de munições e quantidade de acessórios acoplados (ex: "Machine Pistol: 117 munições | 1 acessório"). Para acessórios, usa apenas a quantidade numérica.
4. Petrol Can (Galão de Combustível): ignora qualquer número grande no topo do ícone; a quantidade é sempre "x1".
5. Caixas vazias: não listes os espaços vazios do inventário.
6. Ignora etiquetas de interface (ex: "Loot Table Config", "Better Loot", "Config"), números de nível por cima dos itens e texto cortado com "...". Não traduzas os nomes.

Responde apenas com a lista formatada.`;

  function log() {
    var args = [].slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }

  function hostMatches(sub, host) {
    return new RegExp("(^|\\.)" + sub + "\\.google\\.[a-z.]{2,7}$", "i").test(host);
  }

  var host = location.hostname;
  var isConsent = hostMatches("consent", host);
  var isLens = hostMatches("lens", host);
  var isGoogleSearch =
    /(^|\.)www\.google\.[a-z.]{2,7}$/i.test(host) &&
    location.pathname.indexOf("/search") === 0;

  /* [FIX] Força TODOS os parâmetros multimodais do URL de referência. */
  function forceMultimodalParams(params) {
    var changed = false;

    if (params.get("lns_mode") !== "mu") { params.set("lns_mode", "mu"); changed = true; }
    if (params.get("udm") !== "24")       { params.set("udm", "24");       changed = true; }
    if (!params.get("sclient"))           { params.set("sclient", "multimodal-lens-web"); changed = true; }
    if (!params.get("source"))            { params.set("source", "lns.web.ukn"); changed = true; }
    if (!params.get("lns_surface"))       { params.set("lns_surface", "26");     changed = true; }
    if (!params.get("hl"))                { params.set("hl", "pt-PT");           changed = true; }
    if (!params.get("extq"))              { params.set("extq", "1");             changed = true; }
    if (!params.get("qsubts"))            { params.set("qsubts", Date.now().toString()); changed = true; }
    if (!params.get("lns_fp"))            { params.set("lns_fp", "1");           changed = true; }
    var q = params.get("q") || "";
    if (!params.get("oq") && q)           { params.set("oq", q);                 changed = true; }
    if (!params.get("stq"))               { params.set("stq", "1");              changed = true; }
    if (!params.get("cs"))                { params.set("cs", "1");               changed = true; }

    return changed;
  }

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
    if (params.has("lns") || params.has("gssid") || params.has("vsi")) return true;
    if (/lens\.google\./i.test(document.referrer || "")) return true;
    return false;
  }

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
    if (nearEl) {
      var node = nearEl;
      for (var depth = 0; depth < 8 && node.parentElement; depth++) {
        node = node.parentElement;
        btns = node.querySelectorAll("button");
        if (btns.length) {
          for (i = 0; i < btns.length; i++) {
            if (visible(btns[i]) && isSearchIconBtn(btns[i])) return btns[i];
          }
          for (i = 0; i < btns.length; i++) {
            if (visible(btns[i]) && btns[i].querySelector("svg")) return btns[i];
          }
        }
        if (node === document.body) break;
      }
    }
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
    for (var i = 0; i < sels.length; i++) {
      var all = document.querySelectorAll(sels[i]);
      for (var j = 0; j < all.length; j++) {
        if (visible(all[j]) && findSearchButton(all[j])) return all[j];
      }
    }
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

  function submitComposer(el, attempt) {
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

    var iconBtn = findSearchButton(el);
    if (iconBtn) {
      iconBtn.click();
      log("pesquisa SUBMETIDA via botão de lupa (tentativa " + attempt + ")");
      return;
    }

    dispatchEnter(el);

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

  var RE_BULLETS = /^[\s>*•·▪◦‣–—-]*(?:\d{1,3}[.)]\s*)?/;

  var RE_JUNK = new RegExp(
    "^(ai overview|vis[aã]o geral|gera[cç][aã]o conclu[ií]da|criada por ia|overview|" +
      "sobre (a |as )?fontes?|mostrar mais|saber mais|learn more|show more|feedback|" +
      "experimental|descartar|dismiss|imagens|images|v[ií]deos|videos|not[ií]cias|" +
      "news|ferramentas|tools|todos|all|mapas|maps|compras|shopping|finan[cç]as|" +
      "pesquisas relacionadas|related searches|people also|tamb[eé]m|resultados|" +
      "aproximadamente|guardado|saved|copiar|copy|exportar|export|partilhar|share|" +
      "pausar|parar|stop|a pensar|thinking|a gerar|generating|" +
      "loot\\s*table|better\\s*loot|config|configura[cç][aã]o)",
    "i"
  );

  /* Junk que aparece no meio/fim de resultados relacionados (apps, vídeos,
   * guias). Não é ancorado ao início porque o título vem antes da palavra. */
  var RE_JUNK_ANY = new RegExp(
    "apps?\\s+on\\s+google\\s+play|google\\s+play|play\\s+store|" +
      "battle\\s*pass|b[öo]l[üu]m|hwarang|\\byeni\\b|daily\\s+diamond|" +
      "\\bguide\\b|\\bguia\\b|\\btutorial\\b|gameplay|youtube|" +
      "download|descarregar|\\bapk\\b|wiki|reddit|discord|" +
      "subscreve|subscribe|assistir|ver agora|baixar|instalar",
    "i"
  );

  /* Nomes cortados pela UI ("...", "…") não são itens — são etiquetas
   * truncadas (ex.: "Loot Table Config (Better Loot V4 Compatible ..."). */
  function isTruncatedUiLabel(name) {
    return /\.{2,}|…/.test(name);
  }

  function hasLetter(s) {
    return /[a-záàâãäéèêëíìîïóòôõöúùûüçñ]/i.test(s);
  }

  function fmt(name, qty, allowZeroAmmo) {
    name = String(name || "")
      .replace(/[\s]*[-–—:;(]+$/g, "")
      .replace(/^["'«]+|["'»]+$/g, "")
      .trim();
    var n = parseInt(qty, 10);
    /* [FIX PK] Dinheiro de RP vai aos milhões/mil milhões. O limite antigo
     * (99999) descartava "Dinheiro - 100000000", "Saco Dinheiro - 48227484",
     * etc. Number continua exato até 2^53, por isso 1e15 é seguro. */
    if (!isFinite(n) || n < 0 || n > 1e15) return null;
    if (name.length < 2 || name.length > 90) return null;
    if (!hasLetter(name)) return null;
    if (isTruncatedUiLabel(name)) return null;
    if (RE_JUNK.test(name) || RE_JUNK_ANY.test(name)) return null;
    /* Arma com 0 munições continua a ser uma arma: o site conta 1 unidade
     * sem somar munição (não dispara a coima de Posse de Munição). */
    if (n === 0) return allowZeroAmmo ? name + " - 0 munições" : null;
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
    if (RE_JUNK.test(line) || RE_JUNK_ANY.test(line)) return null;

    var m;

    // 0) Petrol Can (Galão) — força quantidade a 1 (ignora número grande no topo)
    if (/petrol[\s-]*can|gal[ãa]o\s+de\s+combust/i.test(line)) {
      m = line.match(/^([^:]{2,90})[\s]*:/i);
      if (m) return fmt(m[1], 1);
    }

    // 1) Arma com munições: "Machine Pistol: 117 munições | 1 acessório"
    //    Com 0 munições devolve "Nome - 0 munições" (o site conta a arma).
    m = line.match(/^(.{2,90}?)[\s]*[:][\s]*(?:x)?(\d{1,15})[\s]*muni[çc]/i);
    if (m) return fmt(m[1], m[2], true);

    // 2) "12x Nome" / "x12 Nome"
    m = line.match(/^x?\s*(\d{1,15})\s*x\s*[:.\-–—]?\s*(.{2,90})$/i);
    if (m) return fmt(m[2], m[1]);

    // 3) "Nome (x12)" / "Nome [12]"
    m = line.match(/^(.{2,90}?)[\s]*[(\[]\s*x?\s*(\d{1,15})\s*[)\]]\.?\s*$/i);
    if (m) return fmt(m[1], m[2]);

    // 4) "Nome - 12" / "Nome: 12" / "Nome: x12" / "Nome x 12"
    m = line.match(
      /^(.{2,90}?)[\s]*[-–—:|x]\s*(?:qtd\.?|qde\.?|x)?\s*(\d{1,15})\s*(?:un|pz|pcs)?\.?\s*$/i
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

  function parseLines(lines, seen, out, stats) {
    for (var i = 0; i < lines.length; i++) {
      // 1) Item principal (Arma, Munições, Dinheiro, etc.)
      var item = parseItemLine(lines[i]);
      if (item) {
        /* [FIX PK] Não deduplicar: há várias pilhas do mesmo item (4×
         * "Dinheiro", 2× "Dinheiro - 100000000"). O site soma por nome, por
         * isso cada pilha tem de chegar lá. Duplicados de polling não entram
         * porque só se envia quando o texto estabiliza. */
        out.push(item);
        if (stats) {
          stats.total++;
          /* Linhas com ":" ou munições/acessórios são quase sempre do
           * inventário (a query pede "Nome: xQtd"). Linhas só com "-"
           * podem ser resultados relacionados/anúncios. */
          if (/[:]/.test(lines[i]) || /muni[çc]|acess[oó]ri/i.test(lines[i])) {
            stats.strong++;
          }
        }
      }

      // 2) Acessórios no final da linha (ex: "| 1 acessório")
      var accMatch = lines[i].match(/\|\s*(\d{1,15})\s*acess[oó]ri/i);
      if (accMatch) {
        var accQty = parseInt(accMatch[1], 10);
        if (accQty > 0) out.push("Acessórios - " + accQty);
      }

      if (out.length >= 200) break;
    }
  }

  /* Estatísticas do último extractItems(): strong = linhas com sinal claro de
   * inventário (":", munições, acessórios). Usado para não enviar lixo antes
   * de o AI Overview gerar o inventário. */
  var lastExtractStats = { strong: 0, total: 0 };

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
    var best = [];
    var bestScore = -1;
    var bestStats = { strong: 0, total: 0 };
    for (var s = 0; s < scopes.length; s++) {
      var el = document.querySelector(scopes[s]);
      if (el && el.offsetParent !== null) {
        var out = [];
        var stats = { total: 0, strong: 0 };
        parseLines(linesFrom(el), {}, out, stats);
        /* Prioriza o bloco com mais linhas "de inventário" (com ":" ou
         * munições/acessórios). Assim um bloco pequeno de resultados
         * relacionados (ex.: "… - Apps on Google Play - 7") não ganha ao
         * inventário verdadeiro. */
        var score = stats.strong * 100 + stats.total;
        if (score > bestScore) {
          bestScore = score;
          best = out;
          bestStats = stats;
        }
      }
    }
    /* Só cai para o body se nenhum scope tiver linhas fortes (inventário).
     * Evita escolher o body inteiro (com resultados relacionados) quando já
     * temos o bloco certo. */
    if (bestScore < 100 && document.body) {
      var outAll = [];
      var statsAll = { total: 0, strong: 0 };
      parseLines(linesFrom(document.body), {}, outAll, statsAll);
      if (statsAll.strong * 100 + statsAll.total > bestScore) {
        best = outAll;
        bestStats = statsAll;
      }
    }
    lastExtractStats = bestStats;
    return best;
  }

  function consentLoop() {
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (clickConsent() || n > 30) clearInterval(iv);
    }, 700);
  }

  function ensureMultimodalAndExtract(st, iv) {
    clearInterval(iv);
    var params = new URLSearchParams(location.search);
    var changed = forceMultimodalParams(params);

    if (isLens) {
      var url = "https://www.google.com/search?" + params.toString();
      log("a redirecionar do Lens para www.google.com/search com parâmetros multimodais");
      location.replace(url);
      return;
    }

    if (changed) {
      var url2 =
        location.origin + location.pathname + "?" + params.toString() + location.hash;
      log("a recarregar a pesquisa com parâmetros multimodais (mu/24)");
      location.replace(url2);
      return;
    }

    log("parâmetros multimodais OK → a extrair");
    extractLoop();
  }

  function lensLoop(st) {
    var n = 0;
    var attempts = 0;

    var iv = setInterval(function () {
      n++;
      clickConsent();

      var paramsNow = new URLSearchParams(location.search);

      if (paramsNow.get("q") && st.fresh) {
        log("URL com q detetado → a garantir parâmetros multimodais");
        ensureMultimodalAndExtract(st, iv);
        return;
      }

      if (location.pathname.indexOf("/search") === 0 && st.fresh) {
        log("SPA: /search detetado → a garantir parâmetros multimodais");
        ensureMultimodalAndExtract(st, iv);
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
              if (!new URLSearchParams(location.search).get("q")) {
                submitComposer(target, which);
              }
            }, which === 1 ? 450 : 900);
          })(el, attempts + 1);
          attempts++;
        }
      }

      if (n > 130) clearInterval(iv);
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
      var hasInventorySignal =
        lastExtractStats.strong > 0 || items.length >= 4;

      if (text && text === lastText && hasInventorySignal) stable++;
      else stable = 0;
      lastText = text;

      if (!sent && text && hasInventorySignal && stable >= 2 && tries >= 3) {
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
        log("…" + Math.round((tries * POLL_MS) / 1000) + "s — itens: " + items.length);

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
      var isOurQuery =
        st.pending &&
        st.pending.query &&
        (params.get("q") || "").trim() === st.pending.query.trim();

      if (!hasQ && !injected && lensSession && st.fresh) {
        params.set("q", st.query);
        params.set("extq", "1");
        forceMultimodalParams(params);
        var url =
          location.origin + location.pathname + "?" + params.toString() + location.hash;
        log("a anexar a query multimodal ao URL da sessão…");
        location.replace(url);
        return;
      }

      if (hasQ && (injected || (lensSession && st.fresh) || isOurQuery)) {
        var changed = forceMultimodalParams(params);
        if (changed) {
          var url2 =
            location.origin + location.pathname + "?" + params.toString() + location.hash;
          log("a corrigir parâmetros para multimodal (mu/24) e recarregar");
          location.replace(url2);
          return;
        }
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