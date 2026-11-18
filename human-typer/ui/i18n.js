// Human Typer — UI strings and locale-aware formatting.
// Classic script; exposes a single global: HTI18n.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'ht-ui-lang';
  var SUPPORTED = ['en', 'tr'];

  // Plural-sensitive entries are objects keyed by Intl.PluralRules categories.
  var dict = {
    en: {
      'lang.label': 'Language',

      'target.connected': 'Connected to: {title}',
      'target.none': 'Open a Google Doc tab',
      'target.untitled': 'Untitled document',

      'doc.title': 'Document',
      'doc.drop': 'Drop a .docx, .md or .txt file here',
      'doc.dropActive': 'Release to load the file',
      'doc.browse': 'or choose a file',
      'doc.pasteToggle': 'Paste text instead',
      'doc.pasteHide': 'Hide the text box',
      'doc.pasteLabel': 'Text to type',
      'doc.pastePlaceholder': 'Paste the text you want typed…',
      'doc.pasteUse': 'Use this text',
      'doc.pastedName': 'Pasted text',
      'doc.loading': 'Reading {name}…',
      'doc.replace': 'Replace',
      'doc.words': { one: '{count} word', other: '{count} words' },
      'doc.paragraphs': { one: '{count} paragraph', other: '{count} paragraphs' },
      'doc.tables': { one: '{count} table', other: '{count} tables' },
      'doc.outline': 'Start of the document',
      'doc.more': { one: '+ {count} more block', other: '+ {count} more blocks' },
      'doc.table': 'Table {rows}×{cols}',
      'doc.emptyLine': 'Empty line',
      'doc.warnMore': { one: '+ {count} more note', other: '+ {count} more notes' },
      'doc.templateHint': 'If the open Google Doc already holds the empty template, drop the filled-in version here: only the missing parts are typed.',
      'doc.err.type': 'This file type is not supported. Use a .docx, .md or .txt file.',
      'doc.err.read': 'Could not read {name}: {error}',
      'doc.err.empty': 'There is no text to type in this document.',
      'doc.err.noParser': 'The document reader is not loaded. Reload the panel and try again.',

      'style.title': 'Typing style',
      'style.pace': 'Pace',
      'style.paceValue': 'Automatic',
      'style.paceHint': 'Varies like a person: about 40–68 WPM, with pauses.',
      'style.estimate': 'About {duration} of active typing',
      'style.estimateNone': 'Add a document to see how long typing takes.',
      'style.typos': 'Typos',
      'style.typosHint': 'Mistakes are made and corrected the way a person would.',
      'style.typosNone': 'No mistakes: every key lands right the first time.',
      'style.layout': 'Keyboard layout',
      'style.layout.auto': 'Auto (from the text)',
      'style.layout.autoDetected': 'Auto: {layout}',
      'style.layout.trq': 'Turkish Q',
      'style.layout.qwerty': 'QWERTY (US)',
      'style.layoutHint': 'Decides which neighbouring keys get hit by mistake.',

      'sched.title': 'Schedule',
      'sched.now': 'Start now',
      'sched.deadline': 'Finish by…',
      'sched.nowHint': 'Types the whole document in one sitting, starting right away.',
      'sched.finishBy': 'Finish by',
      'sched.hours': 'Active hours',
      'sched.from': 'From',
      'sched.to': 'To',
      'sched.days': 'Days',
      'sched.plan': 'Planned sittings',
      'sched.sittings': { one: '{count} sitting', other: '{count} sittings' },
      'sched.overDays': { one: '{sittings} on {count} day', other: '{sittings} over {count} days' },
      'sched.showAll': 'Show all {count} days',
      'sched.awake': 'Your computer must be awake with Chrome running at these times.',
      'sched.needDoc': 'Add a document to see the planned sittings.',
      'sched.noDays': 'Select at least one day.',
      'sched.invalidDate': 'Enter the date and time to finish by.',
      'sched.reason.deadline_passed': 'That time has already passed. Pick a later one.',
      'sched.reason.not_enough_time': 'Not enough time before the deadline. Move the deadline later or widen the active hours.',
      'sched.reason.not_enough_time_detail': 'Not enough time before the deadline: typing needs {required}, but only {available} fits in the active hours. Move the deadline later or widen the hours.',
      'sched.reason.no_allowed_window': 'No active day or hour falls before the deadline. Select more days or widen the hours.',
      'sched.reason.unknown': 'This schedule cannot be planned. Try a later deadline.',

      'action.start': 'Start typing',
      'action.schedule': 'Schedule',
      'action.starting': 'Starting…',
      'action.reason.noDoc': 'Add a document first.',
      'action.reason.noTarget': 'Open a Google Doc tab to type into.',
      'action.reason.schedule': 'Fix the schedule above first.',
      'action.ready': 'Typing starts at the cursor in “{title}”.',
      'action.readyDeadline': 'First sitting: {time}',

      'run.status.running': 'Typing',
      'run.status.paused': 'Paused',
      'run.status.waiting': 'Waiting for next sitting at {time}',
      'run.status.waitingNoTime': 'Waiting for the next sitting',
      'run.status.done': 'Done',
      'run.status.error': 'Error',
      'run.status.stopped': 'Stopped',
      'run.progress': 'block {done} of {total}',
      'run.kind.compose': 'Typing the whole document',
      'run.kind.fill': 'Filling in the existing template',
      'run.kind.fillEnded': 'Filled in the existing template',
      'run.fill.unchanged': { one: '{count} block already in place', other: '{count} blocks already in place' },
      'run.fill.appended': { one: '{count} blank filled in', other: '{count} blanks filled in' },
      'run.fill.replaced': { one: '{count} paragraph rewritten', other: '{count} paragraphs rewritten' },
      'run.fill.inserted': { one: '{count} new paragraph', other: '{count} new paragraphs' },
      'run.fill.problems': { one: '{count} part needs a look', other: '{count} parts need a look' },
      'run.elapsed': 'Elapsed',
      'run.remaining': 'Remaining',
      'run.finishBy': 'Finish by',
      'run.nextSitting': 'Next sitting',
      'run.about': 'about {duration}',
      'run.sittings': 'Sittings',
      'run.legend.done': 'Done',
      'run.legend.current': 'Now',
      'run.legend.upcoming': 'Upcoming',
      'run.legend.missed': 'Missed',
      'run.pause': 'Pause',
      'run.resume': 'Resume',
      'run.stop': 'Stop',
      'run.stopAsk': 'Stop typing? What has been typed stays in the document.',
      'run.stopYes': 'Stop typing',
      'run.stopNo': 'Keep going',
      'run.new': 'New document',
      'run.doneNote': 'The whole document has been typed.',
      'run.stoppedNote': 'Typing was stopped before the end. What was typed stays in the document.',
      'run.errorNote': 'Typing stopped because of an error.',
      'run.noTarget': 'The Google Doc tab is not open. Open it again to continue.',

      // Error keys the service worker may send in job.message.
      'err.tab_closed': 'The Google Doc tab was closed. Open the document again, then start over with a new document.',
      'err.no_focus': 'The document could not be focused. Click inside the Google Doc and resume.',
      'err.unknown': 'Something went wrong while typing.',
      'msg.verified': 'Finished. The document was read back and matches the source.',
      'msg.finished_with_differences': 'Finished, but the document still differs from the source in a few places. Check the list below.',
      'msg.finished_unverified': 'Finished. The document could not be read back for checking.',
      'msg.repairing': 'Fixing the places that did not match the source.',
      'msg.nothing_to_type': 'The Google Doc already contains everything in this document.',
      'msg.tab_hidden': 'Paused because the Google Doc tab is hidden. Bring it to the front to continue.',
      'msg.no_target': 'Open the Google Doc you want to type into, then try again.',
      'msg.docs_tab_unreachable': 'The Google Doc tab did not respond. Reload it and resume.',
      'msg.docs_input_missing': 'The Google Docs editor could not be found on the page. Reload the tab and resume.',
      'msg.template_check_failed': 'The Google Doc could not be read, so the whole document is being typed.',
      'msg.not_enough_time': 'There is not enough time before the deadline within the allowed hours.',
      'msg.deadline_passed': 'The deadline has already passed.',
      'msg.no_allowed_window': 'No allowed hours fall before the deadline.',
      'msg.resume_inside_table': 'Typing was interrupted inside a table and cannot continue automatically. Finish that table by hand, or start over.',
      'msg.resume_inside_insert': 'Typing was interrupted in the middle of a new paragraph and cannot continue automatically.',

      'footer.selftest': 'Run self-test',
      'footer.about': 'About',
      'footer.preview': 'Preview: simulated',
      'selftest.label': 'Self-test result',
      'selftest.running': 'Running self-test…',
      'selftest.timeout': 'No answer from the extension. Reload it and try again.',
      'about.version': 'Human Typer {version}',
      'about.versionDev': 'development build',
      'about.disclaimer': 'Open source under the MIT licence. You are responsible for how you use it; follow the rules that apply to your work.'
    },

    tr: {
      'lang.label': 'Dil',

      'target.connected': 'Bağlı belge: {title}',
      'target.none': 'Bir Google Dokümanlar sekmesi açın',
      'target.untitled': 'Adsız belge',

      'doc.title': 'Belge',
      'doc.drop': '.docx, .md veya .txt dosyasını buraya bırakın',
      'doc.dropActive': 'Yüklemek için bırakın',
      'doc.browse': 'ya da dosya seçin',
      'doc.pasteToggle': 'Bunun yerine metin yapıştır',
      'doc.pasteHide': 'Metin kutusunu gizle',
      'doc.pasteLabel': 'Yazılacak metin',
      'doc.pastePlaceholder': 'Yazılmasını istediğiniz metni yapıştırın…',
      'doc.pasteUse': 'Bu metni kullan',
      'doc.pastedName': 'Yapıştırılan metin',
      'doc.loading': '{name} okunuyor…',
      'doc.replace': 'Değiştir',
      'doc.words': { one: '{count} kelime', other: '{count} kelime' },
      'doc.paragraphs': { one: '{count} paragraf', other: '{count} paragraf' },
      'doc.tables': { one: '{count} tablo', other: '{count} tablo' },
      'doc.outline': 'Belgenin başı',
      'doc.more': { one: '+ {count} blok daha', other: '+ {count} blok daha' },
      'doc.table': 'Tablo {rows}×{cols}',
      'doc.emptyLine': 'Boş satır',
      'doc.warnMore': { one: '+ {count} not daha', other: '+ {count} not daha' },
      'doc.templateHint': 'Açık Google Dokümanlar belgesinde boş şablon zaten varsa doldurulmuş sürümü buraya bırakın: yalnızca eksik kısımlar yazılır.',
      'doc.err.type': 'Bu dosya türü desteklenmiyor. .docx, .md veya .txt dosyası kullanın.',
      'doc.err.read': '{name} okunamadı: {error}',
      'doc.err.empty': 'Bu belgede yazılacak metin yok.',
      'doc.err.noParser': 'Belge okuyucu yüklenmedi. Paneli yeniden yükleyip tekrar deneyin.',

      'style.title': 'Yazma biçimi',
      'style.pace': 'Tempo',
      'style.paceValue': 'Otomatik',
      'style.paceHint': 'Bir insan gibi değişir: dakikada yaklaşık 40–68 kelime, duraksamalarla.',
      'style.estimate': 'Yaklaşık {duration} etkin yazma süresi',
      'style.estimateNone': 'Yazmanın ne kadar süreceğini görmek için belge ekleyin.',
      'style.typos': 'Yazım hataları',
      'style.typosHint': 'Hatalar bir insanın yapacağı gibi yapılır ve düzeltilir.',
      'style.typosNone': 'Hata yok: her tuşa ilk seferde doğru basılır.',
      'style.layout': 'Klavye düzeni',
      'style.layout.auto': 'Otomatik (metne göre)',
      'style.layout.autoDetected': 'Otomatik: {layout}',
      'style.layout.trq': 'Türkçe Q',
      'style.layout.qwerty': 'QWERTY (ABD)',
      'style.layoutHint': 'Yanlışlıkla hangi komşu tuşlara basılacağını belirler.',

      'sched.title': 'Zamanlama',
      'sched.now': 'Şimdi başla',
      'sched.deadline': 'Şuna kadar bitir…',
      'sched.nowHint': 'Belgenin tamamını tek oturumda, hemen yazmaya başlar.',
      'sched.finishBy': 'Bitiş zamanı',
      'sched.hours': 'Etkin saatler',
      'sched.from': 'Başlangıç saati',
      'sched.to': 'Bitiş saati',
      'sched.days': 'Günler',
      'sched.plan': 'Planlanan oturumlar',
      'sched.sittings': { one: '{count} oturum', other: '{count} oturum' },
      'sched.overDays': { one: '{count} günde {sittings}', other: '{count} günde {sittings}' },
      'sched.showAll': '{count} günün tümünü göster',
      'sched.awake': 'Bu saatlerde bilgisayarınız uyanık, Chrome da açık olmalı.',
      'sched.needDoc': 'Planlanan oturumları görmek için belge ekleyin.',
      'sched.noDays': 'En az bir gün seçin.',
      'sched.invalidDate': 'Bitiş tarihini ve saatini girin.',
      'sched.reason.deadline_passed': 'Bu zaman geçmiş. Daha ileri bir zaman seçin.',
      'sched.reason.not_enough_time': 'Bitiş zamanına kadar yeterli süre yok. Bitişi erteleyin veya etkin saatleri genişletin.',
      'sched.reason.not_enough_time_detail': 'Bitiş zamanına kadar yeterli süre yok: yazma {required} sürüyor, etkin saatlere ise yalnızca {available} sığıyor. Bitişi erteleyin veya saatleri genişletin.',
      'sched.reason.no_allowed_window': 'Bitiş zamanından önce etkin bir gün veya saat yok. Daha fazla gün seçin ya da saatleri genişletin.',
      'sched.reason.unknown': 'Bu zamanlama planlanamıyor. Daha ileri bir bitiş zamanı deneyin.',

      'action.start': 'Yazmaya başla',
      'action.schedule': 'Zamanla',
      'action.starting': 'Başlatılıyor…',
      'action.reason.noDoc': 'Önce bir belge ekleyin.',
      'action.reason.noTarget': 'Yazılacak bir Google Dokümanlar sekmesi açın.',
      'action.reason.schedule': 'Önce yukarıdaki zamanlamayı düzeltin.',
      'action.ready': 'Yazma, “{title}” belgesinde imlecin bulunduğu yerden başlar.',
      'action.readyDeadline': 'İlk oturum: {time}',

      'run.status.running': 'Yazıyor',
      'run.status.paused': 'Duraklatıldı',
      'run.status.waiting': 'Sonraki oturum bekleniyor: {time}',
      'run.status.waitingNoTime': 'Sonraki oturum bekleniyor',
      'run.status.done': 'Tamamlandı',
      'run.status.error': 'Hata',
      'run.status.stopped': 'Durduruldu',
      'run.progress': 'blok {done} / {total}',
      'run.kind.compose': 'Belgenin tamamı yazılıyor',
      'run.kind.fill': 'Mevcut şablon dolduruluyor',
      'run.kind.fillEnded': 'Mevcut şablon dolduruldu',
      'run.fill.unchanged': { one: '{count} blok zaten yerinde', other: '{count} blok zaten yerinde' },
      'run.fill.appended': { one: '{count} boşluk dolduruldu', other: '{count} boşluk dolduruldu' },
      'run.fill.replaced': { one: '{count} paragraf yeniden yazıldı', other: '{count} paragraf yeniden yazıldı' },
      'run.fill.inserted': { one: '{count} yeni paragraf', other: '{count} yeni paragraf' },
      'run.fill.problems': { one: '{count} kısım gözden geçirilmeli', other: '{count} kısım gözden geçirilmeli' },
      'run.elapsed': 'Geçen süre',
      'run.remaining': 'Kalan süre',
      'run.finishBy': 'Bitiş zamanı',
      'run.nextSitting': 'Sonraki oturum',
      'run.about': 'yaklaşık {duration}',
      'run.sittings': 'Oturumlar',
      'run.legend.done': 'Tamamlandı',
      'run.legend.current': 'Şimdi',
      'run.legend.upcoming': 'Sırada',
      'run.legend.missed': 'Kaçırıldı',
      'run.pause': 'Duraklat',
      'run.resume': 'Sürdür',
      'run.stop': 'Durdur',
      'run.stopAsk': 'Yazma durdurulsun mu? Yazılanlar belgede kalır.',
      'run.stopYes': 'Yazmayı durdur',
      'run.stopNo': 'Devam et',
      'run.new': 'Yeni belge',
      'run.doneNote': 'Belgenin tamamı yazıldı.',
      'run.stoppedNote': 'Yazma, belge bitmeden durduruldu. Yazılanlar belgede kalır.',
      'run.errorNote': 'Yazma bir hata nedeniyle durdu.',
      'run.noTarget': 'Google Dokümanlar sekmesi açık değil. Devam etmek için yeniden açın.',

      'err.tab_closed': 'Google Dokümanlar sekmesi kapatıldı. Belgeyi yeniden açın, sonra yeni bir belgeyle baştan başlayın.',
      'err.no_focus': 'Belgeye odaklanılamadı. Google Dokümanlar belgesinin içine tıklayıp sürdürün.',
      'err.unknown': 'Yazma sırasında bir sorun oluştu.',
      'msg.verified': 'Bitti. Belge geri okundu ve kaynakla eşleşiyor.',
      'msg.finished_with_differences': 'Bitti, ancak belge birkaç yerde kaynaktan farklı. Aşağıdaki listeye bakın.',
      'msg.finished_unverified': 'Bitti. Belge kontrol için geri okunamadı.',
      'msg.repairing': 'Kaynakla eşleşmeyen yerler düzeltiliyor.',
      'msg.nothing_to_type': 'Google Dokümanlar belgesi bu belgedeki her şeyi zaten içeriyor.',
      'msg.tab_hidden': 'Google Dokümanlar sekmesi gizli olduğu için duraklatıldı. Devam etmek için sekmeyi öne getirin.',
      'msg.no_target': 'Yazılacak Google Dokümanlar belgesini açın, sonra yeniden deneyin.',
      'msg.docs_tab_unreachable': 'Google Dokümanlar sekmesi yanıt vermedi. Sekmeyi yenileyip sürdürün.',
      'msg.docs_input_missing': 'Sayfada Google Dokümanlar düzenleyicisi bulunamadı. Sekmeyi yenileyip sürdürün.',
      'msg.template_check_failed': 'Google Dokümanlar belgesi okunamadı; belgenin tamamı yazılıyor.',
      'msg.not_enough_time': 'İzin verilen saatler içinde bitiş zamanına kadar yeterli süre yok.',
      'msg.deadline_passed': 'Bitiş zamanı geçmiş.',
      'msg.no_allowed_window': 'Bitiş zamanından önce izin verilen bir saat aralığı yok.',
      'msg.resume_inside_table': 'Yazma bir tablonun içinde kesildi ve otomatik sürdürülemiyor. O tabloyu elle tamamlayın ya da baştan başlayın.',
      'msg.resume_inside_insert': 'Yazma yeni bir paragrafın ortasında kesildi ve otomatik sürdürülemiyor.',

      'footer.selftest': 'Öz sınamayı çalıştır',
      'footer.about': 'Hakkında',
      'footer.preview': 'Önizleme: benzetim',
      'selftest.label': 'Öz sınama sonucu',
      'selftest.running': 'Öz sınama çalışıyor…',
      'selftest.timeout': 'Uzantıdan yanıt gelmedi. Uzantıyı yeniden yükleyip tekrar deneyin.',
      'about.version': 'Human Typer {version}',
      'about.versionDev': 'geliştirme sürümü',
      'about.disclaimer': 'MIT lisanslı açık kaynak yazılımdır. Nasıl kullandığınız sizin sorumluluğunuzdadır; çalışmanız için geçerli kurallara uyun.'
    }
  };

  var lang = 'en';
  var listeners = [];
  var pluralRules = {};

  function locale() {
    if (lang === 'tr') return 'tr-TR';
    // Keep the user's own English variant (date order, 12/24 h) when there is one.
    var nav = (root.navigator && root.navigator.language) || '';
    return /^en\b/i.test(nav) ? nav : 'en-GB';
  }

  function fill(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] === undefined || params[k] === null ? m : String(params[k]);
    });
  }

  function has(key) {
    return Object.prototype.hasOwnProperty.call(dict[lang], key) ||
      Object.prototype.hasOwnProperty.call(dict.en, key);
  }

  // t('key', {count: 3}) — picks the plural form when the entry has several.
  function t(key, params) {
    var entry = dict[lang][key];
    if (entry === undefined) entry = dict.en[key];
    if (entry === undefined) return key;
    if (typeof entry === 'object') {
      var n = params && typeof params.count === 'number' ? params.count : 0;
      if (!pluralRules[lang]) pluralRules[lang] = new Intl.PluralRules(locale());
      entry = entry[pluralRules[lang].select(n)] || entry.other;
      params = Object.assign({}, params, { count: fmtNumber(n) });
    }
    return fill(entry, params);
  }

  // ── Storage: chrome.storage.local when granted, else localStorage. ──
  function storageGet(key) {
    return new Promise(function (resolve) {
      try {
        if (root.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(key, function (items) {
            void chrome.runtime.lastError;
            resolve(items ? items[key] : undefined);
          });
          return;
        }
      } catch (e) { /* fall through */ }
      try {
        var raw = root.localStorage.getItem(key);
        resolve(raw === null ? undefined : JSON.parse(raw));
      } catch (e2) { resolve(undefined); }
    });
  }

  function storageSet(key, value) {
    try {
      if (root.chrome && chrome.storage && chrome.storage.local) {
        var o = {}; o[key] = value;
        chrome.storage.local.set(o, function () { void chrome.runtime.lastError; });
        return;
      }
    } catch (e) { /* fall through */ }
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (e2) { /* ignore */ }
  }

  function browserLanguage() {
    var ui = '';
    try { if (root.chrome && chrome.i18n && chrome.i18n.getUILanguage) ui = chrome.i18n.getUILanguage(); } catch (e) { /* ignore */ }
    if (!ui && root.navigator) ui = root.navigator.language || '';
    return /^tr\b/i.test(ui) ? 'tr' : 'en';
  }

  function apply(next) {
    lang = SUPPORTED.indexOf(next) >= 0 ? next : 'en';
    pluralRules = {};
    if (root.document) root.document.documentElement.lang = lang;
  }

  // setLanguage persists the choice and tells every listener to re-render.
  function setLanguage(next) {
    apply(next);
    storageSet(STORAGE_KEY, lang);
    listeners.slice().forEach(function (fn) { fn(lang); });
  }

  // init(forced) resolves once the starting language is known.
  function init(forced) {
    if (SUPPORTED.indexOf(forced) >= 0) { apply(forced); return Promise.resolve(lang); }
    return storageGet(STORAGE_KEY).then(function (saved) {
      apply(SUPPORTED.indexOf(saved) >= 0 ? saved : browserLanguage());
      return lang;
    });
  }

  // ── Formatting ──
  function fmtNumber(n) {
    return new Intl.NumberFormat(locale()).format(n);
  }

  function fmtPercent(fraction, digits) {
    return new Intl.NumberFormat(locale(), {
      style: 'percent', maximumFractionDigits: digits || 0
    }).format(fraction);
  }

  function unit(n, u) {
    try {
      return new Intl.NumberFormat(locale(), { style: 'unit', unit: u, unitDisplay: 'short' }).format(n);
    } catch (e) {
      return n + ' ' + ({ hour: 'h', minute: 'min', second: 's' })[u];
    }
  }

  // 5 400 000 → "1 hr 30 min" / "1 sa. 30 dk."
  function fmtDuration(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var sec = Math.round(ms / 1000);
    if (sec < 60) return unit(Math.max(1, sec), 'second');
    var min = Math.round(sec / 60);
    if (min < 60) return unit(min, 'minute');
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? unit(h, 'hour') + ' ' + unit(m, 'minute') : unit(h, 'hour');
  }

  function fmtTime(ts) {
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }

  // "Thu 19 Nov" / "19 Kas Per"
  function fmtDay(ts) {
    return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(ts)).replace(/,/g, '');
  }

  function fmtDayTime(ts) {
    return fmtDay(ts) + ' ' + fmtTime(ts);
  }

  // Short weekday name for a JS day index (0 = Sunday).
  function fmtWeekday(dayIndex, width) {
    // 4 Jan 1970 was a Sunday.
    var d = new Date(1970, 0, 4 + dayIndex, 12);
    return new Intl.DateTimeFormat(locale(), { weekday: width || 'short' }).format(d);
  }

  root.HTI18n = {
    dict: dict,
    t: t,
    has: has,
    init: init,
    setLanguage: setLanguage,
    getLanguage: function () { return lang; },
    onChange: function (fn) { listeners.push(fn); },
    storageGet: storageGet,
    storageSet: storageSet,
    fmtNumber: fmtNumber,
    fmtPercent: fmtPercent,
    fmtDuration: fmtDuration,
    fmtTime: fmtTime,
    fmtDay: fmtDay,
    fmtDayTime: fmtDayTime,
    fmtWeekday: fmtWeekday
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
