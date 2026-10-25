(function () {
  "use strict";
  var root = document.getElementById("daily-word");
  if (!root || typeof WordsCore === "undefined") return;
  var words, failed = false, day = "", midnightTimer;
  var labels = {
    zh: { title: "今日单词", practice: "练一练 →", loading: "正在加载…", error: "单词加载失败", retry: "重新加载" },
    en: { title: "Word of the day", practice: "Practice →", loading: "Loading…", error: "Could not load today's word", retry: "Retry" }
  };
  function render() {
    var dict = labels[document.documentElement.lang.indexOf("en") === 0 ? "en" : "zh"];
    document.getElementById("daily-word-title").textContent = dict.title;
    document.getElementById("daily-word-link").textContent = dict.practice;
    var retry = document.getElementById("daily-word-retry");
    retry.textContent = dict.retry; retry.hidden = !failed;
    var meaning = document.getElementById("daily-word-meaning");
    meaning.lang = words ? "en" : document.documentElement.lang;
    if (!words) { meaning.textContent = failed ? dict.error : dict.loading; return; }
    day = WordsCore.dateKey();
    var word = WordsCore.dailyWords(words, day, 1)[0];
    document.getElementById("daily-word-term").textContent = word.word;
    meaning.textContent = word.definition;
    document.getElementById("daily-word-link").href = "words.html?word=" + encodeURIComponent(word.id);
  }
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    var next = new Date(); next.setHours(24, 0, 1, 0);
    midnightTimer = setTimeout(function () { render(); scheduleMidnight(); }, Math.max(1000, next.getTime() - Date.now()));
  }
  function load() {
    failed = false; render();
    WordsCore.loadWords().then(function (value) { words = value; render(); scheduleMidnight(); })
      .catch(function () { failed = true; render(); });
  }
  document.getElementById("daily-word-retry").addEventListener("click", load);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && day !== WordsCore.dateKey()) { render(); scheduleMidnight(); }
  });
  load();
})();
