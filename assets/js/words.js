(function () {
  "use strict";
  var Core = window.WordsCore;
  if (!Core) return;
  var labels = {
    zh: {
      title: "单词练习", pageTitle: "单词练习 - Fizgrad", skip: "跳到主内容", home: "← 主页", homeAria: "返回主页", backHome: "← 返回主页",
      library: "查看词表 ↗", loading: "正在加载词表…", loadError: "词表加载失败，请重试。", retry: "重新加载",
      source: "GRE · {count} 个单词 · 英文释义", todayCount: "今日练过", seenCount: "本模式已练", mistakeCount: "本模式待复习", wordUnit: "词",
      modeLabel: "练习模式", choice: "选择释义", spelling: "释义拼写", poolLabel: "练习范围", poolToday: "今日 10 词", poolAll: "全部词表", poolMistakes: "错词复习", restart: "重新组题",
      choosePrompt: "选择对应的英文释义", spellPrompt: "根据释义，拼写英文单词", roundProgress: "本轮进度", spellLabel: "输入英文单词", spellPlaceholder: "输入英文单词", check: "检查答案",
      forgot: "想不起来", next: "下一词 →", finish: "查看本轮结果 →", correct: "答对了", incorrect: "记住这一词，下次再试", revealed: "答案已显示，已加入复习",
      emptyTitle: "还没有待复习的错词", emptyText: "这个模式下答错的单词会出现在这里。", startToday: "练习今日单词",
      roundDone: "本轮完成", score: "答对 {correct} / {total} 词", summaryMistakes: "还有 {count} 词可以再巩固一下。", summaryPerfect: "本轮全部答对。", again: "再练一轮", reviewRound: "再练本轮错词",
      storageNote: "进度仅保存在当前浏览器；选择与拼写分别记录。", storageBlocked: "浏览器未允许保存进度，本轮仍可练习；关闭页面后进度可能丢失。",
      libraryTitle: "单词表", searchLabel: "搜索单词或释义", searchPlaceholder: "搜索单词或英文释义…", searchEmpty: "没有匹配的单词。", searchCount: "{count} / {total} 词", practiceWord: "练这一词", practiceAria: "练习 {word}"
    },
    en: {
      title: "Word Practice", pageTitle: "Word Practice - Fizgrad", skip: "Skip to main content", home: "← Home", homeAria: "Back to home", backHome: "← Back to home",
      library: "Browse words ↗", loading: "Loading vocabulary…", loadError: "Could not load the vocabulary. Please try again.", retry: "Retry",
      source: "GRE · {count} words · English definitions", todayCount: "Practiced today", seenCount: "Seen in this mode", mistakeCount: "Review in this mode", wordUnit: "words",
      modeLabel: "Practice mode", choice: "Meaning choices", spelling: "Spelling", poolLabel: "Word pool", poolToday: "Today's 10 words", poolAll: "All words", poolMistakes: "Mistakes", restart: "New round",
      choosePrompt: "Choose the matching definition", spellPrompt: "Spell the word from its definition", roundProgress: "Round progress", spellLabel: "Type the English word", spellPlaceholder: "Type the English word", check: "Check answer",
      forgot: "Show answer", next: "Next word →", finish: "See results →", correct: "Correct", incorrect: "Keep this word for another try", revealed: "Answer revealed; added to review",
      emptyTitle: "No words to review yet", emptyText: "Words you miss in this mode will appear here.", startToday: "Practice today's words",
      roundDone: "Round complete", score: "{correct} / {total} words correct", summaryMistakes: "Give these {count} words another try.", summaryPerfect: "Every answer in this round was correct.", again: "Another round", reviewRound: "Retry this round's mistakes",
      storageNote: "Progress stays in this browser; choices and spelling are tracked separately.", storageBlocked: "Browser storage is unavailable. You can practice, but progress may be lost when you close the page.",
      libraryTitle: "Word list", searchLabel: "Search words or definitions", searchPlaceholder: "Search words or definitions…", searchEmpty: "No matching words.", searchCount: "{count} / {total} words", practiceWord: "Practice", practiceAria: "Practice {word}"
    }
  };
  var storage;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  var lang;
  try { lang = storage && storage.getItem("lang"); } catch (e) {}
  if (lang !== "en" && lang !== "zh") lang = (navigator.language || "zh").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
  var storageWorks = Core.storageAvailable(storage);
  var progress = Core.readProgress(storage);
  var words = [], knownIDs = new Set(), session = null, loading = false, failed = false;
  var parameters = new URLSearchParams(location.search);
  var mode = parameters.get("mode") === "spelling" ? "spelling" : "choice";
  var pool = ["today", "all", "mistakes"].indexOf(parameters.get("pool")) >= 0 ? parameters.get("pool") : "today";
  function $(id) { return document.getElementById(id); }
  function t(key, values) {
    var text = labels[lang][key] || key;
    Object.keys(values || {}).forEach(function (name) { text = text.replace("{" + name + "}", values[name]); });
    return text;
  }
  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function currentWord() { return session && session.words[session.index]; }

  function updateStats() {
    var today = progress.days[Core.dateKey()];
    $("words-today-count").textContent = today ? Object.keys(today.ids).filter(function (id) { return knownIDs.has(id); }).length : 0;
    $("words-seen-count").textContent = words.filter(function (word) { return Core.recordFor(progress, word.id, mode).attempts > 0; }).length;
    $("words-mistake-count").textContent = words.filter(function (word) { return Core.recordFor(progress, word.id, mode).needsReview; }).length;
    $("words-total-count").textContent = "/ " + words.length;
    $("words-storage-note").textContent = t(storageWorks ? "storageNote" : "storageBlocked");
    $("words-storage-note").classList.toggle("is-warning", !storageWorks);
    document.querySelectorAll("[data-mode]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.mode === mode)); });
    $("words-pool").value = pool;
  }

  function renderFeedback(result) {
    var box = $("words-feedback");
    box.hidden = !result;
    if (!result) { box.replaceChildren(); return; }
    box.classList.toggle("is-correct", result.correct);
    var verdict = element("p", t(result.revealed ? "revealed" : result.correct ? "correct" : "incorrect"));
    var answer = element("p", currentWord().word + " — " + currentWord().definition);
    answer.lang = "en";
    box.replaceChildren(verdict, answer);
  }

  function renderQuestion(focus) {
    if (!session || session.phase !== "question") return;
    var word = currentWord();
    var result = session.results[session.index];
    var spelling = mode === "spelling";
    $("words-question-label").textContent = t(spelling ? "spellPrompt" : "choosePrompt");
    $("words-question-count").textContent = (session.index + 1) + " / " + session.words.length;
    $("words-question-title").textContent = spelling ? word.definition : word.word;
    $("words-question-title").classList.toggle("is-definition", spelling);
    $("words-part").hidden = spelling;
    $("words-part").textContent = word.partOfSpeech;
    $("words-options").hidden = spelling;
    $("words-spell-form").hidden = !spelling;
    $("words-answer").disabled = Boolean(result);
    $("words-submit").disabled = Boolean(result) || !$("words-answer").value.trim();
    $("words-skip").disabled = Boolean(result);
    $("words-next").hidden = !result;
    $("words-next").textContent = t(session.index === session.words.length - 1 ? "finish" : "next");
    var track = document.querySelector(".words-progress");
    track.setAttribute("aria-valuemax", session.words.length);
    track.setAttribute("aria-valuenow", session.results.length);
    $("words-progress-fill").style.width = (100 * session.results.length / session.words.length) + "%";
    $("words-options").replaceChildren();
    if (!spelling) {
      session.options.forEach(function (option, index) {
        var button = element("button", undefined, "words-option");
        button.type = "button"; button.lang = "en";
        button.dataset.wordId = option.id;
        button.disabled = Boolean(result);
        button.append(element("span", "ABCD"[index], "words-option-letter"), element("span", option.definition));
        if (result) {
          var correct = option.id === word.id;
          var wrong = !correct && result.selected === option.id;
          button.classList.toggle("is-correct", correct);
          button.classList.toggle("is-wrong", wrong);
          button.classList.toggle("is-muted", !correct && !wrong);
          if (correct || wrong) {
            var indicator = element("span", correct ? "✓" : "×", "words-option-result");
            indicator.setAttribute("aria-hidden", "true"); button.appendChild(indicator);
          }
        }
        button.addEventListener("click", function () { submitAnswer(option.id === word.id, { selected: option.id }); });
        $("words-options").appendChild(button);
      });
    }
    renderFeedback(result);
    if (focus && spelling && !result) $("words-answer").focus({ preventScroll: true });
  }

  function renderSummary() {
    if (!session || session.phase !== "summary") return;
    var correct = session.results.filter(function (r) { return r.correct; }).length;
    var mistakes = session.words.filter(function (word, index) { return !session.results[index].correct; });
    $("words-summary-title").textContent = correct + " / " + session.words.length;
    $("words-summary-title").setAttribute("aria-label", t("score", { correct: correct, total: session.words.length }));
    $("words-summary-text").textContent = mistakes.length ? t("summaryMistakes", { count: mistakes.length }) : t("summaryPerfect");
    $("words-review-round").hidden = !mistakes.length;
    $("words-round-mistakes").replaceChildren();
    mistakes.forEach(function (word) {
      var item = element("li"); item.lang = "en";
      item.append(element("strong", word.word), element("p", word.definition));
      $("words-round-mistakes").appendChild(item);
    });
  }

  function renderLibrary() {
    var query = $("words-search").value.trim().toLowerCase();
    var filtered = words.filter(function (word) { return (word.word + " " + word.definition).toLowerCase().indexOf(query) !== -1; });
    var list = $("words-library-list");
    var scroll = list.scrollTop;
    var fragment = document.createDocumentFragment();
    filtered.forEach(function (word) {
      var item = element("li");
      var content = element("div"); content.lang = "en";
      content.append(element("strong", word.word), element("p", word.definition));
      var button = element("button", t("practiceWord"), "words-text-button"); button.type = "button";
      button.setAttribute("aria-label", t("practiceAria", { word: word.word }));
      button.addEventListener("click", function () {
        startSession([word]);
        $("words-quiz").scrollIntoView({ block: "start" });
      });
      item.append(content, button); fragment.appendChild(item);
    });
    list.replaceChildren(fragment); list.scrollTop = scroll;
    $("words-search-empty").hidden = Boolean(filtered.length);
    $("words-search-count").textContent = t("searchCount", { count: filtered.length, total: words.length });
  }

  function applyLanguage() {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = t("pageTitle");
    document.querySelectorAll("[data-word-i18n]").forEach(function (node) { node.textContent = t(node.dataset.wordI18n); });
    document.querySelectorAll("[data-word-aria]").forEach(function (node) { node.setAttribute("aria-label", t(node.dataset.wordAria)); });
    document.querySelectorAll("[data-word-placeholder]").forEach(function (node) { node.placeholder = t(node.dataset.wordPlaceholder); });
    $("lang-toggle").textContent = lang === "zh" ? "EN" : "中";
    $("lang-toggle").setAttribute("aria-label", lang === "zh" ? "Switch to English" : "切换到中文");
    $("words-source").textContent = words.length ? t("source", { count: words.length }) : "GRE";
    $("words-loading-text").textContent = t(failed ? "loadError" : "loading");
    updateStats(); renderQuestion(false); renderSummary();
    if (words.length) renderLibrary();
  }

  function startSession(selected, focus) {
    if (!words.length) return;
    if (storageWorks) progress = Core.readProgress(storage);
    var batch = selected || Core.sessionWords(words, progress, mode, pool);
    session = { words: batch, index: 0, results: [], phase: batch.length ? "question" : "empty", options: [] };
    $("words-answer").value = "";
    $("words-quiz").hidden = !batch.length;
    $("words-empty").hidden = Boolean(batch.length);
    $("words-summary").hidden = true;
    if (batch.length && mode === "choice") session.options = Core.choicesFor(batch[0], words);
    updateStats(); renderQuestion(focus);
  }

  function submitAnswer(correct, detail) {
    if (!session || session.phase !== "question" || session.results[session.index]) return;
    var result = { correct: correct, selected: detail && detail.selected, revealed: Boolean(detail && detail.revealed) };
    session.results.push(result);
    if (storageWorks) progress = Core.readProgress(storage);
    progress = Core.recordAnswer(progress, currentWord().id, mode, correct);
    if (!Core.saveProgress(storage, progress)) storageWorks = false;
    updateStats(); renderQuestion(false);
    $("words-next").focus({ preventScroll: true });
  }

  function nextQuestion() {
    if (!session || session.phase !== "question" || !session.results[session.index]) return;
    if (session.index === session.words.length - 1) {
      session.phase = "summary";
      $("words-quiz").hidden = true; $("words-summary").hidden = false;
      renderSummary(); $("words-summary-title").focus({ preventScroll: true });
      return;
    }
    session.index++;
    session.options = mode === "choice" ? Core.choicesFor(currentWord(), words) : [];
    $("words-answer").value = "";
    renderQuestion(true);
    if (mode === "choice") $("words-options").querySelector("button").focus({ preventScroll: true });
  }

  function load() {
    if (loading) return;
    loading = true; failed = false;
    $("words-loading").hidden = false; $("words-retry").hidden = true;
    $("words-loading-text").textContent = t("loading");
    Core.loadWords().then(function (value) {
      words = value; knownIDs = new Set(words.map(function (word) { return word.id; }));
      loading = false; $("words-loading").hidden = true; $("words-app").hidden = false;
      $("words-library-count").textContent = words.length;
      applyLanguage();
      var requested = words.find(function (word) { return word.id === Core.normalizeAnswer(parameters.get("word")); });
      if (requested) {
        var batch = Core.sessionWords(words, progress, mode, "today");
        batch = [requested].concat(batch.filter(function (word) { return word.id !== requested.id; })).slice(0, 10);
        startSession(batch);
      } else startSession();
    }).catch(function () {
      loading = false; failed = true; $("words-loading-text").textContent = t("loadError"); $("words-retry").hidden = false;
    });
  }

  $("year").textContent = new Date().getFullYear();
  $("lang-toggle").addEventListener("click", function () {
    lang = lang === "zh" ? "en" : "zh";
    try { if (storage) storage.setItem("lang", lang); } catch (e) {}
    applyLanguage();
  });
  document.querySelectorAll("[data-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.mode === mode) return;
      mode = button.dataset.mode; startSession(null, true);
    });
  });
  $("words-pool").addEventListener("change", function () { pool = this.value; startSession(null, true); });
  $("words-answer").addEventListener("input", function () {
    $("words-submit").disabled = !this.value.trim() || !session || Boolean(session.results[session.index]);
  });
  $("words-spell-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (mode !== "spelling" || !session || session.phase !== "question" || !$("words-answer").value.trim()) return;
    submitAnswer(Core.normalizeAnswer($("words-answer").value) === Core.normalizeAnswer(currentWord().word));
  });
  $("words-skip").addEventListener("click", function () { submitAnswer(false, { revealed: true }); });
  $("words-next").addEventListener("click", nextQuestion);
  $("words-restart").addEventListener("click", function () { startSession(null, true); });
  $("words-again").addEventListener("click", function () { startSession(null, true); });
  $("words-review-round").addEventListener("click", function () {
    if (!session || session.phase !== "summary") return;
    var mistakes = session.words.filter(function (word, index) { return !session.results[index].correct; });
    if (mistakes.length) startSession(mistakes, true);
  });
  $("words-empty-start").addEventListener("click", function () { pool = "today"; startSession(null, true); });
  $("words-search").addEventListener("input", renderLibrary);
  $("words-library-link").addEventListener("click", function (event) {
    event.preventDefault(); $("word-library").open = true; $("word-library").scrollIntoView({ block: "start" });
    $("words-search").focus({ preventScroll: true });
  });
  $("words-retry").addEventListener("click", load);
  window.addEventListener("storage", function (event) {
    if (event.key === Core.STORAGE_KEY || event.key === null) { progress = Core.readProgress(storage); updateStats(); }
    if (event.key === "lang" && (event.newValue === "zh" || event.newValue === "en")) { lang = event.newValue; applyLanguage(); }
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) updateStats(); });
  applyLanguage(); load();
})();
