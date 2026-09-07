<div align="center">

# 🦅 SNARE

### AI-Powered Fake Identity & Document Screening System

Scan a passport. Detect AI-rendered pages, photo tampering, and blacklisted numbers.
Match the holder's face against the document. Get an explainable **APPROVE / REVIEW / REJECT**
verdict with a downloadable audit certificate — all in one API call.

Build for **Smart India Hackathon 2026**.

![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-5C3EE8?logo=opencv&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?logo=postgresql&logoColor=white)
![Tesseract](https://img.shields.io/badge/Tesseract-OCR-05122A?logo=tesseract&logoColor=white)

[🎯 Features](#-features) · [🏗 Architecture](#-architecture) · [🚀 Quick Start](#-quick-start) · [🔌 API](#-api-reference) · [🧠 Risk Model](#-how-the-risk-score-works) · [🩺 Testing](#-testing)

</div>

---

## ✨ What it does

| Capability | How |
|---|---|
| 📄 **Document scanning** | Upload a passport image or PDF → verdict in one call |
| 🔍 **OCR field extraction** | Tesseract pulls doc number, dates, gender, nationality — with **MRZ parsing** preferred over plain text |
| 🤖 **AI-image detection** | FFT spectral analysis + texture regularity spot AI-rendered / reprinted pages |
| ✂️ **Tamper detection** | Photo-cut & edge-discontinuity analysis + blur / smoothing forensics |
| 🙋 **Face verification** | Document face vs. live selfie via YuNet + histogram, with **webcam capture** built in |
| 🚫 **Blacklist lookup** | Instant match against the DB watchlist |
| 🧮 **Risk engine** | Weighted 40/40/20 scoring with tri-state field validation (valid / invalid / unreadable) |
| 🧾 **Audit certificate** | Pretty, toned PDF per scan — verdict banner, risk gauge, numbered evidence sections |
| 💬 **Snare AI + FAQ** | Assistant grounded in live verification & blacklist data, plus a searchable FAQ page |
| 🕵️ **Audit trail** | Every scan, export and blacklist change, logged with officer + timestamp |
| 🎨 **Polish** | Dark mode, Hindi labels, responsive layout, report exports (CSV/txt) |

---

## 🏗 Architecture

A **Node.js gateway** owns the API, business logic, database and PDF certificates.
A **Python forensic engine** does all the computer-vision work. Node shells out to Python as a
subprocess — one upload in, a fully annotated verdict out.

```
        Frontend (Vite + React + TanStack Router · :3000)
                            │
        POST /api/scan/file  │  multipart: document [+ optional selfie]
                            ▼
        Node.js Gateway · Express + Prisma + Multer + PDFKit · :5000
                            │
        exec: forensics_pipeline.py
                            ▼
        Python Forensic Engine · OpenCV + Tesseract + YuNet
        OCR → AI detection → tamper detection → face match
                            │
                            ▼
        Risk Engine (rules.js) → verdict + flags → Supabase (PostgreSQL)
```

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Gateway API | Node.js, Express 4, Multer, PDFKit, Prisma 5 |
| Forensic engine | Python 3, OpenCV, Tesseract 5 + pytesseract, NumPy, Pillow |
| Vision / OCR | OpenCV + Tesseract (single-pass CLI pipeline) |
| Face detection | YuNet DNN (ONNX) + histogram matching |
| Database | PostgreSQL on Supabase (`Scan`, `Blacklist` models) |
| Frontend | Vite, React 18, TypeScript 5, TanStack Router + Query, Tailwind 4 |

## 📁 Project Structure

```
parallax-project/
├── backend/                  # Node.js gateway (primary API · port 5000)
│   ├── server.js             # Express app, all routes, PDF certificates
│   ├── rules.js              # Validation + risk engine + verdict logic
│   ├── forensics_pipeline.py # One-call Python forensic CLI for Node
│   ├── ai_detector.py        # Standalone AI-image detector
│   ├── tamper_detector.py    # Standalone tampering detector
│   ├── prisma/schema.prisma  # Scan + Blacklist models
│   ├── demo/                 # Sample passport assets
│   └── python_api/           # Legacy FastAPI engine + YuNet model + test data
└── frontend/                 # Vite + React + TanStack Router (port 3000)
    └── src/
        ├── routes/           # login · signup · dashboard · new-verification · screening
        │                     # verification-complete · history · blacklist · audit-trail · faq · settings
        ├── components/       # AppShell · GenerateReport · SelfieCapture · AsyncState
        └── api/              # apiClient + typed endpoint modules
```

## 🚀 Quick Start

**Prerequisites** — Node.js 18+, Python 3.10+, Tesseract OCR 5.0+, a PostgreSQL/Supabase project.

### 1 · Environment variables

Create `backend/.env` (`.env.example` ships with only `PORT`):

```env
PORT=5000
DATABASE_URL="postgresql://...your-supabase-pooler..."
DIRECT_URL="postgresql://...your-supabase-direct..."

# OCR
OCR_PROVIDER="tesseract"
TESSERACT_CMD="C:/Program Files/Tesseract-OCR/tesseract.exe"

# Python interpreter used for forensic subprocesses
FORENSICS_PYTHON="python"   # or the absolute path to your venv python
```

> ⚠️ `.env` is gitignored — never commit real credentials.

### 2 · Database (Prisma)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy   # or: npx prisma db push
```

### 3 · Python forensic engine

```bash
cd backend
python -m pip install opencv-python numpy pillow pytesseract
```

Install Tesseract if needed:

```bash
# Windows
winget install UB-Mannheim.TesseractOCR
# macOS / Linux (adjust path in TESSERACT_CMD)
brew install tesseract          # macOS
sudo apt install tesseract-ocr  # Debian / Ubuntu
```

> `forensics_pipeline.py` auto-detects common Tesseract install paths and even reads
> `backend/.env` itself, no `python-dotenv` required.

### 4 · Run the servers

```bash
# Terminal 1 — Node gateway (port 5000)
cd backend
npm run dev          # or: node server.js

# Terminal 2 — Frontend (port 3000)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** ✨

---

## 🔌 API Reference

### Node gateway · `http://localhost:5000`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/scan` | JSON scan (metadata + optional `imagePath`) |
| POST | `/api/scan/file` | **Multipart scan** — `document` (required), `selfie` (optional) + field overrides |
| GET | `/api/scans` | History — `?status=` `&limit=` `&page=` |
| GET | `/api/scans/:id` | Single scan detail |
| POST | `/api/scans/:id/review` | Officer review decision |
| GET | `/api/scans/:id/pdf` | Download PDF audit certificate |
| GET | `/api/stats` | Verdict totals / analytics |
| GET | `/api/blacklist` · POST · DELETE | Watchlist CRUD |
| POST | `/api/blacklist/check` | Blacklist lookup |
| GET | `/api/audit` · DELETE | Audit trail |
| POST | `/api/assistant` | Snare AI — grounded Q&A over live data |
| GET | `/health` | DB + Python engine status |

**Multipart scan:**

```
POST /api/scan/file
Content-Type: multipart/form-data
  documentNumber (override)  : AB1234567
  expiryDate (override)      : 2031-10-20
  dob (override)             : 1994-03-15
  gender (optional)          : M
  nationality (override)     : IND
  document                   : passport.jpg   (required · jpg/jpeg/png/webp/pdf · ≤10MB)
  selfie                     : selfie.jpg     (optional)
```

**Response:**

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

When a `selfie` is uploaded, the `face` block reports a real comparison (`skipped: false`,
`face_score` / `matched`). Without one it defaults to `skipped: true, face_score: 100`.

### Python forensic engine

```bash
cd backend
python forensics_pipeline.py --document /path/to/doc.jpg [--selfie /path/to/selfie.jpg]
```

Returns a single JSON payload with `ocr`, `ai`, `tamper`, and `face` blocks.

---

## 🧠 How the Risk Score Works

Higher score = higher risk.

```
Risk = (validation errors × 40%) + (tamper / blacklist × 40%) + (face mismatch × 20%)
```

| Score | Verdict |
|---|---|
| 0 – 30 | ✅ **APPROVE** |
| 31 – 60 | 🔎 **REVIEW** |
| 61 – 100 | 🚫 **REJECT** |

**Validation is tri-state.** Every field (passport number, expiry, DOB, gender, nationality) is one of:

- ✅ **valid** — present and passes its rule
- 💥 **invalid** — present but fails (e.g. expired date) → a hard 20-point error + flag
- 🕳️ **missing** — unreadable / not supplied → *not* treated as a defect; the scan is nudged to
  **REVIEW** on a score floor (`31/37/43/49/55`) with an `UNREADABLE_DOCUMENT_FIELDS` flag.
  An unreadable document is escalated to a human — never silently approved *or* wrongly rejected.

Rules: Indian passport format `^[A-Z]{2}[0-9]{7}$`, expiry in the future, age ≥ 18, gender M/F/X,
nationality IND.

---

## 🩺 Testing

```bash
# Node gateway: acceptance suite
cd backend
node test_all_requirements.js

# Python pipeline syntax / OCR diagnostics
cd backend
python forensics_pipeline.py --document python_api/testdata/lena.jpg
```

---

## 🩹 Known Limitations

- **Face matching is histogram-based** — color-distribution similarity, not production biometric
  recognition. Ideal for demos & hackathons.
- **OCR accuracy** depends on image quality. MRZ parsing is preferred, but a poor/angled photo can
  leave fields unreadable — surfaced as `UNREADABLE_DOCUMENT_FIELDS`, never as a false defect.
- `history`, `blacklist`, and `validation` live in the Node gateway; forensics run as a subprocess pipeline.

---

<div align="center">

**Made with 🦅 by the SNARE team · Smart India Hackathon 2026**

</div>