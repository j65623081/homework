/*
 * Логика страницы: список с фильтрами и постраничностью, создание и удаление
 * заметки, импорт пачкой и отчёт по нему.
 *
 * Данные с сервера попадают в документ только через UiDom.el / textContent.
 */
(function (global) {
  'use strict';

  var api = global.NotesApi;
  var dom = global.UiDom;
  var el = dom.el;
  var byId = dom.byId;

  var KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
  var IMPORT_MAX_NOTES = 200;
  var IMPORT_MAX_BYTES = 2 * 1024 * 1024;

  var state = {
    tag: '',
    q: '',
    limit: 20,
    offset: 0,
    total: 0,
    knownTags: [],
  };

  var ui = {};

  // ---------------------------------------------------------------- ошибки

  /** Человеческий текст по ошибке клиента API. */
  function describeApiError(err) {
    var known = {
      malformed_json: 'Тело запроса не разбирается как JSON.',
      validation_failed: 'Данные не прошли проверку на сервере.',
      unknown_fields: 'В теле есть поля, которых нет в контракте.',
      not_found: 'Запись или маршрут не найдены.',
      storage_corrupted: 'Файл-хранилище на сервере не читается. Сервис его не перезаписывает.',
      internal_error: 'Непредвиденная ошибка на сервере.',
      unsupported_media_type: 'Такой тип содержимого импорт не принимает.',
      import_too_large: 'Пачка больше допустимого: не более ' + IMPORT_MAX_NOTES +
        ' заметок и не более 2 МБ.',
      idempotency_key_invalid: 'Ключ идемпотентности отсутствует или не подходит под формат.',
      idempotency_key_conflict: 'Этот ключ уже использован с другим содержимым запроса.',
    };
    return err.message || known[err.code] || 'Запрос отклонён сервером.';
  }

  function showConnectionBanner(details) {
    ui.connectionText.textContent = details;
    dom.show(ui.connectionBanner, true);
  }

  function hideConnectionBanner() {
    dom.show(ui.connectionBanner, false);
  }

  function networkDetails() {
    return 'Адрес API — ' + api.baseUrl + '. Проверьте, что стенд поднят: ' +
      'cd api && php artisan serve --port=8000. Страница открыта, данных пока нет.';
  }

  /**
   * Общий разбор ошибки для любой формы: сеть → баннер, ответ сервера → блок рядом
   * с формой. Возвращает true, если это была ошибка сети.
   */
  function reportError(container, err, titleText) {
    if (err && err.isNetworkError) {
      showConnectionBanner(networkDetails());
      dom.renderErrorBlock(container, {
        title: titleText,
        message: 'Стенд не ответил. Подробности — в сообщении наверху страницы.',
      });
      return true;
    }
    if (err && err.isApiError) {
      dom.renderErrorBlock(container, {
        title: titleText,
        message: describeApiError(err) + ' (HTTP ' + err.status + ')',
        code: err.code,
        fields: err.fields,
      });
      return false;
    }
    dom.renderErrorBlock(container, {
      title: titleText,
      message: 'Непредвиденная ошибка на стороне страницы: ' + String(err && err.message ? err.message : err),
    });
    return false;
  }

  // ------------------------------------------------------------------ список

  function collectTags(notes) {
    var seen = {};
    state.knownTags.forEach(function (tag) { seen[tag] = true; });
    notes.forEach(function (note) {
      (Array.isArray(note.tags) ? note.tags : []).forEach(function (tag) {
        if (typeof tag === 'string' && tag !== '') {
          seen[tag] = true;
        }
      });
    });
    state.knownTags = Object.keys(seen).sort();

    dom.clear(ui.knownTags);
    state.knownTags.forEach(function (tag) {
      // value подставляется атрибутом, не разметкой: строка остаётся строкой
      dom.append(ui.knownTags, el('option', { value: tag }));
    });
  }

  function renderNote(note) {
    var item = el('li', { class: 'note' });

    var head = el('div', { class: 'note__head' });
    dom.append(head, el('h3', { class: 'note__title' }, note.title));

    var del = el('button', { type: 'button', class: 'btn btn--danger btn--small' }, 'Удалить');
    del.addEventListener('click', function () { onDelete(note); });
    dom.append(head, del);
    dom.append(item, head);

    if (typeof note.body === 'string' && note.body !== '') {
      dom.append(item, el('p', { class: 'note__body' }, note.body));
    }

    var tags = Array.isArray(note.tags) ? note.tags : [];
    if (tags.length > 0) {
      var tagList = el('ul', { class: 'tags' });
      tags.forEach(function (tag) {
        var li = el('li');
        var chip = el('button', { type: 'button', class: 'tag' }, String(tag));
        chip.addEventListener('click', function () {
          ui.filterTag.value = String(tag);
          applyFilters();
        });
        dom.append(li, chip);
        dom.append(tagList, li);
      });
      dom.append(item, tagList);
    }

    var meta = el('p', { class: 'note__meta' });
    dom.append(meta, el('span', null, 'создана ' + dom.formatDate(note.created_at)));
    if (note.updated_at && note.updated_at !== note.created_at) {
      dom.append(meta, el('span', null, ' · изменена ' + dom.formatDate(note.updated_at)));
    }
    dom.append(meta, el('span', { class: 'note__id' }, ' · ' + String(note.id)));
    dom.append(item, meta);

    return item;
  }

  /**
   * Показать в списке «на странице» тот размер, который вернул сервер.
   * Если такого варианта в списке нет — добавляем его, чтобы поле не врало.
   */
  function syncLimitSelect(limit) {
    var value = String(limit);
    if (ui.filterLimit.value === value) {
      return;
    }
    var exists = Array.prototype.some.call(ui.filterLimit.options, function (option) {
      return option.value === value;
    });
    if (!exists) {
      dom.append(ui.filterLimit, el('option', { value: value }, value));
    }
    ui.filterLimit.value = value;
  }

  function renderPager() {
    var from = state.total === 0 ? 0 : state.offset + 1;
    var to = Math.min(state.offset + state.limit, state.total);
    ui.pageInfo.textContent = state.total === 0
      ? 'Записей нет'
      : 'Показано ' + from + '–' + to + ' из ' + state.total;
    ui.pagePrev.disabled = state.offset <= 0;
    ui.pageNext.disabled = state.offset + state.limit >= state.total;
  }

  async function loadNotes() {
    ui.listStatus.textContent = 'Загрузка…';
    dom.show(ui.listError, false);

    var payload;
    try {
      payload = await api.listNotes({
        tag: state.tag,
        q: state.q,
        limit: state.limit,
        offset: state.offset,
      });
    } catch (err) {
      ui.listStatus.textContent = '';
      dom.clear(ui.notes);
      reportError(ui.listError, err, 'Список не загрузился');
      renderPager();
      return;
    }

    hideConnectionBanner();

    var notes = payload && Array.isArray(payload.data) ? payload.data : [];
    var meta = (payload && payload.meta) || {};
    // meta с сервера — источник истины о применённых limit/offset: если сервер
    // применил не то, что просил клиент, постраничность должна считаться по факту.
    state.total = typeof meta.total === 'number' ? meta.total : notes.length;
    if (typeof meta.limit === 'number' && meta.limit > 0) {
      state.limit = meta.limit;
      syncLimitSelect(meta.limit);
    }
    if (typeof meta.offset === 'number' && meta.offset >= 0) { state.offset = meta.offset; }

    dom.clear(ui.notes);
    notes.forEach(function (note) {
      dom.append(ui.notes, renderNote(note));
    });

    var filtered = state.tag !== '' || state.q !== '';
    if (notes.length === 0) {
      ui.listStatus.textContent = filtered
        ? 'По этому фильтру ничего не нашлось.'
        : 'Заметок пока нет.';
    } else {
      ui.listStatus.textContent = '';
    }

    collectTags(notes);
    renderPager();
  }

  function applyFilters() {
    state.q = ui.filterQ.value.trim();
    state.tag = ui.filterTag.value.trim();
    state.limit = parseInt(ui.filterLimit.value, 10) || 20;
    state.offset = 0;
    loadNotes();
  }

  // -------------------------------------------------------- создание, удаление

  function parseTagsInput(raw) {
    // Режем по запятой и отдаём как есть: нормализация тегов — обязанность сервера,
    // клиент не должен молча чинить то, что сервер обязан отклонить.
    return raw.split(',').filter(function (part) { return part !== ''; });
  }

  async function onCreate(event) {
    event.preventDefault();
    dom.show(ui.createError, false);
    ui.createStatus.textContent = 'Отправка…';

    var payload = {
      title: ui.createTitle.value,
      body: ui.createBody.value,
    };
    var rawTags = ui.createTags.value;
    if (rawTags.trim() !== '') {
      payload.tags = parseTagsInput(rawTags);
    }

    try {
      var created = await api.createNote(payload);
      hideConnectionBanner();
      ui.createStatus.textContent = 'Заметка создана.';
      ui.createTitle.value = '';
      ui.createBody.value = '';
      ui.createTags.value = '';
      if (created && created.data) {
        state.offset = 0;
      }
      await loadNotes();
    } catch (err) {
      ui.createStatus.textContent = '';
      reportError(ui.createError, err, 'Заметка не создана');
    }
  }

  async function onDelete(note) {
    var title = typeof note.title === 'string' ? note.title : '';
    var short = title.length > 60 ? title.slice(0, 60) + '…' : title;
    if (!global.confirm('Удалить заметку «' + short + '»?')) {
      return;
    }
    dom.show(ui.listError, false);
    try {
      await api.deleteNote(note.id);
      hideConnectionBanner();
      // Если удалили последнюю запись на странице — отступаем на страницу назад.
      if (state.offset > 0 && state.total - 1 <= state.offset) {
        state.offset = Math.max(0, state.offset - state.limit);
      }
      await loadNotes();
    } catch (err) {
      reportError(ui.listError, err, 'Заметка не удалена');
    }
  }

  // ------------------------------------------------------------------ импорт

  function generateKey() {
    var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var bytes = new Uint8Array(12);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    var tail = '';
    bytes.forEach(function (byte) {
      tail += alphabet[byte % alphabet.length];
    });
    var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'ui-' + stamp + '-' + tail;
  }

  function refreshKeyHint() {
    var value = ui.importKey.value;
    if (value === '') {
      ui.importKeyHint.textContent =
        'Без ключа сервер ответит 422 idempotency_key_invalid. Кнопка рядом сгенерирует подходящий.';
      return;
    }
    ui.importKeyHint.textContent = KEY_PATTERN.test(value)
      ? 'Формат ключа подходит под контракт.'
      : 'Формат не подходит: нужно 8–128 символов из A–Z, a–z, 0–9, _ и -. Запрос уйдёт как есть, ответит сервер.';
  }

  function currentSource() {
    var checked = ui.importForm.querySelector('input[name="source"]:checked');
    return checked ? checked.value : 'text';
  }

  function switchSource() {
    var source = currentSource();
    dom.show(ui.importTextField, source === 'text');
    dom.show(ui.importFileField, source === 'file');
  }

  function describeChosenFile() {
    var file = ui.importFile.files && ui.importFile.files[0];
    if (!file) {
      ui.importFileInfo.textContent = 'Файл с объектом {"notes": [...]} в UTF-8. ' +
        'Имя файла и его MIME-тип на результат не влияют.';
      return;
    }
    var kb = (file.size / 1024).toFixed(1);
    var warn = file.size > IMPORT_MAX_BYTES
      ? ' Это больше 2 МБ — сервер ответит 413 import_too_large.'
      : '';
    // Имя файла приходит извне, поэтому только textContent.
    ui.importFileInfo.textContent = 'Выбран: ' + file.name + ', ' + kb + ' КБ.' + warn;
  }

  function renderReportErrors(errors) {
    dom.clear(ui.reportErrors);
    var list = Array.isArray(errors) ? errors : [];
    dom.show(ui.reportErrorsEmpty, list.length === 0);
    dom.show(ui.reportErrorsWrap, list.length > 0);

    list.forEach(function (entry) {
      var row = el('tr');
      dom.append(row, el('td', { class: 'num' }, String(entry && entry.index)));

      var codeCell = el('td');
      dom.append(codeCell, el('code', null, String(entry && entry.code)));
      dom.append(row, codeCell);

      var reasonCell = el('td');
      var fields = entry && entry.fields;
      if (fields && typeof fields === 'object') {
        var reasons = el('ul', { class: 'reasons' });
        Object.keys(fields).forEach(function (field) {
          var messages = fields[field];
          var text = Array.isArray(messages) ? messages.join('; ') : String(messages);
          dom.append(reasons, el('li', null, field + ': ' + text));
        });
        dom.append(reasonCell, reasons.childNodes.length > 0 ? reasons : el('span', null, '—'));
      } else {
        dom.append(reasonCell, el('span', null, '—'));
      }
      dom.append(row, reasonCell);

      dom.append(ui.reportErrors, row);
    });
  }

  function renderReportNotes(notes) {
    dom.clear(ui.reportNotes);
    var list = Array.isArray(notes) ? notes : [];
    dom.show(ui.reportNotesEmpty, list.length === 0);
    list.forEach(function (note) {
      var item = el('li');
      dom.append(item, el('span', { class: 'report__note-title' }, String(note && note.title)));
      dom.append(item, el('span', { class: 'note__id' }, ' ' + String(note && note.id)));
      dom.append(ui.reportNotes, item);
    });
  }

  function renderReport(payload) {
    ui.reportImported.textContent = String(payload && payload.imported);
    ui.reportRejected.textContent = String(payload && payload.rejected);
    ui.reportReplay.textContent = payload && payload.idempotent_replay === true
      ? 'да — пачка уже была принята с этим ключом, хранилище не менялось'
      : 'нет';
    renderReportErrors(payload && payload.errors);
    renderReportNotes(payload && payload.notes);
    dom.show(ui.importReport, true);
  }

  async function onImport(event) {
    event.preventDefault();
    dom.show(ui.importError, false);
    dom.show(ui.importReport, false);

    var key = ui.importKey.value;
    var source = currentSource();
    var request;

    if (source === 'file') {
      var file = ui.importFile.files && ui.importFile.files[0];
      if (!file) {
        dom.renderErrorBlock(ui.importError, {
          title: 'Файл не выбран',
          message: 'Выберите файл или переключитесь на ввод JSON текстом.',
        });
        return;
      }
      request = api.importFile(file, key);
    } else {
      request = api.importJsonText(ui.importText.value, key);
    }

    ui.importStatus.textContent = 'Отправка…';
    try {
      var payload = await request;
      hideConnectionBanner();
      ui.importStatus.textContent = 'Пачка принята сервером.';
      renderReport(payload);
      state.offset = 0;
      await loadNotes();
    } catch (err) {
      ui.importStatus.textContent = '';
      // Пока ветка бекендера не влита, маршрута импорта на стенде может не быть:
      // по контракту неизвестный маршрут отвечает 404 not_found, и без пояснения
      // это читается как «заметка не найдена».
      if (err && err.isApiError && err.status === 404 && err.code === 'not_found') {
        dom.renderErrorBlock(ui.importError, {
          title: 'Импорт недоступен на этом стенде',
          message: 'Сервер ответил 404 на POST /api/notes/import. По контракту так отвечает ' +
            'несуществующий маршрут — вероятно, эндпоинт импорта на стенде ещё не поднят.',
          code: err.code,
        });
        return;
      }
      reportError(ui.importError, err, 'Импорт не выполнен');
    }
  }

  // -------------------------------------------------------------------- старт

  function cacheElements() {
    ui.connectionBanner = byId('connection-banner');
    ui.connectionText = byId('connection-banner-text');
    ui.connectionRetry = byId('connection-retry');

    ui.filters = byId('filters');
    ui.filterQ = byId('filter-q');
    ui.filterTag = byId('filter-tag');
    ui.filterLimit = byId('filter-limit');
    ui.filtersReset = byId('filters-reset');
    ui.knownTags = byId('known-tags');
    ui.reload = byId('reload');

    ui.notes = byId('notes');
    ui.listStatus = byId('list-status');
    ui.listError = byId('list-error');
    ui.pagePrev = byId('page-prev');
    ui.pageNext = byId('page-next');
    ui.pageInfo = byId('page-info');

    ui.createForm = byId('create-form');
    ui.createTitle = byId('create-title');
    ui.createBody = byId('create-body');
    ui.createTags = byId('create-tags');
    ui.createError = byId('create-error');
    ui.createStatus = byId('create-status');

    ui.importForm = byId('import-form');
    ui.importText = byId('import-text');
    ui.importTextField = byId('import-text-field');
    ui.importFile = byId('import-file');
    ui.importFileField = byId('import-file-field');
    ui.importFileInfo = byId('import-file-info');
    ui.importKey = byId('import-key');
    ui.importKeyGen = byId('import-key-gen');
    ui.importKeyHint = byId('import-key-hint');
    ui.importError = byId('import-error');
    ui.importStatus = byId('import-status');

    ui.importReport = byId('import-report');
    ui.reportImported = byId('report-imported');
    ui.reportRejected = byId('report-rejected');
    ui.reportReplay = byId('report-replay');
    ui.reportErrors = byId('report-errors');
    ui.reportErrorsWrap = byId('report-errors-wrap');
    ui.reportErrorsEmpty = byId('report-errors-empty');
    ui.reportNotes = byId('report-notes');
    ui.reportNotesEmpty = byId('report-notes-empty');
  }

  function bindEvents() {
    ui.filters.addEventListener('submit', function (event) {
      event.preventDefault();
      applyFilters();
    });
    ui.filtersReset.addEventListener('click', function () {
      ui.filterQ.value = '';
      ui.filterTag.value = '';
      ui.filterLimit.value = '20';
      applyFilters();
    });
    ui.reload.addEventListener('click', function () { loadNotes(); });
    ui.connectionRetry.addEventListener('click', function () { loadNotes(); });

    ui.pagePrev.addEventListener('click', function () {
      state.offset = Math.max(0, state.offset - state.limit);
      loadNotes();
    });
    ui.pageNext.addEventListener('click', function () {
      state.offset = state.offset + state.limit;
      loadNotes();
    });

    ui.createForm.addEventListener('submit', onCreate);
    ui.importForm.addEventListener('submit', onImport);

    ui.importForm.querySelectorAll('input[name="source"]').forEach(function (radio) {
      radio.addEventListener('change', switchSource);
    });
    ui.importFile.addEventListener('change', describeChosenFile);
    ui.importKey.addEventListener('input', refreshKeyHint);
    ui.importKeyGen.addEventListener('click', function () {
      ui.importKey.value = generateKey();
      refreshKeyHint();
    });
  }

  function start() {
    cacheElements();
    bindEvents();
    switchSource();
    describeChosenFile();
    ui.importKey.value = generateKey();
    refreshKeyHint();
    ui.importText.value = JSON.stringify({
      notes: [
        { title: 'Заметка из пачки', body: 'Текст', tags: ['импорт'] },
      ],
    }, null, 2);
    loadNotes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
