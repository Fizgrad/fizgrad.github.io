(function () {
  "use strict";

  var GITHUB = "https://github.com/Fizgrad";

  var I18N = {
    zh: {
      lang: "zh-CN",
      navProjects: "项目",
      navRepos: "仓库",
      navRec: "推荐",
      greet: "Hello, world. 我是",
      scroll: "向下探索",
      pagesTitle: "GitHub Pages 项目",
      pagesSub: "可直接访问的在线 Demo",
      reposTitle: "更多仓库",
      reposSub: "其他开源项目 · 点击前往 GitHub",
      recTitle: "推荐",
      recSub: "值得一看的站点",
      recBadge: "推荐",
      ctaTitle: "想出现在这里?",
      ctaText: "欢迎联系我,把你的站点或主页加进来。",
      ctaBtn: "联系我",
      navBlog: "博客",
      blogTitle: "博客",
      blogSub: "所思所写",
      blogReadMore: "阅读全文",
      backTop: "回到顶部 ↑",
      skip: "跳到主内容",
      contrib: "贡献",
      langBtn: "EN",
      langBtnAria: "Switch to English",
      scrollAria: "向下滚动查看项目",
      phrases: ["C++", "Compiler", "Runtime"]
    },
    en: {
      lang: "en",
      navProjects: "Projects",
      navRepos: "Repos",
      navRec: "Recommend",
      greet: "Hello, world. I'm",
      scroll: "Scroll down",
      pagesTitle: "GitHub Pages Projects",
      pagesSub: "Live demos you can try right away",
      reposTitle: "More Repositories",
      reposSub: "Other open-source projects \u00b7 open on GitHub",
      recTitle: "Recommend",
      recSub: "Sites worth visiting",
      recBadge: "Recommend",
      ctaTitle: "Want to be here?",
      ctaText: "Feel free to contact me to add your site or homepage.",
      ctaBtn: "Contact me",
      navBlog: "Blog",
      blogTitle: "Blog",
      blogSub: "Thoughts and writings",
      blogReadMore: "Read more",
      backTop: "Back to top \u2191",
      skip: "Skip to main content",
      contrib: "Contrib",
      langBtn: "\u4e2d",
      langBtnAria: "\u5207\u6362\u5230\u4e2d\u6587",
      scrollAria: "Scroll down to see projects",
      phrases: ["C++", "Compiler", "Runtime"]
    }
  };

  var pagesProjects = [
    {
      title: "CodeRedundancyDetector",
      desc: "\u57fa\u4e8e\u4e8c\u8fdb\u5236\u53cd\u6c47\u7f16\u7684\u91cd\u590d\u4ee3\u7801\u7247\u6bb5\u68c0\u6d4b\u5de5\u5177\uff0c\u8bc6\u522b\u514b\u9686\u4ee3\u7801\u5757\u3002",
      descEn: "Repeat code-fragment detection on binary disassembly, identifying cloned code blocks.",
      url: "https://fizgrad.github.io/CodeRedundancyDetector/",
      tags: ["C++", "Binary", "Disasm"],
      glow: "#fb7185",
      icon: "CR"
    },
    {
      title: "NebulaIM-Web",
      desc: "NebulaIM \u5206\u5e03\u5f0f\u5373\u65f6\u901a\u8baf\u7cfb\u7edf\u7684 React Web \u5ba2\u6237\u7aef\u3002",
      descEn: "React web client for the NebulaIM distributed instant messaging system.",
      url: "https://fizgrad.github.io/NebulaIM-Web/",
      tags: ["React", "TypeScript", "IM"],
      glow: "#7c8cff",
      icon: "NW"
    },
    {
      title: "BlackHoleSimulation",
      desc: "\u57fa\u4e8e\u539f\u751f WebGL2 \u6e32\u67d3\u7684\u53f2\u74e6\u897f\u9ed1\u6d1e\u6a21\u62df\uff0c\u5149\u7ebf\u5f2f\u66f2\u4e0e\u5438\u79ef\u76d8\u6548\u679c\u3002",
      descEn: "A Schwarzschild black hole simulation rendered in raw WebGL2, with light bending and accretion disk effects.",
      url: "https://fizgrad.github.io/BlackHoleSimulation/",
      tags: ["WebGL2", "Graphics", "Shader"],
      glow: "#8b5cf6",
      icon: "BH"
    },
    {
      title: "leetcode_graph_visualizer",
      desc: "\u5c06 LeetCode \u6d4b\u8bd5\u7528\u4f8b\u7ed8\u5236\u6210\u56fe\u7ed3\u6784\u7684\u53ef\u89c6\u5316\u5de5\u5177\uff0c\u65b9\u4fbf\u8c03\u8bd5\u56fe\u8bba\u9898\u76ee\u3002",
      descEn: "A tool that visualizes LeetCode test cases as graph structures, handy for debugging graph problems.",
      url: "https://fizgrad.github.io/leetcode_graph_visualizer/",
      tags: ["LeetCode", "Graph", "Web"],
      glow: "#34d399",
      icon: "LG"
    },
    {
      title: "Mermaid2PowerPoint",
      desc: "\u5c06 Mermaid \u6d41\u7a0b\u56fe\u5bfc\u51fa\u4e3a PowerPoint \u6f14\u793a\u6587\u7a3f\u7684\u5de5\u5177\u3002",
      descEn: "A tool that exports Mermaid diagrams into PowerPoint presentations.",
      url: "https://fizgrad.github.io/Mermaid2PowerPoint/",
      tags: ["Mermaid", "PPT", "Tool"],
      glow: "#f59e0b",
      icon: "M2"
    },
    {
      title: "comsoftWHU",
      desc: "\u6b66\u6c49\u5927\u5b66 comsoft \u7814\u7a76\u7ec4\u77e5\u8bc6\u5e93\u7f51\u7ad9\u3002",
      descEn: "Knowledge-base site for the comsoft research group at Wuhan University.",
      url: "https://comsoftwhu.github.io/",
      tags: ["HTML", "Academic", "Contrib"],
      glow: "#60a5fa",
      icon: "CS",
      contrib: true
    },
    {
      title: "WebRacingCar",
      desc: "\u6781\u7b80\u7684\u6d4f\u89c8\u5668 3D \u8d5b\u8f66\u6a21\u62df\u5668\uff0c\u57fa\u4e8e Babylon.js + Rapier3D \u7269\u7406\u5f15\u64ce\u3002",
      descEn: "A minimal browser-based 3D racing simulator built with Babylon.js + Rapier3D physics.",
      url: "https://fizgrad.github.io/WebRacingCar/",
      tags: ["Babylon.js", "Rapier3D", "Vite"],
      glow: "#22d3ee",
      icon: "RC"
    }
  ];

  var otherRepos = [
    {
      title: "NebulaIM",
      desc: "\u9ad8\u6027\u80fd\u5206\u5e03\u5f0f\u5373\u65f6\u901a\u8baf\u7cfb\u7edf\uff0cC++17 \u5b9e\u73b0\u3002",
      descEn: "High-performance distributed instant messaging system, implemented in C++17.",
      url: GITHUB + "/NebulaIM",
      tags: ["C++17", "Distributed", "High-Performance"],
      glow: "#7c8cff",
      icon: "NI"
    },
    {
      title: "UnwindTestSuite",
      desc: "\u8de8\u5171\u4eab\u5bf9\u8c61\u751f\u547d\u5468\u671f\u4e8b\u4ef6\u7684\u6808\u5c55\u5f00(stack unwinding)\u6d4b\u8bd5\u5957\u4ef6\u3002",
      descEn: "Test suite for stack unwinding across shared-object lifecycle events.",
      url: GITHUB + "/UnwindTestSuite",
      tags: ["C++", "Test", "Unwind"],
      glow: "#22d3ee",
      icon: "UT"
    },
    {
      title: "gobang-minmax-algorithm",
      desc: "\u57fa\u4e8e\u6781\u5c0f\u6781\u5927\u7b97\u6cd5(Minimax + Alpha-Beta \u526a\u679d)\u7684\u4e94\u5b50\u68cb AI\u3002",
      descEn: "A Gomoku (five-in-a-row) AI using Minimax with Alpha-Beta pruning.",
      url: GITHUB + "/gobang-minmax-algorithm",
      tags: ["C++", "AI", "Minimax"],
      glow: "#34d399",
      icon: "GB"
    },
    {
      title: "nand2TetrisCpp",
      desc: "Nand2Tetris(\u4ece\u4e0e\u975e\u95e8\u5230\u4fc4\u7f57\u65af\u65b9\u5757)\u786c\u4ef6\u4e0e\u8f6f\u4ef6\u6808\u7684 C++ \u5b9e\u73b0\u3002",
      descEn: "C++ implementation of the Nand2Tetris (from NAND to Tetris) hardware and software stack.",
      url: GITHUB + "/nand2TetrisCpp",
      tags: ["C++", "Nand2Tetris"],
      glow: "#f59e0b",
      icon: "N2"
    },
    {
      title: "dex2oat-CFGVisualizer",
      desc: "dex2oat \u7f16\u8bd1\u8fc7\u7a0b\u63a7\u5236\u6d41\u56fe(CFG)\u53ef\u89c6\u5316\u5de5\u5177\u3002",
      descEn: "Control-flow graph (CFG) visualizer for the dex2oat compilation process.",
      url: GITHUB + "/dex2oat-CFGVisualizer",
      tags: ["Python", "CFG", "ART"],
      glow: "#f472b6",
      icon: "DC"
    },
    {
      title: "ControlFlowStatistics",
      desc: "\u63a7\u5236\u6d41\u56fe(CFG)\u7edf\u8ba1\u5206\u6790\u5de5\u5177\uff0c\u91cf\u5316\u7a0b\u5e8f\u63a7\u5236\u6d41\u7279\u5f81\u3002",
      descEn: "Control-flow graph (CFG) statistics & analysis tool that quantifies program control-flow features.",
      url: GITHUB + "/ControlFlowStatistics",
      tags: ["C++", "CFG", "Analysis"],
      glow: "#38bdf8",
      icon: "CF"
    }
  ];

  var recommend = [
    {
      title: "Starki",
      desc: "Starki 的个人主页。",
      descEn: "Starki's personal homepage.",
      url: "https://starkij.github.io/",
      tags: ["Homepage"],
      glow: "#f472b6",
      icon: "SK",
      recommend: true
    },
    {
      title: "Yfs's Box",
      desc: "Yfs 的个人主页。",
      descEn: "Yfs's personal homepage.",
      url: "https://yfsbox.github.io/",
      tags: ["Homepage"],
      glow: "#2dd4bf",
      icon: "YB",
      recommend: true
    },
    {
      title: "icecoins",
      desc: "技术仙人",
      descEn: "Tech immortal",
      url: "https://github.com/icecoins",
      tags: ["GitHub"],
      glow: "#38bdf8",
      icon: "IC",
      recommend: true
    },
    {
      title: "Gensoul",
      desc: "Life is about to rain.",
      descEn: "Life is about to rain.",
      url: "https://github.com/LeisureGensoul",
      tags: ["GitHub"],
      glow: "#a78bfa",
      icon: "GS",
      recommend: true
    }
  ];

  var lang = detectLang();
  var dict = I18N[lang];
  var phrases = dict.phrases;
  var typePi = 0, typeCi = 0, typeDeleting = false, typeTimer = null;
  var blogPosts = null;

  function detectLang() {
    var stored = localStorage.getItem("lang");
    if (stored === "en" || stored === "zh") return stored;
    return (navigator.language || "zh").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
  }

  function t(key) { return I18N[lang][key]; }
  function descOf(item) { return lang === "en" ? (item.descEn || item.desc) : item.desc; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "style") node.setAttribute("style", attrs[k]);
        else if (k.indexOf("data-") === 0) node.setAttribute(k, attrs[k]);
        else node[k] = attrs[k];
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function tagChip(text) {
    return el("span", { class: "tag" }, text);
  }

  function arrow() {
    return el("span", {
      class: "card-arrow",
      innerHTML: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M9 7h8v8"/></svg>'
    });
  }

  function buildCard(item) {
    var card = el("article", { class: "card" });
    card.style.setProperty("--card-glow", item.glow);

    var top = el("div", { class: "card-top" }, [
      el("div", { class: "card-icon" }, item.icon),
      arrow()
    ]);

    var title = el("h3", { class: "card-title" }, item.title);
    var header = el("div", { class: "card-head" }, [title]);
    if (item.contrib) {
      header.appendChild(el("span", { class: "badge contrib" }, t("contrib")));
    }
    if (item.recommend) {
      header.appendChild(el("span", { class: "badge recommend" }, t("recBadge")));
    }
    var desc = el("p", { class: "card-desc" }, descOf(item));

    var tags = el("div", { class: "card-tags" }, (item.tags || []).map(tagChip));

    var link = el("a", {
      class: "card-link",
      href: item.url,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": item.title + " (opens in new tab)"
    });

    card.appendChild(top);
    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(tags);
    card.appendChild(link);
    return card;
  }

  function buildCtaCard() {
    var card = el("a", {
      class: "card cta-card",
      href: "mailto:davidchenms@hotmail.com",
      "aria-label": t("ctaBtn")
    });
    card.appendChild(el("span", { class: "cta-plus", "aria-hidden": "true" }, "+"));
    card.appendChild(el("span", { class: "cta-title" }, t("ctaTitle")));
    card.appendChild(el("span", { class: "cta-text" }, t("ctaText")));
    card.appendChild(el("span", { class: "cta-btn" }, t("ctaBtn")));
    return card;
  }

  function buildBlogCard(post) {
    var card = el("article", { class: "card blog-card" });
    card.style.setProperty("--card-glow", "#c084fc");

    var top = el("div", { class: "card-top" }, [
      el("div", { class: "card-icon" }, post.slug.charAt(0).toUpperCase()),
      el("time", { class: "card-date", datetime: post.date }, post.date)
    ]);

    var title = el("h3", { class: "card-title" }, post.title);
    var descText = lang === "en" ? (post.descriptionEn || post.description) : post.description;
    var desc = el("p", { class: "card-desc" }, descText);

    var tags = el("div", { class: "card-tags" }, [
      el("span", { class: "tag blog-tag" }, t("blogReadMore"))
    ]);

    var link = el("a", {
      class: "card-link",
      href: "blog/post.html?slug=" + post.slug,
      target: "_blank",
      rel: "noopener",
      "aria-label": post.title + " (opens in new tab)"
    });

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(tags);
    card.appendChild(link);
    return card;
  }

  function loadBlogPosts(callback) {
    if (blogPosts) return callback(blogPosts);
    fetch("blog/posts.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { blogPosts = data; callback(blogPosts); });
  }

  function renderBlogCards() {
    var grid = document.getElementById("blog-grid");
    if (!grid || !blogPosts) return;
    grid.innerHTML = "";
    blogPosts.forEach(function (post) {
      grid.appendChild(buildBlogCard(post));
    });
  }

  function renderCards(forceReveal) {
    var pagesGrid = document.getElementById("pages-grid");
    var reposGrid = document.getElementById("repos-grid");
    var recGrid = document.getElementById("rec-grid");
    pagesGrid.innerHTML = "";
    reposGrid.innerHTML = "";
    if (recGrid) recGrid.innerHTML = "";
    pagesProjects.forEach(function (p) { pagesGrid.appendChild(buildCard(p)); });
    otherRepos.forEach(function (r) { reposGrid.appendChild(buildCard(r)); });
    if (recGrid) {
      recommend.forEach(function (r) { recGrid.appendChild(buildCard(r)); });
      recGrid.appendChild(buildCtaCard());
    }
    if (forceReveal) {
      document.querySelectorAll(".card").forEach(function (c) { c.classList.add("reveal"); });
    } else {
      observeCards();
    }
  }

  function observeCards() {
    var cards = document.querySelectorAll(".card");
    if (!("IntersectionObserver" in window)) {
      cards.forEach(function (c) { c.classList.add("reveal"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var target = entry.target;
          var delay = Array.from(target.parentElement.children).indexOf(target) % 6;
          target.style.transitionDelay = (delay * 70) + "ms";
          target.classList.add("reveal");
          io.unobserve(target);
        }
      });
    }, { threshold: 0.12 });
    cards.forEach(function (c) { io.observe(c); });
  }

  function updStaticText() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = I18N[lang][el.getAttribute("data-i18n")];
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", I18N[lang][el.getAttribute("data-i18n-aria")]);
    });
    var toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.textContent = t("langBtn");
      toggle.setAttribute("aria-label", t("langBtnAria"));
    }
  }

  function resetTyping() {
    typePi = 0;
    typeCi = 0;
    typeDeleting = false;
    if (typeTimer) clearTimeout(typeTimer);
    var host = document.getElementById("typed");
    if (host) host.textContent = "";
  }

  function startTyping() {
    resetTyping();
    typeTick();
  }

  function typeTick() {
    var host = document.getElementById("typed");
    if (!host) return;
    var word = phrases[typePi] || "";
    if (!typeDeleting) {
      typeCi++;
      host.textContent = word.slice(0, typeCi);
      if (typeCi >= word.length) { typeDeleting = true; typeTimer = setTimeout(typeTick, 1600); return; }
    } else {
      typeCi--;
      host.textContent = word.slice(0, typeCi);
      if (typeCi <= 0) { typeDeleting = false; typePi = (typePi + 1) % phrases.length; }
    }
    typeTimer = setTimeout(typeTick, typeDeleting ? 45 : 80);
  }

  function applyLang(l, isInitial) {
    lang = l;
    dict = I18N[lang];
    phrases = dict.phrases;
    document.documentElement.lang = dict.lang;
    updStaticText();
    renderCards(!isInitial);
    if (!isInitial) {
      renderBlogCards();
      document.querySelectorAll(".card").forEach(function (c) { c.classList.add("reveal"); });
    }
    startTyping();
    localStorage.setItem("lang", lang);
  }

  function navScroll() {
    var nav = document.querySelector(".nav");
    var onScroll = function () {
      if (window.scrollY > 20) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function footerYear() {
    document.getElementById("year").textContent = new Date().getFullYear();
  }

  function bgCanvas() {
    var canvas = document.getElementById("bg-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var w, h, dpr, nodes;
    var COUNT = window.innerWidth < 640 ? 28 : 60;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = Math.floor(window.innerWidth * dpr);
      h = canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    }

    function initNodes() {
      nodes = [];
      for (var i = 0; i < COUNT; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25 * dpr,
          vy: (Math.random() - 0.5) * 0.25 * dpr,
          r: (Math.random() * 1.6 + 0.4) * dpr
        });
      }
    }

    var mouse = { x: -9999, y: -9999 };
    window.addEventListener("mousemove", function (e) {
      mouse.x = e.clientX * dpr;
      mouse.y = e.clientY * dpr;
    });
    window.addEventListener("mouseleave", function () {
      mouse.x = mouse.y = -9999;
    });

    var LINK = 140 * dpr;

    var raf;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;

        var dxm = n.x - mouse.x, dym = n.y - mouse.y;
        var dm = Math.hypot(dxm, dym);
        if (dm < 120 * dpr) {
          n.x += (dxm / dm) * 0.8 * dpr;
          n.y += (dym / dm) * 0.8 * dpr;
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(124,140,255,0.55)";
        ctx.fill();

        for (var j = i + 1; j < nodes.length; j++) {
          var m = nodes[j];
          var dx = n.x - m.x, dy = n.y - m.y;
          var dist = Math.hypot(dx, dy);
          if (dist < LINK) {
            var a = (1 - dist / LINK) * 0.22;
            ctx.strokeStyle = "rgba(124,140,255," + a + ")";
            ctx.lineWidth = 1 * dpr;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    initNodes();
    if (reduce) { draw(); cancelAnimationFrame(raf); }
    else draw();

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(); initNodes(); }, 200);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyLang(lang, true);
    navScroll();
    footerYear();
    bgCanvas();
    loadBlogPosts(function () {
      renderBlogCards();
      observeCards();
    });
    var toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        applyLang(lang === "zh" ? "en" : "zh", false);
      });
    }
  });
})();
