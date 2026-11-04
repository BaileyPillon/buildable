# Private PDF Toolkit

A PDF toolkit that runs entirely in your browser. No backend, no accounts, no uploads: your files are read
by JavaScript running in the page and the results are handed back as downloads. It is an installable
Progressive Web App (PWA), so it can also run in its own window and offline.

**Stack:** Vite, TypeScript, [pdf-lib](https://pdf-lib.js.org/) (editing), [pdf.js](https://mozilla.github.io/pdf.js/) (rendering),
[tesseract.js](https://github.com/naptha/tesseract.js) (optional OCR). Everything is bundled locally: no CDN, no web fonts, no external API.

## What it does

| Tool | What you can do |
| --- | --- |
| **Merge & organize** | Add several PDFs, see every page as a thumbnail, **drag pages to reorder** (or use the arrow buttons), rotate pages left/right, delete pages (with undo), then download one PDF. |
| **Split & extract** | Pick pages by clicking thumbnails or typing ranges like `1-3, 5, 8-`. Extract them into one PDF, split into one PDF per range, or split every N pages. Several results download as a .zip. |
| **Fill & sign** | Type into the PDF's form fields (text, checkbox, radio, dropdown, list), drop **text boxes** anywhere, and place a **typed or drawn signature** (move, resize, delete). Optionally flatten the form. |
| **Compress** | Re-renders every page as a **JPEG at the quality and resolution you choose**. A prominent warning (and a required tick box) says this **flattens text** into pictures. Shows before/after size and warns if the result is bigger. |
| **OCR** | Turns a scanned PDF into a searchable one by adding an invisible text layer over the original page images. English. Also offers the recognized text as a .txt file. |
| **Recent files** | A list of **file names, sizes and the tool used** in IndexedDB. File contents are never stored anywhere. |

## Privacy model

* There is no server code. The app is static files.
* Files are read with the File API, processed in memory, and saved back with a download link. Nothing is sent anywhere.
* The app is built to run under a strict Content-Security-Policy:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'; object-src 'none'`.
  With `connect-src 'self'` the page cannot talk to any other site, so even a bug could not upload a document.
  The policy is shipped as `public/_headers` (Cloudflare Pages) and as a `<meta>` tag in the built `index.html` (GitHub Pages).
* The recent-files list stores `{name, size, tool, openedAt}` only (see `src/lib/recent.ts` and its test).
  Browsers do not let a web page reopen a file by name, so clicking a recent entry takes you to the right tool and asks you to pick the file again.
* Signatures you create live in memory until you close the tab. They are never written to storage.
* The service worker caches only the app's own static files.

## Run it

```bash
npm install
npm run dev        # development server (copies pdf.js / tesseract assets into public/vendor first)
npm test           # unit tests (vitest)
npm run build      # type-checks, then builds to dist/ (relative base './', works from any sub-path)
npm run preview    # serve dist/ locally
npm run serve:csp  # serve dist/ with the strict CSP header, to check it behaves under the policy
```

Unit tests cover merge, split (ranges / every N / single pages), extract, rotate, delete and reorder using the
small sample PDFs in `tests/samples/` (regenerate with `node scripts/make-samples.mjs`), plus page-range parsing,
form filling, text/signature stamping, coordinate mapping for rotated pages, the OCR text layer, the ZIP writer
and the recent-files store.

## Deploy for free

The build output is plain static files in `dist/`. Nothing needs a server.

### Cloudflare Pages

1. Push this folder to a Git repository (GitHub or GitLab).
2. Cloudflare dashboard, Workers & Pages, Create, Pages, Connect to Git, choose the repository.
3. Build command: `npm run build`. Build output directory: `dist`. (Node 20 or newer.)
4. Save and deploy. Your app is at `https://<project>.pages.dev/`. The included `public/_headers` file sets the CSP and security headers automatically.

Or, without Git: run `npm run build` and drag the `dist` folder onto Pages, Create, Direct Upload.

### GitHub Pages

1. Push to a GitHub repository whose default branch is `main`.
2. Repository Settings, Pages, Build and deployment, Source: **GitHub Actions**.
3. The included workflow `.github/workflows/deploy-pages.yml` runs the tests, builds, and publishes on every push.
4. Your app is at `https://<user>.github.io/<repo>/`. The relative `./` base means no configuration is needed for the sub-path.

## Install it from the browser

Once the site is open over HTTPS, it can be installed like an app (no app store):

* **Chrome / Edge on a computer:** click the install icon at the right end of the address bar, or open the menu and choose *Install Private PDF Toolkit* (Edge: *Apps, Install this site as an app*). The app also shows its own **Install app** button when the browser offers it.
* **Chrome on Android:** menu, *Install app* (or *Add to Home screen*).
* **Safari on iPhone / iPad:** Share, *Add to Home Screen*.
* **Safari on Mac:** File, *Add to Dock*.
* **Firefox:** desktop Firefox does not install web apps; bookmark the page instead. It still works offline after the first visit. On Android use menu, *Install*.

After the first visit the app shell is cached by a service worker, so it opens offline. The OCR engine and English language data
(about 9 MB) are downloaded from the same site the first time you use OCR and cached afterwards; the OCR tab also has a
**Save OCR files for offline use** button to fetch them ahead of time.

## About OCR and the Content-Security-Policy

tesseract.js normally runs Tesseract as WebAssembly. A strict policy without `'wasm-unsafe-eval'` makes browsers refuse to
compile WebAssembly (tested in Chromium). So this app uses **tesseract.js 2.1.5**, which ships both a WebAssembly core and a
**pure-JavaScript (asm.js) core**, and picks one at run time:

* If the page may compile WebAssembly (for example on a host with no CSP header): WebAssembly core, faster.
* If not (the strict policy above): JavaScript core. It works with no policy change; expect roughly 6 seconds for a sparse page at 150 DPI on a modern laptop, and up to a minute for a dense full page at 200 to 300 DPI.

The worker is loaded from a same-origin file (not a `blob:` URL), the engine files and the English model are served from `vendor/tesseract/`, and
the library's default CDN addresses are always overridden, so OCR never makes an outside request. More languages: add
`<lang>.traineddata.gz` files to `public/vendor/tesseract/lang/` (see `scripts/copy-assets.mjs`) and extend `src/lib/ocr.ts`.

## What it cannot do compared with Acrobat Pro

Be honest about the gaps before relying on this for anything critical.

**Editing**
* **No editing of existing text, images or layout.** You can only add new text boxes and signature images. There is no "Edit PDF" text reflow, no image replacement, no fonts matching.
* **No true redaction** (permanent removal of content), no sanitize, no remove hidden information.
* No crop, resize, header/footer, Bates numbering, watermark, background, page labels, or bookmarks/links editing.
* Text boxes use the standard PDF fonts (Helvetica, Times, Courier), so characters outside Western European text are replaced with `?`.
* No markup tools: highlight, strikethrough, comments, sticky notes, stamps, measuring.

**Forms and signatures**
* Fills existing AcroForm fields only. It cannot **create or design forms**, and it does not run form JavaScript (calculations, formatting, validation). **XFA forms** are not supported.
* Signatures are **images**, not cryptographic. There is no certificate-based digital signing, no signature validation, no timestamps, and no e-sign request or tracking workflow.

**Security and standards**
* **Password-protected / encrypted PDFs cannot be opened**, and it cannot add passwords, encryption or permission restrictions.
* No PDF/A, PDF/X or PDF/UA conversion, no Preflight, no accessibility tagging or reading-order tools.

**Merge, split and compress**
* Merging and splitting copy pages only: **bookmarks, named destinations, tags and interactive form fields are not carried over**.
* **Compression is lossy and flattening.** It turns each page into a JPEG, so text is no longer selectable or searchable, links and form fields disappear, and a mostly-text PDF can get *larger*. Acrobat's optimizer can downsample images selectively, subset fonts, remove unused objects and keep text; this cannot.

**OCR**
* English only in this build, no handwriting recognition, no automatic deskew or cleanup, no recognition of tables or columns into structure, and slower than Acrobat (especially under a strict CSP).
* Output text is placed in a standard Latin font layer, so non-Latin recognized characters are dropped.

**Conversion and workflow**
* No export to Word, Excel, PowerPoint or images, no creation of PDFs from Office files or web pages, no combining of non-PDF files, no compare-documents.
* No scanning from a scanner, no batch "actions", no shared review, cloud storage, or sync between devices.

**Practical limits**
* Everything is held in browser memory. Very large files (hundreds of MB) or thousands of pages may be slow or fail, especially on phones.
* Drag-and-drop reordering uses the browser's drag events, which do not work on most touch screens; the page cards have move-earlier/later buttons instead.
* Some unusual PDFs (broken structure, exotic features) may fail in pdf-lib or pdf.js even though Acrobat opens them.

## Project layout

```
index.html, src/main.ts      app shell and router
src/ui/*.ts                  one file per tool (organize, split, fill, compress, ocr, home) + signature dialog
src/lib/pdfops.ts            merge, split, extract, rotate, delete, assemble (pdf-lib)
src/lib/ranges.ts            "1-3, 5, 8-" parsing
src/lib/formfields.ts        read and fill AcroForm fields
src/lib/annotate.ts          draw text boxes and signature images
src/lib/geometry.ts          view <-> PDF coordinates (rotation, crop box)
src/lib/textlayer.ts         invisible OCR text layer
src/lib/pdfjs.ts, ocr.ts, compress.ts   rendering, OCR engine, JPEG re-render
src/lib/recent.ts            recent-files list (names only)
scripts/                     asset copying, service worker generator, icons, sample PDFs, CSP test server
tests/                       unit tests and sample PDFs
```

## Licenses of bundled components

pdf-lib (MIT), pdf.js (Apache-2.0), tesseract.js (Apache-2.0), tesseract.js-core (Apache-2.0), and the Tesseract English
`eng.traineddata` model (Apache-2.0, from `@tesseract.js-data/eng`).
