/*
 * Помощники по DOM.
 *
 * Единственный способ, которым эта страница помещает данные с сервера в документ, —
 * присваивание textContent. Ни один из способов вставить в документ разметку строкой
 * здесь не используется — проверяется поиском по каталогу ui/, совпадений быть не должно.
 * Поэтому строка вида <script>alert(1)</script> в заголовке заметки попадает
 * на страницу как текст и остаётся текстом.
 */
(function (global) {
  'use strict';

  /**
   * Создать элемент. text кладётся строго через textContent — разметкой не станет.
   * attrs — обычные атрибуты; значения приводятся к строке.
   */
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        var value = attrs[name];
        if (value === undefined || value === null || value === false) {
          return;
        }
        if (value === true) {
          node.setAttribute(name, '');
          return;
        }
        node.setAttribute(name, String(value));
      });
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  /** Убрать всех потомков. Замена присваиванию пустой строки в разметку узла. */
  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    return node;
  }

  function append(parent, children) {
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child) {
        parent.appendChild(child);
      }
    });
    return parent;
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * Человеческая дата из ISO-строки. Значение пришло с сервера и может быть
   * любым — при неудаче показываем исходную строку, а не «Invalid Date».
   */
  function formatDate(iso) {
    if (typeof iso !== 'string' || iso === '') {
      return '';
    }
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return iso;
    }
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(date);
    } catch (e) {
      return iso;
    }
  }

  /**
   * Блок ошибки: заголовок, код и разбор поля fields из формата ошибки SPEC.md.
   * Всё содержимое — текстовые узлы.
   */
  function renderErrorBlock(container, parts) {
    clear(container);
    if (parts.title) {
      append(container, el('strong', { class: 'inline-error__title' }, parts.title));
    }
    if (parts.message) {
      append(container, el('p', { class: 'inline-error__text' }, parts.message));
    }
    if (parts.code) {
      var codeLine = el('p', { class: 'inline-error__code' }, 'Код: ');
      append(codeLine, el('code', null, parts.code));
      append(container, codeLine);
    }
    if (parts.fields && typeof parts.fields === 'object') {
      var list = el('ul', { class: 'inline-error__fields' });
      Object.keys(parts.fields).forEach(function (field) {
        var messages = parts.fields[field];
        var text = Array.isArray(messages) ? messages.join('; ') : String(messages);
        append(list, el('li', null, field + ': ' + text));
      });
      if (list.childNodes.length > 0) {
        append(container, list);
      }
    }
    show(container, true);
  }

  global.UiDom = {
    el: el,
    clear: clear,
    append: append,
    show: show,
    byId: byId,
    formatDate: formatDate,
    renderErrorBlock: renderErrorBlock,
  };
})(window);
