(function () {
  "use strict";
  var catalog = window.BlogCatalog;
  var lang = catalog.detectLang();
  var state = catalog.readState(window.location.search);
  var posts = null;
  var failed = false;
  var PAGE_SIZE = 9;
  var I18N = {
    zh: {
      home: "主页", blog: "博客", backFolders: "← 主题目录", breadcrumb: "博客导航",
      topic: "主题", search: "搜索文章", searchPlaceholder: "标题或简介",
      pagination: "文章分页", previous: "上一页", next: "下一页", page: "第 {page} 页",
      results: "第 {start}–{end} 篇，共 {total} 篇", noResults: "共 0 篇",
      empty: "没有找到相关文章", loading: "加载中...", error: "文章列表加载失败",
      retry: "重试", skip: "跳到主内容", footerBuilt: "使用 GLM-5.2 构建"
    },
    en: {
      home: "Home", blog: "Blog", backFolders: "← Topics", breadcrumb: "Blog navigation",
      topic: "Topic", search: "Search articles", searchPlaceholder: "Title or description",
      pagination: "Article pagination", previous: "Previous", next: "Next", page: "Page {page}",
      results: "{start}–{end} of {total} articles", noResults: "0 articles",
      empty: "No matching articles", loading: "Loading...", error: "Could not load articles",
      retry: "Retry", skip: "Skip to main content", footerBuilt: "Built with GLM-5.2"
    }
  };
  var list = document.getElementById("blog-list");
  var input = document.getElementById("blog-search");
  var select = document.getElementById("blog-category");
  var pagination = document.getElementById("blog-pagination");

  function t(key, values) {
    return I18N[lang][key].replace(/\{(\w+)\}/g, function (_, name) { return values[name]; });
  }

  function node(tag, className, text) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (text) item.textContent = text;
    return item;
  }

  function writeLocation(push) {
    var url = new URL(catalog.listURL(state), window.location.href);
    if (url.href !== window.location.href) {
      window.history[push ? "pushState" : "replaceState"](window.history.state, "", url.href);
    }
  }

  function filteredPosts() {
    var terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    return posts.filter(function (post) {
      var category = catalog.categoryFor(post);
      if (state.category !== "all" && category.id !== state.category) return false;
      var text = [post.title, post.titleEn, post.description, post.descriptionEn, post.slug,
        category.title, category.titleEn].join(" ").toLowerCase();
      return terms.every(function (term) { return text.indexOf(term) !== -1; });
    });
  }

  function buildRow(post, index) {
    var category = catalog.categoryFor(post);
    var row = node("li", "blog-article");
    var link = node("a", "blog-article-link");
    link.href = catalog.postURL(post, state);
    link.style.setProperty("--topic-color", category.color);
    var icon = node("span", "blog-file-icon");
    icon.appendChild(catalog.icon("file"));
    var body = node("div", "blog-article-body");
    body.appendChild(node("h2", "blog-article-title", catalog.localized(post, "title", lang)));
    body.appendChild(node("p", "blog-article-description", catalog.localized(post, "description", lang)));
    if (state.category === "all") body.appendChild(node("span", "blog-article-topic", catalog.localized(category, "title", lang)));
    var number = node("span", "blog-article-number", String(index + 1).padStart(2, "0"));
    number.setAttribute("aria-hidden", "true");
    var arrow = node("span", "blog-article-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    link.append(icon, body, number, arrow);
    row.appendChild(link);
    return row;
  }

  function pageNumbers(total) {
    if (total <= 7) return Array.from({ length: total }, function (_, i) { return i + 1; });
    var pages = [1];
    var start = Math.max(2, Math.min(state.page - 1, total - 4));
    var end = Math.min(total - 1, Math.max(state.page + 1, 5));
    if (start > 2) pages.push(null);
    for (var page = start; page <= end; ++page) pages.push(page);
    if (end < total - 1) pages.push(null);
    pages.push(total);
    return pages;
  }

  function render() {
    var category = catalog.category(state.category);
    var title = catalog.localized(category, "title", lang);
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = title + " - Fizgrad";
    document.querySelector('meta[name="description"]').content = catalog.localized(category, "description", lang);
    document.querySelectorAll("[data-i18n]").forEach(function (item) { item.textContent = t(item.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (item) { item.setAttribute("aria-label", t(item.dataset.i18nAria)); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (item) { item.placeholder = t(item.dataset.i18nPlaceholder); });
    document.getElementById("blog-category-title").textContent = title;
    document.getElementById("blog-current-category").textContent = title;
    document.getElementById("blog-category-description").textContent = catalog.localized(category, "description", lang);
    document.getElementById("blog-heading-icon").style.color = category.color;
    var toggle = document.getElementById("lang-toggle");
    toggle.textContent = lang === "en" ? "中" : "EN";
    toggle.setAttribute("aria-label", lang === "en" ? "切换到中文" : "Switch to English");

    select.replaceChildren();
    var options = [catalog.category("all")].concat(catalog.categories);
    if (state.category === "other" || (posts && catalog.groups(posts).some(function (group) { return group.category.id === "other"; }))) {
      options.push(catalog.category("other"));
    }
    options.forEach(function (item) {
      var option = node("option", "", catalog.localized(item, "title", lang));
      option.value = item.id;
      select.appendChild(option);
    });
    select.value = state.category;
    input.value = state.query;
    document.getElementById("blog-retry").hidden = !failed;
    var status = document.getElementById("blog-status");
    if (!posts) {
      status.textContent = t(failed ? "error" : "loading");
      list.setAttribute("aria-busy", String(!failed));
      return;
    }

    var matches = filteredPosts();
    var total = Math.ceil(matches.length / PAGE_SIZE);
    state.page = Math.max(1, Math.min(state.page, total || 1));
    var start = (state.page - 1) * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, matches.length);
    list.replaceChildren();
    list.start = start + 1;
    matches.slice(start, end).forEach(function (post, i) { list.appendChild(buildRow(post, start + i)); });
    list.setAttribute("aria-busy", "false");
    status.textContent = matches.length ? t("results", { start: start + 1, end: end, total: matches.length }) : t("noResults");
    document.getElementById("blog-empty").hidden = matches.length !== 0;
    pagination.hidden = total <= 1;
    document.getElementById("blog-prev").disabled = state.page <= 1;
    document.getElementById("blog-next").disabled = state.page >= total;
    var pages = document.getElementById("blog-page-list");
    pages.replaceChildren();
    pageNumbers(total).forEach(function (page) {
      if (page === null) {
        var dots = node("span", "blog-page-ellipsis", "…");
        dots.setAttribute("aria-hidden", "true");
        pages.appendChild(dots);
        return;
      }
      var button = node("button", "blog-page", String(page));
      button.type = "button";
      button.dataset.blogPage = String(page);
      button.setAttribute("aria-label", t("page", { page: page }));
      button.setAttribute("aria-controls", "blog-list");
      if (page === state.page) button.setAttribute("aria-current", "page");
      pages.appendChild(button);
    });
  }

  function load() {
    failed = false;
    render();
    catalog.loadPosts("posts.json").then(function (data) {
      posts = data;
      render();
      writeLocation(false);
    }).catch(function () { failed = true; render(); });
  }

  input.addEventListener("input", function () {
    state.query = input.value;
    state.page = 1;
    list.style.minHeight = "";
    render();
    writeLocation(false);
  });
  select.addEventListener("change", function () {
    state.category = select.value;
    state.page = 1;
    list.style.minHeight = "";
    render();
    writeLocation(true);
  });
  pagination.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button || button.disabled || !posts) return;
    var action = button.dataset.blogAction;
    var page = action === "prev" ? state.page - 1 : action === "next" ? state.page + 1 : Number(button.dataset.blogPage);
    if (page === state.page) return;
    // Keep a short last page from shrinking the document and moving the viewport.
    list.style.minHeight = list.getBoundingClientRect().height + "px";
    state.page = page;
    render();
    writeLocation(true);
    var focus = action ? document.getElementById("blog-" + action) : null;
    if (!focus || focus.disabled) focus = pagination.querySelector('[aria-current="page"]');
    if (focus) focus.focus({ preventScroll: true });
  });
  document.getElementById("lang-toggle").addEventListener("click", function () {
    lang = lang === "zh" ? "en" : "zh";
    try { localStorage.setItem("lang", lang); } catch (e) {}
    render();
  });
  document.getElementById("blog-retry").addEventListener("click", load);
  window.addEventListener("popstate", function () {
    state = catalog.readState(window.location.search);
    list.style.minHeight = "";
    render();
    if (posts) writeLocation(false);
  });
  document.getElementById("year").textContent = new Date().getFullYear();
  document.getElementById("blog-heading-icon").appendChild(catalog.icon("folder"));
  load();
})();
