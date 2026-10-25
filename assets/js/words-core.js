(function (global) {
  "use strict";

  var STORAGE_KEY = "fizgrad.gre-progress.v1";
  var MODES = ["choice", "spelling"];
  var loaded;

  function normalizeAnswer(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase();
  }

  function validID(id) { return typeof id === "string" && /^[a-z][a-z '-]*$/.test(id) && id.length <= 100; }

  function parseWordList(text) {
    var seen = new Set();
    return String(text).replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).reduce(function (words, line, index) {
      if (!line.trim()) return words;
      var tab = line.indexOf("\t");
      var word = line.slice(0, tab).trim();
      var definition = line.slice(tab + 1).trim();
      var id = normalizeAnswer(word);
      if (tab < 1 || !validID(id) || !definition || seen.has(id)) {
        throw new Error("Invalid or duplicate word on line " + (index + 1));
      }
      seen.add(id);
      var part = definition.match(/^(adj[.,]|adv\.|n\.|v\.)\s*/i);
      words.push({ id: id, word: word, definition: definition,
        partOfSpeech: part ? part[1].replace(",", ".") : "" });
      return words;
    }, []);
  }

  function validateWords(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.words) || !data.words.length) throw new Error("Invalid vocabulary");
    var seen = new Set();
    data.words.forEach(function (word) {
      if (!word || typeof word.word !== "string" || !validID(word.id) ||
          normalizeAnswer(word.word) !== word.id || seen.has(word.id) ||
          typeof word.definition !== "string" || !word.definition.trim() || typeof word.partOfSpeech !== "string") {
        throw new Error("Invalid vocabulary entry");
      }
      seen.add(word.id);
    });
    return data.words;
  }

  function loadWords() {
    if (!loaded) {
      loaded = global.fetch("assets/data/gre-words.json").then(function (response) {
        if (!response.ok) throw new Error("Vocabulary request failed");
        return response.json();
      }).then(validateWords).catch(function (error) { loaded = null; throw error; });
    }
    return loaded;
  }

  function dateKey(date) {
    var value = date || new Date();
    return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0");
  }

  function hash(text) {
    var value = 2166136261;
    for (var i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }

  function random(seed) {
    var state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, rng) {
    var result = items.slice();
    var next = rng || Math.random;
    for (var i = result.length - 1; i > 0; i--) {
      var j = Math.floor(next() * (i + 1));
      var temp = result[i]; result[i] = result[j]; result[j] = temp;
    }
    return result;
  }

  function dailyWords(words, date, count) {
    if (!words.length) return [];
    var key = typeof date === "string" ? date : dateKey(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid date");
    var parts = key.split("-").map(Number);
    var day = Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
    var deck = shuffle(words, random(hash("fizgrad-gre-daily-v1")));
    // The first card rotates without repeats over the current deck's length.
    var first = deck[((day % deck.length) + deck.length) % deck.length];
    var rest = shuffle(words.filter(function (w) { return w.id !== first.id; }), random(hash(key)));
    return [first].concat(rest).slice(0, Math.min(count || 10, words.length));
  }

  // Exclude close/related meanings rather than presenting two defensible answers.
  // This is a conservative distractor filter, not a general synonym dictionary.
  var families = [
    "aberrant anomalous", "abstemious ascetic austere frugality",
    "admonish castigation denigrate disparage reproach invective vituperative diatribe tirade harangue",
    "aggregate amalgamate incorporate coagulate", "alacrity ebullient",
    "ambiguous indeterminate equivocate prevaricate", "ameliorate assuage mitigate mollify placate propitiate conciliatory",
    "analogous commensurate homogeneous", "antipathy misanthrope", "apprise elicit insinuate implicit tacit",
    "approbation beneficent laud eulogy venerate reverent piety idolatry",
    "artless guileless ingenuous gullible", "assiduous meticulous", "attenuate enervate impair flag tenuous",
    "audacious presumptuous effrontery", "banal conventional platitude mundane", "belie gainsay refute confound",
    "bombastic grandiloquent ostentatious pedantic", "boorish craven",
    "burgeon proliferate engender foment catalyst", "buttress goad substantiate warranted",
    "cacophonous discordant dissonance", "capricious whimsical volatile sporadic desultory vacillate oscillate",
    "chicanery disingenuous dissemble mendacious perfidious specious fallacious",
    "compendium coda distill", "complaisant fawning obsequious officious solicitous",
    "convoluted tortuous conundrum", "decorum propriety", "deference reverent",
    "diffidence reticent irresolute", "diffuse disseminate pervasive", "dirge elegy",
    "discerning lucid erudite connoisseur sage", "discredit opprobrium stigma", "discrepancy discrete disparate dichotomy incongruity",
    "disinterested partisan", "disjointed desultory tangential digression", "dismiss repudiate reprobate proscribe",
    "dissolution metamorphosis", "distend inundate saturate plethora", "doctrinaire dogmatic intractable intransigence implacable obdurate recalcitrant refractory",
    "dupe gullible", "efficacy viable pragmatic", "endemic inherent", "ephemeral precipitate",
    "equanimity imperturbable impassive phlegmatic stolid", "esoteric recondite", "exculpate disabuse",
    "extraneous inconsequential insipid", "facetious levity", "fledgling neophyte", "forestall obviate impede occlude",
    "garrulous loquacious verbose", "gregarious insularity", "hyperbole embellish",
    "iconoclastic maverick", "immutable inured", "impermeable impervious permeable",
    "inadvertently desultory", "indigence penury paucity", "indolent inert lethargic lassitude torpor quiescent insensible soporific",
    "irascible contentious truculence", "laconic reticent", "magnanimity prodigal", "malleable plasticity",
    "morose antipathy", "negate rescind recant repudiate", "onerous exigency", "paragon pristine",
    "pathological anomalous", "penchant propensity", "perennial persistent", "perfunctory desultory",
    "precursor anachronism", "precarious problematic irresolute", "probity veracious",
    "pungent vituperative", "rarefied esoteric", "resolution intransigence", "salubrious viable",
    "sanction proscribe", "satiate saturate", "skeptic discredit", "strut ostentatious", "supersede relegate",
    "tractable complaisant", "welter dissolution", "zealot dogmatic"
  ].map(function (line) { return new Set(line.split(" ")); });
  var stopwords = new Set("a an the to of or and in on at for from with by into as is be being one something someone person who that not very make become having relating through".split(" "));
  function tokens(text) {
    return new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter(function (word) { return !stopwords.has(word); }));
  }
  function related(a, b) {
    if (families.some(function (group) { return group.has(a.id) && group.has(b.id); })) return true;
    if (normalizeAnswer(a.definition) === normalizeAnswer(b.definition)) return true;
    var first = tokens(a.definition), second = tokens(b.definition);
    if (first.has(b.id) || second.has(a.id)) return true;
    return Array.from(first).some(function (token) { return second.has(token); });
  }

  function choicesFor(word, words, rng) {
    var candidates = shuffle(words.filter(function (other) { return other.id !== word.id && !related(word, other); }), rng);
    candidates.sort(function (a, b) {
      return Number(b.partOfSpeech === word.partOfSpeech) - Number(a.partOfSpeech === word.partOfSpeech);
    });
    var options = [word];
    var meanings = new Set([normalizeAnswer(word.definition)]);
    for (var i = 0; i < candidates.length && options.length < 4; i++) {
      var key = normalizeAnswer(candidates[i].definition);
      if (meanings.has(key)) continue;
      meanings.add(key); options.push(candidates[i]);
    }
    return shuffle(options, rng);
  }

  function emptyProgress() { return { version: 1, records: Object.create(null), days: Object.create(null) }; }
  function count(value) { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000) : 0; }
  function cleanProgress(data) {
    var result = emptyProgress();
    if (!data || data.version !== 1) return result;
    Object.keys(data.records || {}).slice(0, 5000).forEach(function (id) {
      if (!validID(id)) return;
      var record = data.records[id];
      if (!record || typeof record !== "object") return;
      result.records[id] = {};
      MODES.forEach(function (mode) {
        var item = record[mode];
        if (!item || typeof item !== "object") return;
        result.records[id][mode] = { attempts: count(item.attempts), correct: Math.min(count(item.correct), count(item.attempts)),
          needsReview: item.needsReview === true, lastAnswer: typeof item.lastAnswer === "string" ? item.lastAnswer.slice(0, 32) : "" };
      });
    });
    Object.keys(data.days || {}).filter(function (key) { return /^\d{4}-\d{2}-\d{2}$/.test(key); }).sort().slice(-90).forEach(function (key) {
      var day = data.days[key];
      if (!day || typeof day !== "object") return;
      var ids = Object.create(null);
      Object.keys(day.ids || {}).slice(0, 5000).forEach(function (id) { if (validID(id)) ids[id] = true; });
      result.days[key] = { attempts: count(day.attempts), correct: count(day.correct), ids: ids };
    });
    return result;
  }

  function readProgress(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      return raw && raw.length < 2000000 ? cleanProgress(JSON.parse(raw)) : emptyProgress();
    } catch (e) { return emptyProgress(); }
  }

  function storageAvailable(storage) {
    try {
      if (!storage) return false;
      var key = STORAGE_KEY + ".probe";
      storage.setItem(key, "1"); storage.removeItem(key); return true;
    } catch (e) { return false; }
  }

  function saveProgress(storage, progress) {
    try { if (!storage) return false; storage.setItem(STORAGE_KEY, JSON.stringify(progress)); return true; }
    catch (e) { return false; }
  }

  function recordFor(progress, id, mode) {
    return progress.records[id] && progress.records[id][mode] || { attempts: 0, correct: 0, needsReview: false, lastAnswer: "" };
  }

  function recordAnswer(progress, id, mode, correct, date) {
    if (!validID(id) || MODES.indexOf(mode) === -1 || typeof correct !== "boolean") throw new Error("Invalid answer record");
    var next = cleanProgress(progress);
    var now = date || new Date();
    var previous = recordFor(next, id, mode);
    if (!next.records[id]) next.records[id] = {};
    next.records[id][mode] = { attempts: previous.attempts + 1, correct: previous.correct + Number(correct),
      needsReview: !correct, lastAnswer: now.toISOString() };
    var key = dateKey(now);
    if (!next.days[key]) next.days[key] = { attempts: 0, correct: 0, ids: Object.create(null) };
    next.days[key].attempts++; next.days[key].correct += Number(correct); next.days[key].ids[id] = true;
    return cleanProgress(next);
  }

  function sessionWords(words, progress, mode, pool, date, rng) {
    if (pool === "today") return dailyWords(words, date, 10);
    var candidates = shuffle(words, rng);
    if (pool === "mistakes") return candidates.filter(function (word) { return recordFor(progress, word.id, mode).needsReview; }).slice(0, 10);
    candidates.sort(function (a, b) {
      var first = recordFor(progress, a.id, mode), second = recordFor(progress, b.id, mode);
      var rankA = first.needsReview ? -1 : first.attempts;
      var rankB = second.needsReview ? -1 : second.attempts;
      return rankA - rankB;
    });
    return candidates.slice(0, 10);
  }

  global.WordsCore = Object.freeze({ STORAGE_KEY: STORAGE_KEY, parseWordList: parseWordList, validateWords: validateWords,
    loadWords: loadWords, dateKey: dateKey, dailyWords: dailyWords, choicesFor: choicesFor, shuffle: shuffle, random: random,
    normalizeAnswer: normalizeAnswer, emptyProgress: emptyProgress, readProgress: readProgress, saveProgress: saveProgress,
    storageAvailable: storageAvailable, recordFor: recordFor, recordAnswer: recordAnswer, sessionWords: sessionWords });
})(typeof window !== "undefined" ? window : globalThis);
