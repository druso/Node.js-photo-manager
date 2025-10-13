// Generic paged window manager for bidirectional pagination with eviction
// Supports keyset-based pagination (cursor, before_cursor) and classic offset cursors.
// Intended to be used by both All Photos and Project Photos views.

const IS_DEV = Boolean(import.meta?.env?.DEV);
const devLog = (...args) => { if (IS_DEV) console.log(...args); };

/**
 * @template T
 * @typedef {Object} Page
 * @property {T[]} items
 * @property {string|null|undefined} nextCursor
 * @property {string|null|undefined} prevCursor
 */

/**
 * @template T
 * @typedef {Object} FetchParams
 * @property {string|null|undefined} [cursor]
 * @property {string|null|undefined} [before_cursor]
 * @property {number|null|undefined} [limit]
 * @property {Record<string, any>} [extra]
 */

/**
 * @template T
 * @typedef {Object} WindowState
 * @property {Page<T>[]} pages
 * @property {number} totalItems
 * @property {string|null} headPrevCursor // prev of first page currently loaded (to fetch older/newer depending on sort)
 * @property {string|null} tailNextCursor // next of last page currently loaded
 */

/**
 * @template T
 * @typedef {Object} ManagerOptions
 * @property {(params: FetchParams<T>) => Promise<{ items: T[]; nextCursor?: string|null; prevCursor?: string|null; total?: number }>} fetchPage
 *   Function that fetches a single page from the server using provided cursors.
 * @property {number} [limit=100]
 *   Preferred page size passed to fetchPage unless the fetcher ignores it.
 * @property {number} [maxPages=5]
 *   Max number of pages to keep in memory. Evicts from start when loading next; from end when loading prev.
 * @property {(item: T) => string} [keyOf]
 *   Optional: return a stable unique key for deduping across pages.
 */

/**
 * @template T
 */
export default class PagedWindowManager {
  /**
   * @param {ManagerOptions<T>} options
   */
  constructor(options) {
    if (!options || typeof options.fetchPage !== 'function') throw new Error('fetchPage is required');
    this.fetchPage = options.fetchPage;
    this.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 100;
    this.maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? Math.floor(options.maxPages) : 5;
    this.keyOf = typeof options.keyOf === 'function' ? options.keyOf : null;

    /** @type {Page<T>[]} */
    this.pages = [];
    /** @type {Set<string>|null} */
    this.seenKeys = this.keyOf ? new Set() : null;
    this.totalItems = 0; // optional aggregation; caller may not rely on it

    // Track outer cursors available from current window
    this.headPrevCursor = null; // cursor to fetch backward (before_cursor) from the first page
    this.tailNextCursor = null; // cursor to fetch forward (cursor) from the last page

    // Guard against concurrent loads
    this.loadingNext = false;
    this.loadingPrev = false;
    
    // Page numbering for logging
    this.nextPageNumber = 1;
    this.prevPageNumber = 0;
  }

  // ---- State helpers ----
  /**
   * @returns {WindowState<T>}
   */
  snapshot() {
    return {
      pages: this.pages.slice(),
      totalItems: this.totalItems,
      headPrevCursor: this.headPrevCursor,
      tailNextCursor: this.tailNextCursor,
    };
  }

  /**
   * Concatenate items across pages (cheap copy).
   * @returns {T[]}
   */
  items() {
    const result = [];
    for (const p of this.pages) {
      if (Array.isArray(p.items) && p.items.length) result.push(...p.items);
    }
    return result;
  }

  /** Reset window completely. */
  reset() {
    this.pages = [];
    this.totalItems = 0;
    this.headPrevCursor = null;
    this.tailNextCursor = null;
    if (this.seenKeys) this.seenKeys.clear();
    // Reset page numbering
    this.nextPageNumber = 1;
    this.prevPageNumber = 0;
  }

  // ---- Loading ----
  /**
   * Load the first page (drops all existing state).
   * @param {Record<string, any>} [extra]
   * @returns {Promise<Page<T>>}
   */
  async loadInitial(extra = undefined) {
    this.reset();
    const res = await this.fetchPage({ limit: this.limit, extra });
    const page = this.#makePage(res);
    page._pageNumber = this.nextPageNumber++;
    this.pages.push(page);
    this.totalItems = Number.isFinite(res?.total) ? Number(res.total) : this.items().length;
    // Initialize headPrevCursor from the first page so hasPrev reflects server truth immediately
    this.headPrevCursor = page.prevCursor || null;
    this.tailNextCursor = page.nextCursor || null;
    return page;
  }

