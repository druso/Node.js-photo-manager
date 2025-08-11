# Next-Plan

## Chapter 1 — Scalable Sorting and Pagination

To keep the UI snappy as projects grow, we page and sort results from the backend using SQLite.

### Goals

- Provide fast, stable sorting for very large photo sets (100k+).
- Return the first N (e.g., 1000) photos quickly; fetch subsequent pages on demand.
- Keep frontend complexity and memory usage low.

### Database Choice

- SQLite via `better-sqlite3`.
- Tables: `projects`, `photos`, `tags`, `photo_tags`. Data is written directly by routes during upload/import and updated during processing.

Example schema (simplified):

```sql
-- Fields mirror `SCHEMA_DOCUMENTATION.md` (SQLite section) where applicable
CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  manifest_id TEXT UNIQUE,                -- manifest entry id (string)
  filename TEXT NOT NULL,                 -- full filename with extension
  basename TEXT,                          -- filename without extension (optional)
  ext TEXT,                               -- extension (optional)
  created_at TEXT,                        -- ISO
  updated_at TEXT,                        -- ISO
  date_time_original TEXT,                -- from metadata.date_time_original (ISO)
  jpg_available INTEGER NOT NULL,         -- 0/1
  raw_available INTEGER NOT NULL,         -- 0/1
  other_available INTEGER,                -- 0/1 (schema: other_available)
  keep_jpg INTEGER,                       -- 0/1
  keep_raw INTEGER,                       -- 0/1
  thumbnail_status TEXT,                  -- pending|generated|failed|not_supported
  preview_status TEXT,                    -- pending|generated|failed|not_supported
  orientation INTEGER,                    -- metadata.orientation 1..8
  meta_json TEXT                          -- raw metadata JSON
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE photo_tags (
  photo_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (photo_id, tag_id)
);

-- Indexes for common sorts/filters
CREATE INDEX idx_photos_manifest_id ON photos(manifest_id);
CREATE INDEX idx_photos_filename ON photos(filename);
CREATE INDEX idx_photos_basename ON photos(basename);
CREATE INDEX idx_photos_ext ON photos(ext);
CREATE INDEX idx_photos_date ON photos(date_time_original);
CREATE INDEX idx_photos_raw ON photos(raw_available);
CREATE INDEX idx_photos_orientation ON photos(orientation);
```

### API Contract (paging + sorting)

Endpoint (example):

```
GET /api/projects/:project/list?sort=date|name|filetypes|tags&dir=asc|desc&limit=1000&cursor=<opaque>
filters: text, raw=1, orientation=vertical|horizontal, date_start, date_end
```

Behavior:

- Returns the first page (default `limit=1000`).
- Response includes `items` (photos) and `nextCursor` (null if last page).
- Subsequent pages requested with the `cursor` (keyset pagination preferred over OFFSET for large sets).

Response shape (example):

```json
{
  "items": [ { "filename": "...", "date_time_original": "...", "raw_available": true, "jpg_available": true, "tags": ["..."] } ],
  "nextCursor": "<opaque-cursor-or-null>",
  "total": 65000
}
```

### Sorting strategies

- `date`: `ORDER BY date_time_original DESC|ASC, filename`
- `name`: `ORDER BY filename ASC|DESC`
- `filetypes`: derive score `(raw_available*2 + jpg_available)` and sort by score then filename
- `tags`: join/aggregate (`COUNT(photo_tags.tag_id)`) and sort by count; precompute `tag_count` column for speed.

### Frontend behavior

- Grid/table request only the first 1000 rows.
- Infinite scroll / "Load more" fetches the next page using `nextCursor`.
- Sort change resets to page 1.
- UI still shows user-friendly arrows and bold for the active sort, but heavy lifting is on the backend.

### Migration path

1. (Done) Replace manifest.json usage with SQLite repositories in all routes.
2. Implement and expose paging endpoint on the backend for large datasets.
3. Switch client listing to use paging endpoint (infinite scroll or load-more).

### Why this helps performance

- SQL indexes provide O(log n) seeks and optimized sorts.
- Keyset pagination avoids expensive `OFFSET` on large tables.
- The client only holds the current window (e.g., 1000 items), minimizing memory and re-render cost.
