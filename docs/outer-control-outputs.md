# Outer Control: the look of a result, and the file it comes as

A finished result can be shown in five looks and taken away as five file types. The look is chosen before a Task starts (and can be changed any time); the files follow the look that is showing.

## The five looks

They differ in order, layout and type, not only in colour. All five are drawn from one model of the result (`outer-control-result-doc.ts`), so none of them can say something the others do not.

| Look | For | Structure | Type and colour |
|---|---|---|---|
| **NazAI dark** (default) | the original | sections as cards; the answer near the end | dark blue, cyan |
| **Executive brief** | decisions | the answer first, in a box; sources in an appendix | white and navy, teal |
| **Editorial** | reading | article: lede, working, then "In conclusion"; sources as pull-quotes | serif on warm paper, terracotta |
| **One-page brief** | sharing | compact and numbered; the decision at the top; agreements and differences side by side; sources as footnotes | black and white, orange |
| **Data sheet** | checking | every section is a table of rows | monospace headings, grey and teal |

`TEMPLATE_INFO` (`src/lib/outer-control-templates.ts`) holds each look's name, colours, type and section order. The names are fixed in `OUTPUT_TEMPLATES` (`outer-control-report-doc.ts`, identical in `src/lib` and `supabase/functions/_shared`; a test fails when the two copies differ) and in the database check below.

A report that is still in the original look is drawn by the report's own page (`reportHtml`), exactly as downloaded before the looks existed.

## Choosing before a Task starts

*Start a task* shows **Look of the result** once NazAI has read the request. The original look is pre-selected and marked default.

- **The request already says what it wants** (`detectRequestedOutput`): a file type ("as a PDF", "in Excel", "a Word document", "CSV", "markdown") or a place it is meant for ("an email", "a LinkedIn post", "a slide deck", "a README", "a memo"…). Then NazAI follows it, the look is not asked for, and no look is sent. A line says so, with **Choose a look anyway**. The file type that was asked for is listed first in the result's *Download as* menu, marked **asked for**.
- A look other than the original is sent with the request (`start_report` → `template`, validated against the list; an unknown name is refused with `invalid_template` before any credit is used). The original look is not sent: no choice and the original are the same thing.
- The choice is kept on the Task (`outer_control_workflows.output_template`, migration `20261114031025`, classified OPERATIONAL, check constraint on the five names) and stamped into the Task's final artifact (`final_artifact.template`) when it completes. An artifact whose look is not one of the five is **not valid**, so it can never be shown as Completed.

Only *Start a task* (report Tasks) takes a look today. A single session or a goal Task has none and opens in the original look; the viewer can switch.

## Files

On a finished result, **Download as** offers Word (.docx), PDF, Excel (.xlsx), CSV and Markdown, in the section order and colours of the look that is showing. The older **Download** button still gives the web page (or the text file, for a plain result in the original look).

| File | What is in it |
|---|---|
| `.docx` | title, kind and note; headings, paragraphs, real bullets, real tables with a coloured header row; the answer shaded in looks that lift it; quotes with their source. Fonts and heading colours follow the look. Opens in Word, Pages, LibreOffice and Google Docs. |
| `.pdf` | A4, white paper, the look's colours and type (Helvetica, Times, Courier headings), wrapped text, tables, bars for quotes, "page n of N" on every page. |
| `.xlsx` | sheet *Result* with a frozen header row (Section, Type, Item, Text), plus one sheet per table (side by side, options). |
| `.csv` | the same rows as the *Result* sheet; UTF-8 with a byte-order mark so Excel reads accents; a cell that starts like a formula is made plain text. |
| `.md` | headings, bullets, quotes, tables (pipes escaped). |

Built in the browser (`outer-control-files.ts`); no library and nothing is sent anywhere. `.docx` and `.xlsx` are zip packages of small XML files; the PDF is written directly.

**Limits, said plainly**

- A standard-font PDF holds Western European text (Latin letters, accents, € and typographic quotes, a few arrows and symbols). It cannot hold Arabic, Hebrew, Greek, Cyrillic, CJK or emoji. For such a result *PDF* opens the browser's print dialog on the styled page instead ("Save as PDF" there holds any script) and says so; Word, Excel, CSV and Markdown hold any script.
- The PDF is always white paper in the look's colours; it does not copy the dark page background.
- Cells are text: no formulas.
- A look's preview in the app is a sandboxed frame (`sandbox=""`): nothing in the result can run or reach the page. All text is escaped; a test feeds markup through every look.

## What was checked

`src/test/outer-control-files.test.ts` (looks, the result model, every file type for every kind of result in every look: zip checksums, well-formed XML, an exact PDF cross-reference table, formula and markup safety, the PDF "no" for other scripts), `src/test/result-formats.test.tsx` (picker, preview, menu, downloads), `src/test/tools-connect-and-report.test.tsx` (the choice before a Task), `src/test/outer-control-artifact.test.ts`, and the engine test "look: …". The generated `.docx` and `.xlsx` were also opened with LibreOffice (converted to PDF and CSV) and the `.pdf` with `pdfinfo`/`pdftotext`; the looks were rendered in Chromium and looked at.

## Also fixed with this change

The weekly classification check was going to open an incident: the recovery-code tables had classes for columns the report does not count, and `agent_integrations.credentials` (dropped on 2026-11-11) still had a class and a storage rule. The same migration removes them; `classification_report()` is empty afterwards. A guard test mistook a class name of ten or more letters for an encryption exemption; it now ignores class names.
