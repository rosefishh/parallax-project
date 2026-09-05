# SNARE — AI-Based Fake Identity & Document Screening System

Passport forensic & verification system built for **Smart India Hackathon (SIH 2026)**. It screens uploaded identity documents for authenticity using OCR, AI-image detection, tamper analysis, blacklist lookup, and facial verification against a live selfie — then produces an explainable risk score with an APPROVE / REVIEW / REJECT verdict and a downloadable audit certificate.

## Architecture

A **Node.js gateway** owns the API, business logic, database, and PDF certificates. A **Python forensic engine** handles all computer-vision work (OCR, AI detection, tamper detection, face matching). Node shell-calls Python as subprocesses, so a single upload produces a complete verdict.

```
Frontend (Vite + React + TanStack Router, port 3000)
      |
      |  POST /api/scan/file   (multipart: document + optional selfie)
      v
Node.js Gateway (port 5000)
   Express + Prisma + Multer + PDFKit
      |  exec: forensics_pipeline.py
      v
Python Forensic Engine
   OpenCV + Tesseract + YuNet
      |  OCR -> AI detect -> tamper detect -> face match
      v
Risk Engine (rules.js) -> verdict + flags -> Supabase (PostgreSQL)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Gateway API | Node.js, Express 4, Multer, PDFKit, Prisma 5 |
| Forensic engine | Python 3, OpenCV, Tesseract 5 + pytesseract, NumPy, Pillow |
| Vision / OCR | OpenCV + Tesseract (CLI-driven single-pass pipeline) |
| Face detection | YuNet DNN (ONNX) + histogram matching |
| Database | PostgreSQL on Supabase (Prisma models: `Scan`, `Blacklist`) |
| Frontend | Vite, React 18, TypeScript 5, TanStack Router + Query, Tailwind 4 |

## Features

- **Document scanning** — upload a passport image (or PDF) and get a verdict in one call
- **OCR field extraction** — Tesseract extracts doc number, dates, gender, and nationality, with **MRZ (machine-readable zone) parsing** preferred over plain text when available
- **AI-image detection** — FFT spectral analysis + texture regularity
- **Tamper detection** — photo-cut/edge-discontinuity (combined-signal) + blur/smoothing analysis
- **Face verification** — document face vs. live selfie (YuNet + histogram), with **live webcam capture and selfie upload** on the frontend
- **Blacklist lookup** — against the DB watchlist
- **Risk engine & explainable verdicts** — weighted 40/40/20 scoring with **unreadable-vs-invalid field handling**
- **Scan history** — filterable + paginated, with statistics
- **PDF audit certificate** — downloadable verification report per scan
- **Reports** — "Generate Report" (Verification Summary / Risk Analysis / Blacklist Activity / Verification History) now lives in **Settings**, replacing the removed standalone Reports page
- **Authentication** — login / signup flow powering the dashboard
- **Dark mode** — theme toggle persisted across sessions
- **Audit trail & landing page** — polished home page and audit log view

## Project Structure

```
parallax-project/
├── backend/                  # Node.js gateway (primary API, port 5000)
│   ├── server.js             # Express app & all routes
│   ├── rules.js              # Validation + risk engine + verdict logic
│   ├── forensics_pipeline.py # One-call Python forensic CLI for Node
│   ├── ai_detector.py        # Standalone AI-image detector
│   ├── tamper_detector.py    # Standalone tampering detector
│   ├── prisma/schema.prisma  # Scan + Blacklist models
│   └── python_api/           # Legacy FastAPI engine + YuNet ONNX model + testdata
└── frontend/                 # Vite + React + TanStack Router (port 3000)
    └── src/
        ├── routes/           # login, signup, dashboard, new-verification,
        │                     #   screening, verification-complete, history,
        │                     #   blacklist, audit-trail, settings, home
        ├── components/       # AppShell, GenerateReport, SelfieCapture, AsyncState
        └── lib/              # auth, theme, pendingScan, api
```

## Prerequisites

- Node.js 18+
- Python 3.10+ (project uses 3.14)
- PostgreSQL (or Supabase project)
- Tesseract OCR 5.0+

## Setup

### 1. Environment variables

Create `backend/.env` from the values documented below (`.env.example` has only `PORT`):

```
PORT=5000
DATABASE_URL="postgresql://...your-supabase-pooler..."
DIRECT_URL="postgresql://...your-supabase-direct..."

# OCR
OCR_PROVIDER="tesseract"
TESSERACT_CMD="C:/Program Files/Tesseract-OCR/tesseract.exe"

# Python interpreter used for forensic subprocesses
FORENSICS_PYTHON="python"   # or the absolute path to your venv python
```

> `.env` is gitignored. Never commit real credentials.

### 2. Database (Prisma)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy   # or: npx prisma db push
```

### 3. Python forensic engine

The Node gateway runs the Python pipeline as a subprocess, so it only needs the Python packages used by the pipeline to be installed in the interpreter named by `FORENSICS_PYTHON`:

