# Operator template gallery

A template is a ready-made Operator you can create from the **Create bot**
modal: a name, a job (label), a short description, and the instructions that
shape how the Operator works, plus its avatar shape, color, and mode.

Templates in this folder are a submission pool for the community. They are
**not loaded by the app yet** — the built-in templates in the Create bot
modal are still hard-coded in
`web/src/components/modals/CreateBotModal.tsx`. This folder exists so
contributors can propose new templates by PR; wiring the gallery into the
modal is separate work.

## File format

One JSON file per template, named `<id>.json`, with exactly the fields of
the `BotTemplate` shape in `CreateBotModal.tsx` — no extra fields:

| Field | Type | Limits |
| --- | --- | --- |
| `id` | string | kebab-case, unique across the folder, matches the filename |
| `title` | string | shown in the template picker |
| `name` | string | the Operator's name |
| `label` | string | max 60 characters |
| `description` | string | max 500 characters |
| `instructions` | string | max 8,000 characters |
| `shape` | string | one of `blob`, `cloud`, `square`, `sparkle`, `clover`, `heart`, `flower`, `teardrop`, `tablet`, `wedge`, `house`, `star`, `hex` |
| `color` | string | one of `black`, `brown`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `violet`, `magenta`, `gray` |
| `mode` | string | `personal` or `teammate` |

The shape and color lists come from `PICKER_SHAPES` in
`web/src/avatar/BotAvatar.tsx` and `COLOR_ORDER` in `web/src/lib/colors.ts`;
the length limits are the modal's own `maxLength` values. Every file in this
folder is checked by `tests/operator-templates.test.mjs` (run by `npm test`).

## How to submit a template

1. Copy `templates/morning-triage.json` to `templates/<your-id>.json`.
2. Fill in the fields. Keep the instructions honest about what the Operator
   can actually do: it can read email and files, draft messages, create
   tasks and routines — it cannot send external email or reschedule meetings
   without asking first, and it cannot see other Operators' tasks.
3. Run `npm run typecheck && npm run build && npm test` from the repo root.
4. Open a pull request. Add a row to the gallery below in the same PR.

## Gallery

| Template | What it does |
| --- | --- |
| [Morning Triage](morning-triage.json) | Triages the overnight inbox, flags what needs you, and preps the day's meeting briefs. |
