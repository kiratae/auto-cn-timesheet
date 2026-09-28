# Open Dev API Spec (ClickNext Timesheet)

Source: https://timesheet.clicknext.com/docs/open-dev-spec.html

| | |
|---|---|
| Base URL | `https://timesheet.clicknext.com` |
| Auth | `x-api-key: <apiKey>` header (keys look like `tcs_...`) |
| Content type | `application/json` for request bodies |
| Prefix | `/api/open/dev/v1` |

## Endpoints

| Method | Path | Purpose | Success |
|---|---|---|---|
| GET | `/projects` | List the token owner's visible projects, including task types | 200 |
| GET | `/time-sheets/{date}` | List the token owner's time sheets for `YYYY-MM-DD` | 200 |
| POST | `/time-sheets` | Create a time sheet | 201 |
| PUT | `/time-sheets` | Update an unapproved time sheet (`id` in body) | 200 |
| DELETE | `/time-sheets` | Delete an unapproved time sheet (`id` in body) | 200 |

Common errors: `401 Unauthorized`, `500 Internal Server Error`.
Endpoint-specific `400`s:
- GET by date: date missing / invalid format
- POST: validation error / overlapping time
- PUT: validation / not found / already approved / overlapping time
- DELETE: id missing / not found / already approved

### GET /projects

```json
{
  "data": [
    {
      "id": "uuid",
      "code": "CN-DEMO",            // nullable
      "name": "Customer Portal",
      "color": "slate",             // nullable
      "isCompanyProject": false,
      "taskTypes": [
        {
          "name": "Development",
          "items": [
            { "id": "uuid", "name": "Frontend Development", "description": "..." }
          ]
        }
      ],
      "startDate": "2026-06-17T00:00:00.000Z",  // nullable, from membership or project
      "endDate": null                           // nullable, from membership, maintenance, or project
    }
  ]
}
```

`taskTypes[].items[].id` is the `project_task_type_id` you use when creating a time sheet.

### GET /time-sheets/{date}

```json
{
  "data": [
    {
      "id": "uuid",
      "stamp_date": "2026-06-17",
      "start_date": "2026-06-17T10:00:00.000Z",
      "end_date": "2026-06-17T11:00:00.000Z",
      "total_seconds": 3600,
      "exclude_seconds": 0,
      "project_id": "uuid",
      "project_task_type_id": "uuid",
      "project_name": "Customer Portal",
      "detail": "...",
      "remark": "...",
      "feeling": "NEUTRAL",
      "isWorkFromHome": true,
      "is_approved": false,
      "task_type_name": "Frontend Development",
      "tone": "slate"
    }
  ]
}
```

### POST / PUT /time-sheets: request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | PUT only | Time sheet to update |
| `project_id` | uuid | yes | Must not be empty or `none` |
| `project_task_type_id` | uuid | yes | Must not be empty or `none` |
| `exclude` | integer | no | Break time in **seconds**, default `0` |
| `stamp_date` | date-time | yes | Day the entry belongs to, e.g. `2026-06-17T00:00:00.000Z` |
| `start_date` | date-time | yes | UTC, must be before `end_date` |
| `end_date` | date-time | yes | UTC, must be after `start_date` |
| `detail` | string | yes | Max 5000 chars, no HTML/script |
| `remark` | string | no | Max 255 chars |
| `feeling` | enum | no | `TERRIBLE \| BAD \| NEUTRAL \| GOOD \| GREAT`, default `NEUTRAL` |
| `isWorkFromHome` | boolean | no | Default `false` |

The server computes `total_seconds` as `(end_date - start_date) - exclude`. Example: 1h with `exclude: 2000` gives `1600`.

Response (`201 "Created successfully"` / `200 "Updated successfully"`):

```json
{
  "message": "Created successfully",
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "project_id": "uuid",
    "project_task_type_id": "uuid",
    "stamp_date": "2026-06-17T00:00:00.000Z",
    "start_date": "2026-06-17T10:00:00.000Z",
    "end_date": "2026-06-17T11:00:00.000Z",
    "exclude_seconds": 0,
    "total_seconds": 3600,
    "detail": "...",
    "remark": "...",
    "is_work_from_home": true,
    "is_approved": false,
    "feeling": "NEUTRAL",
    "created_at": "2026-06-17T11:00:00.000Z"
  }
}
```

### DELETE /time-sheets

Body: `{ "id": "uuid" }`. Response: `{ "message": "Deleted successfully" }`.

## Gotchas

- **Inconsistent casing.** The request uses `isWorkFromHome` and `exclude`. POST/PUT responses return `is_work_from_home` and `exclude_seconds`. GET by date returns `isWorkFromHome`.
- **`stamp_date` format varies.** It is `YYYY-MM-DD` in GET by date and a full ISO date-time in POST/PUT responses.
- **Approved entries are locked.** PUT and DELETE return 400 once `is_approved` is true.
- **Overlapping time ranges are rejected** with a 400 on both create and update.
- **All times are UTC.** For Thai time (UTC+7), 17:00 local is `10:00:00.000Z`.

## Error shapes

```json
{ "message": "Unauthorized" }
```

```json
{ "message": "Body is not valid", "success": false, "errors": [] }
```

## Example

```bash
curl --location 'https://timesheet.clicknext.com/api/open/dev/v1/time-sheets' \
  --header "x-api-key: $API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "project_id": "<uuid>",
    "project_task_type_id": "<uuid>",
    "exclude": 0,
    "stamp_date": "2026-06-17T00:00:00.000Z",
    "start_date": "2026-06-17T10:00:00.000Z",
    "end_date": "2026-06-17T11:00:00.000Z",
    "detail": "Work description",
    "feeling": "NEUTRAL",
    "isWorkFromHome": true
  }'
```