  /**
   * Load the next page (append to tail). No-op if already loading or no next cursor.
   * @param {Record<string, any>} [extra]
   * @returns {Promise<Page<T>|null>}
   */
  async loadNext(extra = undefined) {
    if (this.loadingNext) return null;
    if (!this.tailNextCursor) return null;
    this.loadingNext = true;
    try {
      let attempts = 0;
      while (attempts < 3 && this.tailNextCursor) {
        attempts++;
        const res = await this.fetchPage({ limit: this.limit, cursor: this.tailNextCursor, extra });
        const page = this.#makePage(res);
        // TEMP DEBUG: received cursors for next page
        devLog('[PagedWindow] Received next page with cursors:', {
          prevCursor: page.prevCursor || null,
          nextCursor: page.nextCursor || null,
          total: res?.total ?? undefined,
          itemCount: page.items?.length || 0,
        });
        devLog('[PagedWindow] Current state before adding page:', {
          pagesCount: this.pages.length,
          headPrevCursor: this.headPrevCursor,
          tailNextCursor: this.tailNextCursor,
        });
        
        // Update total regardless (if provided)
        this.totalItems = Number.isFinite(res?.total) ? Number(res.total) : this.items().length;
        
        if (page.items.length) {
          // Only advance cursor when we have actual items to avoid skipping valid pages
          this.tailNextCursor = page.nextCursor || null;
          page._pageNumber = this.nextPageNumber++;
          devLog('[PagedWindow] Page object before push:', {
            pageNumber: page._pageNumber,
            itemCount: page.items.length,
            prevCursor: page.prevCursor,
            nextCursor: page.nextCursor,
          });
          this.pages.push(page);
          devLog(`[PagedWindow] Loaded page ${page._pageNumber}. Current window: [${this.#getCurrentWindowNumbers().join(', ')}]`);
          devLog('[PagedWindow] Before eviction:', {
            pagesCount: this.pages.length,
            headPrevCursor: this.headPrevCursor,
            maxPages: this.maxPages,
            allPagesPrevCursors: this.pages.map(p => ({ num: p._pageNumber, prev: p.prevCursor ? 'has' : 'null' })),
          });
          this.#evictIfNeeded('head');
          devLog('[PagedWindow] After eviction:', {
            pagesCount: this.pages.length,
            headPrevCursor: this.headPrevCursor,
            firstPagePrevCursor: this.pages[0]?.prevCursor || null,
            allPagesPrevCursors: this.pages.map(p => ({ num: p._pageNumber, prev: p.prevCursor ? 'has' : 'null' })),
          });
          return page;
        } else {
          // If page is empty (after deduplication), advance cursor but don't give up yet
          // Only set to null if the server explicitly says there's no next cursor
          if (page.nextCursor) {
            this.tailNextCursor = page.nextCursor;
            devLog('[PagedWindowManager] Empty page, advancing cursor and retrying');
          } else {
            // Server says no more pages available
            this.tailNextCursor = null;
            devLog('[PagedWindowManager] No more pages available (server returned no nextCursor)');
            break;
          }
        }
        // If empty, loop to try the next cursor (up to 3 times) without pushing an empty page
      }
      return null;
    } finally {
      this.loadingNext = false;
    }
  }

  /**
   * Load the previous page (prepend to head) using before_cursor. No-op if already loading or no prev cursor.
   * @param {Record<string, any>} [extra]
   * @returns {Promise<Page<T>|null>}
   */
  async loadPrev(extra = undefined) {
    if (this.loadingPrev) return null;
    if (!this.headPrevCursor) return null;
    this.loadingPrev = true;
    try {
      let attempts = 0;
      while (attempts < 3 && this.headPrevCursor) {
        attempts++;
        const res = await this.fetchPage({ limit: this.limit, before_cursor: this.headPrevCursor, extra });
        const page = this.#makePage(res);
        // TEMP DEBUG: received cursors for prev page
        devLog('[PagedWindow] Received prev page with cursors:', {
          prevCursor: page.prevCursor || null,
          nextCursor: page.nextCursor || null,
          total: res?.total ?? undefined,
        });
        
        // Update total regardless (if provided)
        this.totalItems = Number.isFinite(res?.total) ? Number(res.total) : this.items().length;
        
        if (page.items.length) {
          // Only advance cursor when we have actual items to avoid skipping valid pages
          this.headPrevCursor = page.prevCursor || null;
          
          // Assign page number relative to existing pages
          if (this.pages.length > 0) {
            const firstExistingPage = this.pages[0];
            page._pageNumber = (firstExistingPage._pageNumber || 1) - 1;
          } else {
            page._pageNumber = this.prevPageNumber--;
          }
          
          this.pages.unshift(page);
          devLog(`[PagedWindow] Loaded page ${page._pageNumber}. Current window: [${this.#getCurrentWindowNumbers().join(', ')}]`);
          this.#evictIfNeeded('tail');
          
          // CRITICAL FIX: Update tailNextCursor after backward pagination
          // This ensures forward pagination works correctly after going backward
          if (this.pages.length > 0) {
            const lastPage = this.pages[this.pages.length - 1];
            this.tailNextCursor = lastPage.nextCursor || null;
            devLog('[PagedWindow] Updated tailNextCursor after loadPrev:', this.tailNextCursor);
          }
          
          return page;
        } else {
          // If page is empty (after deduplication), advance cursor but don't give up yet
          // Only set to null if the server explicitly says there's no prev cursor
          if (page.prevCursor) {
            this.headPrevCursor = page.prevCursor;
            devLog('[PagedWindowManager] Empty page, advancing prev cursor and retrying');
          } else {
            // Server says no more previous pages available
            this.headPrevCursor = null;
            devLog('[PagedWindowManager] No more previous pages available (server returned no prevCursor)');
            break;
          }
        }
        // If empty, loop to try the previous cursor (up to 3 times) without unshifting an empty page
      }
      return null;
    } finally {
      this.loadingPrev = false;
    }
  }

