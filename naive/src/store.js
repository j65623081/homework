import { randomUUID } from 'node:crypto';

/**
 * Хранилище заметок в памяти процесса.
 *
 * Внутри — Map<id, note> (порядок вставки сохраняется, поиск по id за O(1))
 * плюс индекс Map<tag, Set<id>> для выборки по тегам без полного перебора.
 * Наружу всегда отдаются копии, чтобы вызывающий код не мог мутировать состояние.
 */
export class NoteStore {
  #notes = new Map();
  #tagIndex = new Map();

  #clone(note) {
    return { ...note, tags: [...note.tags] };
  }

  #indexAdd(note) {
    for (const tag of note.tags) {
      let ids = this.#tagIndex.get(tag);
      if (!ids) {
        ids = new Set();
        this.#tagIndex.set(tag, ids);
      }
      ids.add(note.id);
    }
  }

  #indexRemove(note) {
    for (const tag of note.tags) {
      const ids = this.#tagIndex.get(tag);
      if (!ids) continue;
      ids.delete(note.id);
      if (ids.size === 0) this.#tagIndex.delete(tag);
    }
  }

  create({ title, content, tags }) {
    const now = new Date().toISOString();
    const note = {
      id: randomUUID(),
      title,
      content: content ?? '',
      tags: [...tags],
      createdAt: now,
      updatedAt: now,
    };
    this.#notes.set(note.id, note);
    this.#indexAdd(note);
    return this.#clone(note);
  }

  get(id) {
    const note = this.#notes.get(id);
    return note ? this.#clone(note) : null;
  }

  /** Частичное обновление; поля, которых нет в patch, остаются как были. */
  update(id, patch) {
    const current = this.#notes.get(id);
    if (!current) return null;

    this.#indexRemove(current);
    const updated = {
      ...current,
      ...('title' in patch ? { title: patch.title } : {}),
      ...('content' in patch ? { content: patch.content } : {}),
      ...('tags' in patch ? { tags: [...patch.tags] } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.#notes.set(id, updated);
    this.#indexAdd(updated);
    return this.#clone(updated);
  }

  delete(id) {
    const note = this.#notes.get(id);
    if (!note) return false;
    this.#indexRemove(note);
    this.#notes.delete(id);
    return true;
  }

  /**
   * Список с фильтрами: теги (match=all|any), полнотекстовый поиск по
   * заголовку и тексту, сортировка и пагинация. Возвращает { total, items }.
   */
  list({ tags = [], match = 'all', q = '', sort = '-createdAt', limit = 20, offset = 0 } = {}) {
    let candidates;

    if (tags.length > 0) {
      const sets = tags.map((tag) => this.#tagIndex.get(tag) ?? new Set());
      if (match === 'all') {
        if (sets.some((s) => s.size === 0)) return { total: 0, items: [] };
        // начинаем с самого маленького набора — так меньше проверок
        const [smallest, ...rest] = [...sets].sort((a, b) => a.size - b.size);
        candidates = [...smallest].filter((id) => rest.every((s) => s.has(id)));
      } else {
        const union = new Set();
        for (const s of sets) for (const id of s) union.add(id);
        candidates = [...union];
      }
      candidates = candidates.map((id) => this.#notes.get(id)).filter(Boolean);
    } else {
      candidates = [...this.#notes.values()];
    }

    if (q !== '') {
      const needle = q.toLowerCase();
      candidates = candidates.filter(
        (n) => n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle),
      );
    }

    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;
    candidates.sort((a, b) => {
      const cmp = key === 'title'
        ? a.title.localeCompare(b.title)
        : String(a[key]).localeCompare(String(b[key]));
      // стабильный тай-брейк по id, чтобы пагинация не «дрожала»
      return (cmp !== 0 ? cmp : a.id.localeCompare(b.id)) * (desc ? -1 : 1);
    });

    const total = candidates.length;
    const items = candidates.slice(offset, offset + limit).map((n) => this.#clone(n));
    return { total, items };
  }

  /** Все теги с количеством заметок, по убыванию количества, затем по алфавиту. */
  tags() {
    return [...this.#tagIndex.entries()]
      .map(([tag, ids]) => ({ tag, count: ids.size }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
  }

  clear() {
    this.#notes.clear();
    this.#tagIndex.clear();
  }

  get size() {
    return this.#notes.size;
  }
}
