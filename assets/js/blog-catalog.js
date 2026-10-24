(function () {
  "use strict";

  var categories = [
    {
      id: "languages", title: "编程语言与算法", titleEn: "Languages & Algorithms",
      description: "C++、数据结构、JVM 与 WebAssembly",
      descriptionEn: "C++, data structures, the JVM, and WebAssembly.", color: "#7c8cff"
    },
    {
      id: "compilers", title: "编译器与静态分析", titleEn: "Compilers & Static Analysis",
      description: "Clang、LLVM、MLIR 与编译器算法",
      descriptionEn: "Clang, LLVM, MLIR, and compiler algorithms.", color: "#22d3ee"
    },
    {
      id: "gpu", title: "GPU 与 CUDA", titleEn: "GPU & CUDA",
      description: "CUDA 编程、并行原语与 GPU 编译",
      descriptionEn: "CUDA programming, parallel primitives, and GPU compilation.", color: "#34d399"
    },
    {
      id: "ai", title: "AI 与张量编译", titleEn: "AI & Tensor Compilation",
      description: "大模型、AI Compiler、张量计算与融合",
      descriptionEn: "LLMs, AI compilers, tensor computation, and fusion.", color: "#c084fc"
    },
    {
      id: "linux", title: "Linux 与体系结构", titleEn: "Linux & Architecture",
      description: "操作系统、ARM64、虚拟化与 GPU 驱动",
      descriptionEn: "Operating systems, ARM64, virtualization, and GPU drivers.", color: "#f59e0b"
    },
    {
      id: "android", title: "Android 系统", titleEn: "Android Systems",
      description: "Android 架构、系统优化与互联互通",
      descriptionEn: "Android architecture, system optimization, and connectivity.", color: "#2dd4bf"
    },
    {
      id: "backend", title: "后端与数据", titleEn: "Backend & Data",
      description: "网络、数据库、C++ 服务与 NebulaIM",
      descriptionEn: "Networking, databases, C++ services, and NebulaIM.", color: "#fb7185"
    }
  ];
  var other = {
    id: "other", title: "其他文章", titleEn: "Other Articles",
    description: "尚未归入主题的文章", descriptionEn: "Articles not yet assigned to a topic.", color: "#9a9aac"
  };
  var all = {
    id: "all", title: "全部文章", titleEn: "All Articles",
    description: "浏览与搜索所有主题的文章", descriptionEn: "Browse and search articles across all topics.", color: "#7c8cff"
  };

  function category(id) {
    if (id === "all") return all;
    if (id === "other") return other;
    return categories.find(function (item) { return item.id === id; }) || null;
  }

  function categoryFor(post) {
    var found = category(post.category);
    return found && found.id !== "all" ? found : other;
  }

  function groups(posts) {
    return categories.concat([other]).map(function (item) {
      return {
        category: item,
        posts: posts.filter(function (post) { return categoryFor(post).id === item.id; })
      };
    }).filter(function (group) { return group.posts.length > 0; });
  }

  function localized(item, field, lang) {
    return (lang === "en" && item[field + "En"]) || item[field] || "";
  }

  function readState(search) {
    var params = new URLSearchParams(search);
    var page = params.get("page") || params.get("blogPage") || "1";
    var id = params.get("category") || "all";
    return {
      category: category(id) ? id : "all",
      page: /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1,
      query: (params.get("q") || params.get("blogSearch") || "").trim()
    };
  }

  function listURL(state, base) {
    var params = new URLSearchParams();
    if (state.category && state.category !== "all") params.set("category", state.category);
    if (state.page > 1) params.set("page", String(state.page));
    if (state.query) params.set("q", state.query);
    var query = params.toString();
    return (base || "") + "index.html" + (query ? "?" + query : "");
  }

  function postURL(post, state) {
    var params = new URLSearchParams({ slug: post.slug, category: state.category });
    if (state.page > 1) params.set("page", String(state.page));
    if (state.query) params.set("q", state.query);
    return "post.html?" + params.toString();
  }

  function detectLang() {
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "zh" || saved === "en") return saved;
    } catch (e) {}
    return (navigator.language || "zh").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
  }

  function loadPosts(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("Could not load blog posts");
      return response.json();
    }).then(function (posts) {
      if (!Array.isArray(posts)) throw new Error("Invalid blog post list");
      var seen = new Set();
      posts.forEach(function (post) {
        if (!post || typeof post.slug !== "string" || !/^[\w-]+$/.test(post.slug)
          || typeof post.title !== "string" || seen.has(post.slug)) throw new Error("Invalid blog post");
        seen.add(post.slug);
      });
      return posts;
    });
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", name === "file"
      ? "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6"
      : "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z M3 8h18");
    svg.appendChild(path);
    return svg;
  }

  window.BlogCatalog = {
    categories: categories, category: category, categoryFor: categoryFor, groups: groups,
    localized: localized, readState: readState, listURL: listURL, postURL: postURL,
    detectLang: detectLang, loadPosts: loadPosts, icon: icon
  };
})();