  /**
   * @private
   * @param {{ items: T[]; nextCursor?: string|null; prevCursor?: string|null }} res
   * @returns {Page<T>}
   */
  #makePage(res) {
    const raw = Array.isArray(res?.items) ? res.items : [];
    const items = this.seenKeys ? this.#dedupe(raw) : raw.slice();
    return {
      items,
      nextCursor: (res && typeof res.nextCursor !== 'undefined') ? (res.nextCursor ?? null)
                 : (res && typeof res.next_cursor !== 'undefined') ? (res.next_cursor ?? null)
                 : null,
      prevCursor: (res && typeof res.prevCursor !== 'undefined') ? (res.prevCursor ?? null)
                 : (res && typeof res.prev_cursor !== 'undefined') ? (res.prev_cursor ?? null)
                 : null,
      total: (res && typeof res.total !== 'undefined') ? res.total : undefined,
      unfiltered_total: (res && typeof res.unfiltered_total !== 'undefined') ? res.unfiltered_total : undefined,
    };
  }

  /**
   * @private
   * @param {T[]} arr
   * @returns {T[]}
   */
  #dedupe(arr) {
    if (!this.seenKeys) return arr.slice();
    const out = [];
    for (const it of arr) {
      const k = this.keyOf(it);
      if (!this.seenKeys.has(k)) {
        this.seenKeys.add(k);
        out.push(it);
      }
    }
    return out;
  }

  /**
   * Get current window state as page numbers for logging
   * @private
   * @returns {number[]}
   */
  #getCurrentWindowNumbers() {
    return this.pages.map(page => page._pageNumber || 0).filter(n => n > 0);
  }

  /**
   * @private
   * @param {'head'|'tail'} side - If evicting due to append (next), drop from head; if due to prepend (prev), drop from tail.
   */
  #evictIfNeeded(side) {
    while (this.pages.length > this.maxPages) {
      // Check if we should avoid eviction due to small page sizes
      if (this.#shouldAvoidEviction(side)) {
        devLog('[PagedWindowManager] Avoiding eviction - insufficient content for navigation');
        break;
      }
      
      if (side === 'head') {
        const removed = this.pages.shift();
        this.#forgetKeys(removed);
        // When evicting from head during forward pagination, we need to maintain
        // the ability to paginate backward. The new first page's prevCursor points
        // to the page we just evicted, which we CAN reload via backward pagination.
        // So we should use the new first page's prevCursor as our headPrevCursor.
        if (this.pages.length > 0) {
          this.headPrevCursor = this.pages[0].prevCursor || null;
          devLog('[PagedWindow] Updated headPrevCursor from new first page:', this.headPrevCursor);
        } else {
          this.headPrevCursor = null;
        }
        devLog(`[PagedWindow] Evicted page ${removed?._pageNumber || '?'}. Current window: [${this.#getCurrentWindowNumbers().join(', ')}]`);
        devLog('[PagedWindow] After head eviction, headPrevCursor =', this.headPrevCursor);
      } else {
        const removed = this.pages.pop();
        this.#forgetKeys(removed);
        // Update tailNextCursor to the remaining last page's next
        this.tailNextCursor = this.pages.length ? (this.pages[this.pages.length - 1].nextCursor || null) : null;
        devLog(`[PagedWindow] Evicted page ${removed?._pageNumber || '?'}. Current window: [${this.#getCurrentWindowNumbers().join(', ')}]`);
      }
    }
  }

  /**
   * @private
   * @param {'head'|'tail'} side
   * @returns {boolean} True if we should avoid eviction to maintain sufficient content
   */
  #shouldAvoidEviction(side) {
    if (this.pages.length <= 2) return true; // Always keep at least 2 pages
    
    // Calculate total items across all pages
    const totalItems = this.pages.reduce((sum, page) => sum + (page.items?.length || 0), 0);
    
    // If we have very few items total, avoid eviction
    if (totalItems < 50) {
      return true;
    }
    
    // If the last page is very small and we're evicting from head, avoid it
    if (side === 'head' && this.pages.length > 0) {
      const lastPage = this.pages[this.pages.length - 1];
      if (lastPage && lastPage.items && lastPage.items.length < 20) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * @private
   * @param {Page<T>|undefined} page
   */
  #forgetKeys(page) {
    if (!page || !this.seenKeys || !Array.isArray(page.items)) return;
    for (const it of page.items) {
      try {
        const k = this.keyOf(it);
        this.seenKeys.delete(k);
      } catch {}
    }
  }
}
