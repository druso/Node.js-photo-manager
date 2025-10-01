# All Photos Locate-Page — Cheat Sheet

This endpoint lets you jump directly to the page that contains a specific photo in the global “All Photos” list (across all projects). It returns the page slice, where the photo sits in the overall filtered set, and compatible next/prev cursors.

Backend base URL (dev): http://localhost:5000

Route: GET /api/photos/locate-page

Required query params:
- project_folder: canonical folder (e.g., p2)
- filename or name: either full filename with extension (e.g., DSC04427.jpg) or basename without extension (e.g., DSC04427)

Optional filters:
- limit: 1–300 (default 100)
- date_from, date_to: YYYY-MM-DD (operates on taken_at := coalesce(date_time_original, created_at))
- file_type: any | jpg_only | raw_only | both
- keep_type: any | any_kept | jpg_only | raw_jpg | none
- orientation: any | vertical | horizontal

Response highlights:
- items: page slice of photos (same shape as /api/photos)
- position: 0-based rank of target in the filtered, global descending taken_at order
- page_index: 0-based page index for the given limit
- idx_in_items: 0-based index of the target within items
- next_cursor / prev_cursor: compatible with /api/photos
- target: minimal info about the resolved photo

Notes:
- 404 when the target photo doesn’t exist or is filtered out.
- 409 when using basename (name) that is ambiguous across projects (multiple matches). Pass filename with extension to disambiguate.
- Responses include Cache-Control: no-store. Endpoint is rate-limited to 60 req/min/IP.

---

## Quick Examples (realistic data)

These examples use sample data observed in curl/all_photos_out.json.

1) Locate by full filename (preferred)

```bash
curl -s "http://localhost:5000/api/photos/locate-page?project_folder=p2&filename=DSC04427.jpg&limit=60" | jq .
```

2) Locate by basename (may 409 if ambiguous)

```bash
curl -s "http://localhost:5000/api/photos/locate-page?project_folder=p2&name=DSC04427&limit=60" | jq .
```

3) Locate another known photo

```bash
curl -s "http://localhost:5000/api/photos/locate-page?project_folder=p1&filename=DSC04408.jpg&limit=60" | jq .
```

4) Locate with filters (date range + file/keep/orientation)

```bash
curl -s "http://localhost:5000/api/photos/locate-page?project_folder=p2&filename=DSC04427.jpg&limit=60&date_from=2025-08-15&date_to=2025-08-31&file_type=both&keep_type=any_kept&orientation=horizontal" | jq .
```

5) Handling errors

```bash
# 404: not found or filtered out
curl -s -i "http://localhost:5000/api/photos/locate-page?project_folder=p2&filename=NOT_A_FILE.jpg" | sed -n '1,20p'

# 409: ambiguous basename
curl -s -i "http://localhost:5000/api/photos/locate-page?project_folder=p2&name=CommonName" | sed -n '1,20p'
```

---

## Tip: Using returned cursors with /api/photos

The locate-page response includes next_cursor and prev_cursor that work with GET /api/photos (keyset pagination across all projects):

```bash
NEXT=$(curl -s "http://localhost:5000/api/photos/locate-page?project_folder=p2&filename=DSC04427.jpg&limit=60" | jq -r .next_cursor)

curl -s "http://localhost:5000/api/photos?limit=60&cursor=${NEXT}" | jq .
```

---

## Client helper

The client exports a typed helper:
- client/src/api/allPhotosApi.js → locateAllPhotosPage(opts)

Example:

```js
import { locateAllPhotosPage } from '@/api/allPhotosApi';
const res = await locateAllPhotosPage({ project_folder: 'p2', filename: 'DSC04427.jpg', limit: 60 });
```
