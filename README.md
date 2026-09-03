# SNARE — AI-Based Fake Identity & Document Screening System

Passport forensic & verification system built for **Smart India Hackathon (SIH 2026)**. It screens uploaded identity documents for authenticity using OCR, AI-image detection, tamper analysis, blacklist lookup, and facial verification against a live selfie — then produces an explainable risk score with an APPROVE / REVIEW / REJECT verdict and a downloadable audit certificate.

## Architecture

A **Node.js gateway** owns the API, business logic, database, and PDF certificates. A **Python forensic engine** handles all computer-vision work (OCR, AI detection, tamper detection, face matching). Node shell-calls Python as subprocesses, so a single upload produces a complete verdict.

```
Frontend (Next.js, port 3000)
      |
      |  POST /api/scan/file   (multipart: document + optional selfie)
      v
Node.js Gateway (port 5000)
   Express + Prisma + Multer + PDFKit
      |  exec: forensics_pipeline.py
      v
Python Forensic Engine (port 8000)
   FastAPI + OpenCV + Tesseract + YuNet
      |  OCR -> AI detect -> tamper detect -> face match
      v
Risk Engine (rules.js) -> verdict + flags -> Supabase (PostgreSQL)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Gateway API | Node.js, Express 4, Multer, PDFKit, Prisma 5 |
| Forensic engine | Python 3, FastAPI, Uvicorn, Pydantic 2 |
| Vision / OCR | OpenCV, Tesseract 5 + pytesseract, NumPy, Pillow |
| Face detection | YuNet DNN (ONNX) + histogram matching |
| Database | PostgreSQL on Supabase (Prisma models: `Scan`, `Blacklist`) |
| Frontend | Next.js 14, React 18, TypeScript 5 (scaffold) |

## Features

- **Document scanning** — upload a passport image (or PDF) and get a verdict in one call
- **OCR field extraction** — Tesseract extracts doc number, dates, and nationality
- **AI-image detection** — FFT spectral analysis + texture regularity
- **Tamper detection** — photo-cut/edge-discontinuity + blur/smoothing analysis
- **Face verification** — document face vs. live selfie (YuNet + histogram)
- **Blacklist lookup** — against the DB watchlist
- **Risk engine & explainable verdicts** — weighted 40/40/20 scoring
- **Scan history** — filterable + paginated, with statistics
- **PDF audit certificate** — downloadable verification report per scan

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
│   └── python_api/           # FastAPI forensic engine (port 8000)
│       ├── main.py           # FastAPI app (OCR / face / upload)
│       ├── routers/          # ocr | face | upload
│       ├── services/         # ocr | face | request validation | storage
│       ├── models/           # YuNet ONNX face-detection model
│       └── testdata/         # Sample faces for tests
└── frontend/                 # Next.js 14 scaffold
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

```bash
cd backend/python_api
python -m venv .venv                          # optional but recommended
.venv/Scripts/activate                        # Windows
pip install -r requirements.txt
```

Install Tesseract if not present:

```bash
# Windows
winget install UB-Mannheim.TesseractOCR
# macOS / Linux  (adjust path in TESSERACT_CMD)
brew install tesseract          # macOS
sudo apt install tesseract-ocr  # Debian/Ubuntu
```

### 4. Run the servers

```bash
# Terminal 1 - Node gateway (port 5000)
cd backend
npm run dev          # or: node server.js

# Terminal 2 - Python engine (port 8000)
cd backend/python_api
uvicorn main:app --reload
```

### 5. Frontend (optional)

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
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
    "extractedData": { "...": "..." },
    "tamperingFlags": ["..."],
    "forensics": { "ocr": {}, "ai": {}, "tamper": {}, "face": {} }
  }
}
```

### Python forensic engine (`http://localhost:8000`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/ocr/extract` | Tesseract OCR on an image (`file`) |
| POST | `/api/face/verify` | Face match (`document` + `selfie`) |
| POST | `/api/upload/file` | Validate + store a file |
| GET | `/api/health` | Service status |

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

Validation rules: Indian passport format (`^[A-Z]{2}[0-9]{7}$`), expiration in the future, age >= 18 at DOB, gender code (M/F/X), nationality IND.

## Testing

```bash
# Node gateway: 13-requirement acceptance suite
cd backend
node test_all_requirements.js

# Python services + OCR diagnostics
cd backend/python_api
.venv/Scripts/python.exe testpipeline.py

# Face matching sanity test (same vs different person)
.venv/Scripts/python.exe test_face.py
```

## Known Limitations

- **Face matching is histogram-based** — color-distribution similarity, not production-grade biometric recognition. Suitable for demos/hackathons.
- **OCR accuracy** depends on image quality; machine-readable-zone (MRZ) parsing is not implemented.
- Python `history`, `blacklist`, and `validation` were intentionally consolidated into the Node gateway — the FastAPI service serves forensics only.

## License

Not specified.