```bash
cd backend
python -m pip install opencv-python numpy pillow pytesseract
```

Install Tesseract if not present:

```bash
# Windows
winget install UB-Mannheim.TesseractOCR
# macOS / Linux  (adjust path in TESSERACT_CMD)
brew install tesseract          # macOS
sudo apt install tesseract-ocr  # Debian/Ubuntu
```

> `forensics_pipeline.py` auto-detects the common Tesseract install paths and also parses `backend/.env` for `TESSERACT_CMD` even if `python-dotenv` is not installed.

### 4. Run the servers

```bash
# Terminal 1 - Node gateway (port 5000) — spawns Python forensic subprocesses
cd backend
npm run dev          # or: node server.js

# Terminal 2 - Frontend (port 3000)
cd frontend
npm install
npm run dev
```

## API Reference

### Node gateway (`http://localhost:5000`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/scan` | JSON scan (metadata + optional `imagePath`) |
| POST | `/api/scan/file` | **Multipart scan** — `document` file (required), `selfie` (optional), plus field overrides |
| GET | `/api/scans` | History — `?status=` `&limit=` `&page=` |
| GET | `/api/scans/:id/pdf` | Download PDF audit certificate |
| GET | `/api/stats` | Verdict totals / analytics |
| GET | `/health` | DB + Python engine status |

**Multipart scan example:**

```
POST /api/scan/file
Content-Type: multipart/form-data
  document           : passport.jpg        (required; jpg/jpeg/png/webp/pdf, <=10MB)
  selfie             : selfie.jpg          (optional)
  documentNumber     : AB1234567           (optional override)
  expiryDate         : 2031-10-20          (optional override)
  dob                : 1994-03-15          (optional override)
  gender             : M                   (optional)
  nationality        : IND                 (optional override)
```

Response shape:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "verdict": "REVIEW",
    "riskScore": 34,
    "faceScore": 1.0,
    "extractedData": { "documentNumber": "AB1234567", "expiryDate": "2031-12-31", "dob": "1990-01-15", "gender": "M", "nationality": "IND" },
    "tamperingFlags": ["UNREADABLE_DOCUMENT_FIELDS"],
    "missingFields": ["Gender"],
    "evidenceImageUrl": "/uploads/..._annotated.png",
    "forensics": { "ocr": {}, "ai": {}, "tamper": {}, "face": { "face_score": 100, "matched": true, "skipped": true, "details": "Selfie omitted..." } }
  }
}
```

The `face` block reflects face-match results: when a `selfie` was uploaded, `skipped` is `false` and `face_score`/`matched` hold the real comparison; without a selfie it is `skipped: true, face_score: 100` (face-match effectively not performed).

### Python forensic engine

Run directly to see the raw forensic breakdown:

```bash
cd backend
python forensics_pipeline.py --document /path/to/doc.jpg [--selfie /path/to/selfie.jpg]
```

Returns a single JSON payload with `ocr`, `ai`, `tamper`, and `face` blocks. A legacy FastAPI server also exists under `python_api/` (OCR, face-verify, upload + health routes) for standalone use.

## How the Risk Score Works

Weighted composite — higher score = higher risk:

```
Risk = (validation errors x 40%) + (tamper/blacklist x 40%) + (face mismatch x 20%)
```

Verdict thresholds:

| Score | Verdict |
|---|---|
| 0 – 30 | APPROVE |
| 31 – 60 | REVIEW |
| 61 – 100 | REJECT |

**Validation is tri-state.** Each field (passport number, expiry, DOB, gender, nationality) is judged as:

- **valid** — present and passes its rule
- **invalid** — present but fails its rule (e.g. expired date) → a hard 20-point validation error and a flag
- **missing** — not readable/supplied by OCR → *not* treated as a defect; instead the document is nudged toward **REVIEW** (score floor 31) with an `UNREADABLE_DOCUMENT_FIELDS` flag so an unreadable document is flagged for a human rather than silently approved or wrongly rejected

Missing fields are also reported in the response's `missingFields` array.

Validation rules: Indian passport format (`^[A-Z]{2}[0-9]{7}$`), expiration in the future, age >= 18 at DOB, gender code (M/F/X), nationality IND.

## Testing

```bash
# Node gateway: acceptance suite
cd backend
node test_all_requirements.js

# Python pipeline syntax / OCR diagnostics (uses backend/.env Tesseract config)
cd backend
python forensics_pipeline.py --document python_api/testdata/lena.jpg
```

## Known Limitations

- **Face matching is histogram-based** — color-distribution similarity, not production-grade biometric recognition. Suitable for demos/hackathons.
- **OCR accuracy** depends on image quality; MRZ parsing is implemented and preferred, but a poor/angled photo can still yield unreadable fields (surfaced as `UNREADABLE_DOCUMENT_FIELDS` rather than a false defect).
- Python `history`, `blacklist`, and `validation` were consolidated into the Node gateway — forensics run as a subprocess pipeline.

## License

Not specified.
