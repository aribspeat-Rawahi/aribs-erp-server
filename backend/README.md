# Aribs ERP Backend

## Ei step-e ki ase (PURA ERP — shob module, real MySQL-e test kora)
- `raw_materials` — kacha maal er stock track kore
- `finished_goods` — toiri product er stock, barcode soho (GS1 othoba manual — tumi nijei bosao, auto-generate hoy na)
- Stock-in / Stock-out API — scanner (handheld/camera) othoba manual, duitai
  same endpoint use kore
- Low-stock check — kono material/product threshold er niche gele dhora jai
- **BOM (recipe)** — kon product banate kon raw material koto lagbe, seta set kora jai
- **Production Order** — production run plan kora, complete korle:
  - BOM onujayi shob raw material auto kome jabe
  - Finished goods stock auto barbe
  - Kono material kom thakle age theke error dekhabe, kichu consume hobe na (all-or-nothing)
- **Supplier** — supplier list, contact info
- **Purchase Order** — supplier theke raw material order kora, `receive` korle stock auto barbe + latest cost update hobe
- **Customer** — customer list, `vatApplicable: false` set korle bujhbe VAT lagbe na
- **Sales Order** — order create korar somoy stock touch hoy na, `complete` korle:
  - Finished goods stock auto kome jabe
  - Payment type (Cash / Bank Transfer / Card Machine / Cheque / Conditional) set kora jai
  - Price manually override kora jai (unitPrice field-e nijer dam bosao)
- **Quotation** — same format invoice-er moto, price manually adjust kora jai. `convert-to-invoice` diye
  ek click-e Invoice banano jai
- **Invoice** — Oman VAT standard mainte kore:
  - Sequential, gap-free invoice number (INV-2026-0001 style)
  - VAT calculation (5%), othoba VAT excluded korle CEO/MD/Accountant-ke email jabe (.env-e email set korte hobe)
  - PDF auto generate hoy, watermark logo soho (logo path .env-e disi diye)
  - Version history: same-date edit korle PDF replace hoy, alada date-e edit korle notun version toiri hoy
  - WhatsApp send link (`/invoices/:id/whatsapp-link`) — free wa.me link, kono paid API na
- **Employee (HR)** — kormochari list, role (CEO/MD/Accountant/Production/Sales/Admin)
- **Attendance** — protidin ekjon employee-r ekta attendance record — check-in/check-out/status
- **Expense** — babosay-r kharoch record kora (rent, utilities, salary, ityadi category diye)
- **Accounting Summary** — `/accounting/summary?startDate=...&endDate=...` diye ekta din/mash-er
  revenue (invoice theke) minus expense = net profit dekha jai
- **Reporting** — `/reports/low-stock` (raw material + finished goods ekshathe), `/reports/summary`
  diye sales+production+accounting ekshathe ek call-e
- **Auth (Users/Login)** — `/auth/register`, `/auth/login` (JWT token), role: admin/ceo/md/accountant/
  production/sales. Sensitive endpoint (jemon `/activity-logs`) shudhu nirdisto role-er jonno lock kora
- **Settings** — `/settings` diye company info + default invoice template set kora jai, `/settings/logo`
  (POST, multipart file) diye company logo upload — eta shob invoice template-er watermark/header-e use hobe
- **Invoice Template switch** — 3 ta design ase: `classic` (round logo, minimal), `formal` (bordered box,
  bank details + 3 signature), `po_style` (letterhead, Gross/Taxable/VAT/Net breakdown). Settings-e default
  set kora jai, ba invoice create korar somoy `template` field diye override kora jai
- **Activity Log** — `/activity-logs` (admin/ceo/md only) — VAT-exclude howa invoice gulor track thake

## Local-e test korar jonno
1. `.env.example` copy kore `.env` banao, tomar MySQL details bosao
2. `npm install`
3. `npm run start:dev`
4. Server chalu hobe `http://localhost:3000`

## Test korar API example (Postman/curl diye)
- `POST /raw-materials` — notun raw material add
- `POST /finished-goods` — notun product add (barcode auto toiri hobe)
- `POST /finished-goods/stock-in` — production shesh hole scan/manual entry
  - body: `{ "barcode": "FG-XXXX", "quantity": 50 }`
- `POST /finished-goods/stock-out` — sale howar somoy scan/manual entry
- `GET /finished-goods/low-stock` — kon product kom ache
- `POST /bom` — recipe add: `{ "finishedGoodId": "...", "rawMaterialId": "...", "quantityPerUnit": 2.5 }`
- `POST /production-orders` — production plan: `{ "finishedGoodId": "...", "quantityToProduce": 50 }`
- `POST /production-orders/:id/complete` — production shesh, stock auto update
- `POST /suppliers` — notun supplier add
- `POST /purchase-orders` — order place: `{ "supplierId": "...", "items": [{ "rawMaterialId": "...", "quantity": 100, "costPerUnit": 0.5 }] }`
- `POST /purchase-orders/:id/receive` — maal ashar por call korle stock barbe
- `POST /customers` — notun customer add
- `POST /sales-orders` — order create: `{ "customerId": "...", "paymentType": "cash", "items": [{ "finishedGoodId": "...", "quantity": 10, "unitPrice": 1.25 }] }`
- `POST /sales-orders/:id/complete` — sale confirm, stock kome jabe
- `POST /quotations` — quotation banao (customerId + items, unitPrice manually set kora jai)
- `POST /quotations/:id/convert-to-invoice` — ek click-e invoice toiri
- `POST /invoices` — direct invoice o banano jai (customerId, items, dueDate, deliveryDate, paymentType)
- `PATCH /invoices/:id` — invoice edit (versioning rule odhikari automatic)
- `GET /invoices/:id/pdf` — PDF download
- `GET /invoices/:id/whatsapp-link` — customer-ke WhatsApp-e pathanor jonno link
- `POST /auth/register` — first Admin account banao: `{ "name": "...", "email": "...", "password": "...", "role": "admin" }`
- `POST /auth/login` — token pabe, `Authorization: Bearer <token>` header-e diye protected route call korte hobe
- `PATCH /settings` — `{ "defaultInvoiceTemplate": "formal" }` diye shob notun invoice-er default template bodlano jai
- `POST /settings/logo` — multipart form-data, field name `file` diye logo image upload

## .env-e aro kisu field lagbe (invoice module-er jonno)
```
COMPANY_NAME=ARIBS Palm Peat
COMPANY_VATIN=OM1000000000
INVOICE_UPLOAD_DIR=./uploads/invoices
LOGO_PATH=./assets/logo.jpg
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=erp@aribs.net
VAT_EXCLUDE_NOTIFY_EMAILS=ceo@aribs.net,md@aribs.net,accountant@aribs.net
JWT_SECRET=ekta-lomba-random-string-emon-dao
LOGO_UPLOAD_DIR=./uploads/branding
```
SMTP set na korle o system bondho hobe na — sudhu email pathabe na, log-e warning dekhabe.
`JWT_SECRET` production-e obossoi ekta random shokto string dite hobe, default value use kora thik na.

## Hostinger-e deploy korar somoy
- hPanel > Advanced > Node.js diye deploy hobe
- `.env` file-e Hostinger MySQL details bosate hobe
- `synchronize: true` (app.module.ts) real data asar por `false` kore
  migration use korte hobe — noyle bhul kore data loss hote pare
