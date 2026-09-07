const PDFDocument = require("pdfkit");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { exec } = require("child_process");
const { promisify } = require("util");
const { PrismaClient } = require("@prisma/client");
const { calculateRiskScore, normalizeDocumentType, documentTypeMeta } = require("./rules");

require("dotenv").config();

const execPromise = promisify(exec);

// Multer setup: accepts images + PDFs up to 10MB, stored in backend/uploads/
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || ".bin").toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (allowedExtensions.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type '${ext}'. Allowed: ${allowedExtensions.join(", ")}`));
  }
});

const forensicsPython = () => process.env.FORENSICS_PYTHON || "python";

// Initialize Express app & Prisma Client
const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));

// Audit logging helper — records compliance events for the audit trail.
async function logAudit({ action, actor, resource, result, detail }) {
  try {
    await prisma.auditEvent.create({
      data: {
        action,
        actor: actor || "system@identra",
        resource: resource || action,
        result: result || "SUCCESS",
        detail: detail ? { ...detail } : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to write audit event:", error);
  }
}

// Main Verification Endpoint
app.post("/api/scan", async (req, res) => {
  try {
    const { 
      documentType, 
      documentNumber, 
      expiryDate, 
      dob, 
      gender, 
      nationality, 
      faceScore, 
      extractedData 
    } = req.body;


    // 1. Safe Blacklist Check (Supabase Database Lookup)
    const blacklisted = documentNumber 
      ? await prisma.blacklist.findFirst({
          where: { documentNumber: String(documentNumber) }
        })
      : null;
      
    const isBlacklisted = !!blacklisted;

    // 1.5 Forensic Checks (AI-generation + tampering via Python engine) when an image path is supplied
    const forensicFlags = [];
    let forensicScore = 0;
    if (req.body.imagePath) {
      const [aiResult, tamperResult] = await Promise.all([
        runAiDetection(req.body.imagePath),
        runTamperDetection(req.body.imagePath)
      ]);

      if (aiResult.isAiGenerated) {
        forensicScore += aiResult.aiScore || 0;
        forensicFlags.push(...(aiResult.flags || []));
      }
      if (tamperResult.isTampered) {
        forensicScore += tamperResult.tamperScore || 0;
        forensicFlags.push(...(tamperResult.flags || []));
      }
    }

    // 2. Risk Engine Calculation (rules.js)
    const docType = normalizeDocumentType(documentType);
    const { riskScore, verdict, flags, missingFields } = calculateRiskScore({
      documentNumber,
      expiryDate,
      dob,
      gender,
      nationality,
      faceScore: parseFloat(faceScore || 1.0),
      isBlacklisted,
      tamperScore: forensicScore,
      documentType: docType
    });
    const allFlags = [...flags, ...forensicFlags];

    // 3. Save Audit Log to Supabase Scan Table
    const scanRecord = await prisma.scan.create({
      data: {
        documentType: docType,
        extractedData: extractedData || { documentNumber, expiryDate, dob, gender, nationality },
        validationResults: { 
          isBlacklisted, 
          docFormatValid: !flags.includes("INVALID_DOCUMENT_FORMAT"),
          isExpired: flags.includes("EXPIRED_DOCUMENT")
        },
        tamperingFlags: allFlags,
        faceScore: parseFloat(faceScore || 1.0),
        riskScore: parseFloat(riskScore),
        verdict: verdict
      }
    });

    // 4. Return Final Response
    await logAudit({
      action: "VERIFICATION_RUN",
      resource: "VERIFICATION",
      result: verdict,
      detail: { scanId: scanRecord.id, riskScore: parseFloat(riskScore), isBlacklisted },
    });

    res.status(201).json({
      success: true,
      data: scanRecord
    });

  } catch (error) {
    console.error("Error processing scan:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/scan/file - single-call multipart scan for the frontend.
// Accepts a document image (required) + optional selfie + optional field overrides,
// runs the full Python forensic pipeline (OCR + AI + tamper + face), then scores it.
app.post("/api/scan/file",
  upload.fields([{ name: "document", maxCount: 1 }, { name: "selfie", maxCount: 1 }]),
  async (req, res) => {
    try {
      if (!req.files?.document?.[0]) {
        return res.status(400).json({ success: false, error: "document file is required (multipart field 'document')" });
      }

      const docPath = req.files.document[0].path;
      const selfiePath = req.files.selfie?.[0]?.path || null;
      const body = req.body || {};

      // 1. Single Python forensics pass: OCR + AI + tamper + face
      const docType = normalizeDocumentType(body.documentType);
      const selfieArg = selfiePath ? ` --selfie "${selfiePath}"` : "";
      const { stdout } = await execPromise(
        `${forensicsPython()} forensics_pipeline.py --document "${docPath}" --document-type "${docType}"${selfieArg}`
      );
      const forensics = JSON.parse(stdout);

      // 2. Merge OCR-extracted fields with explicit client overrides
      const ocrFields = forensics.ocr?.fields || {};
      const documentNumber = body.documentNumber || ocrFields.DocumentNumber?.value;
      const expiryDate = body.expiryDate || ocrFields.DateOfExpiration?.value;
      const dob = body.dob || ocrFields.DateOfBirth?.value;
      const gender = body.gender || ocrFields.Gender?.value;
      const nationality = body.nationality || ocrFields.CountryRegion?.value;
      const extractedData = { documentNumber, expiryDate, dob, gender, nationality };

      // 3. Blacklist lookup (Supabase)
      const blacklisted = documentNumber
        ? await prisma.blacklist.findFirst({ where: { documentNumber: String(documentNumber) } })
        : null;
      const isBlacklisted = !!blacklisted;

      // 4. Risk engine (face + tamper scores from the Python pipeline)
      const faceScoreFraction = typeof forensics.face?.face_score === "number"
        ? forensics.face.face_score / 100
        : 1.0;

      const { riskScore, verdict, flags, missingFields } = calculateRiskScore({
        documentNumber,
        expiryDate,
        dob,
        gender,
        nationality,
        faceScore: faceScoreFraction,
        isBlacklisted,
        tamperScore: (forensics.tamper?.tamperScore || 0) + (forensics.ai?.aiScore || 0),
        documentType: docType
      });

      const forensicFlagList = [
        ...(forensics.tamper?.flags || []),
        ...(forensics.ai?.flags || [])
      ];
      const allFlags = [...new Set([...flags, ...forensicFlagList])];

      const evidenceImageUrl = forensics.annotatedImagePath
        ? `/uploads/${path.basename(forensics.annotatedImagePath)}`
        : null;

      // 5. Persist audit record
      const scanRecord = await prisma.scan.create({
        data: {
          documentType: docType,
          extractedData,
          validationResults: {
            isBlacklisted,
            docFormatValid: !flags.includes("INVALID_DOCUMENT_FORMAT"),
            isExpired: flags.includes("EXPIRED_DOCUMENT")
          },
          tamperingFlags: allFlags,
          faceScore: faceScoreFraction,
          riskScore: parseFloat(riskScore),
          verdict: verdict,
          evidenceImageUrl
        }
      });

      // 6. Return verdict + full forensic breakdown
      await logAudit({
        action: "VERIFICATION_RUN",
        resource: "VERIFICATION",
        result: verdict,
        detail: { scanId: scanRecord.id, riskScore: parseFloat(riskScore), isBlacklisted },
      });

      res.status(201).json({
        success: true,
        message: "Document screening completed successfully",
        data: {
          id: scanRecord.id,
          verdict,
          riskScore: parseFloat(riskScore),
          faceScore: faceScoreFraction,
          extractedData,
          tamperingFlags: allFlags,
          missingFields,
          evidenceImageUrl,
          forensics: {
            ocr: forensics.ocr,
            ai: forensics.ai,
            tamper: forensics.tamper,
            face: forensics.face
          }
        }
      });
    } catch (error) {
      console.error("Error processing file scan:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Multer/validation error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(400).json({ success: false, error: err.message });
});
// =============================================
// PDF AUDIT CERTIFICATE
// =============================================

// Human-readable descriptions for every risk / forensic flag the engines can emit.
const FLAG_LABELS = {
  INVALID_DOCUMENT_FORMAT: "Document number does not match the expected format for its document type (e.g. passport 2 letters + 7 digits, Aadhaar 12 digits, PAN 5 letters + 4 digits + 1 letter, EPIC 3 letters + 7 digits).",
  AADHAAR_CHECKSUM_FAILED: "Aadhaar number has 12 digits but fails the official Verhoeff checksum — strong sign of a fabricated number.",
  EXPIRED_DOCUMENT: "Document has passed its expiration date.",
  UNDERAGE_OR_INVALID_DOB: "Date of birth could not be validated or the holder appears to be under 18.",
  INVALID_GENDER_CODE: "Gender code is not one of the permitted values (M, F, X).",
  UNSUPPORTED_NATIONALITY: "Nationality is not India (IND).",
  BLACKLISTED_DOCUMENT: "Document number was found on the watchlist / blacklist.",
  LOW_FACE_MATCH_SCORE: "Document portrait and live selfie could not be matched with confidence.",
  UNREADABLE_DOCUMENT_FIELDS: "One or more key fields could not be read clearly from the document.",
  HIGH_EDGE_DISCONTINUITY_POSSIBLE_PHOTO_CUT: "Possible photo cut / edge discontinuity detected in the document image.",
  BLURRY_TEXT_OR_UNNATURAL_SMOOTHING: "Blur or unnatural smoothing detected — possible sign of tampering.",
  SYNTHETIC_FREQUENCY_SPECTRUM_ANOMALY: "Frequency-spectrum anomaly suggests the image may be AI-generated.",
  UNNATURAL_SMOOTHNESS_NO_SENSOR_NOISE: "Image lacks natural sensor noise — consistent with AI-generated content.",
  FILE_NOT_FOUND: "Document image file could not be located for forensic analysis.",
  INVALID_IMAGE_FILE: "Document image file could not be decoded.",
  IMAGE_READ_ERROR: "Forensic engines could not read the document image.",
  IMAGE_DECODE_FAILED: "OCR could not decode the document image.",
  NO_IMAGE_PROVIDED: "No image was provided to the forensic engine.",
  FACE_MODEL_MISSING: "Face-detection model is unavailable on the server.",
  AI_DETECTION_FAILED: "AI-generation check could not be completed.",
  TAMPER_DETECTION_FAILED: "Tamper analysis could not be completed.",
};

const VERDICT_LABELS = {
  APPROVE: "Approved — Low Risk",
  REVIEW: "Manual Review Required",
  REJECT: "Rejected — High Risk",
};

const VERDICT_COLORS = {
  APPROVE: { band: "#16a34a", border: "#15803d" },
  REVIEW: { band: "#d97706", border: "#b45309" },
  REJECT: { band: "#dc2626", border: "#b91c1c" },
};

// Draw a single label → value row and return the y-position of the next row.
function drawDetailRow(doc, label, value, y, fallback = "Not readable") {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155");
  doc.text(label, 48, y, { width: 150 });
  doc.font("Helvetica").fillColor("#0f172a");
  doc.text(value || fallback, 210, y, { width: 300 });
  doc.strokeColor("#e2e8f0").moveTo(48, y + 21).lineTo(48 + 468, y + 21).stroke();
  return y + 26;
}

// Colour palette used for status values in the audit certificate.
const TONE_COLORS = Object.freeze({
  good: "#15803d",
  bad: "#dc2626",
  warn: "#d97706",
  neutral: "#64748b",
  default: "#0f172a",
});

// Numbered section heading with a small accent chip for the certificate.
function drawSectionHead(doc, num, title, accent, y) {
  doc.circle(57, y + 8, 9).fill(accent);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9)
    .text(String(num), 50, y + 2, { width: 14, align: "center" });
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11)
    .text(title, 76, y + 1, { width: 420 });
  return y + 26;
}

// Two-column label/value panel with a soft zebra card background.
function drawDataRow(doc, cells, y) {
  doc.rect(48, y, 500, 30).fill("#f8fafc");
  cells.slice(0, 2).forEach((c, i) => {
    const x = 62 + i * 243;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#94a3b8")
      .text(String(c.label).toUpperCase(), x, y + 4, { width: 220 });
    doc.font("Helvetica").fontSize(9.5)
      .fillColor(TONE_COLORS[c.tone || "default"])
      .text(c.value || "—", x, y + 15, { width: 220 });
  });
  doc.strokeColor("#e2e8f0").lineWidth(0.8)
    .moveTo(48, y + 30).lineTo(548, y + 30).stroke();
  return y + 31;
}

// Human-readable list of suspicious findings.
function describeFlags(flags) {
  if (!flags || flags.length === 0) return [];
  return flags.map((f) => FLAG_LABELS[f] || f);
}

// GET /api/scans/:id/pdf — downloadable audit certificate
app.get("/api/scans/:id/pdf", async (req, res) => {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: req.params.id }
    });

    if (!scan) {
      return res.status(404).json({ success: false, error: "Scan record not found" });
    }

    await logAudit({
      action: "REPORT_GENERATE",
      resource: "REPORT",
      result: "SUCCESS",
      detail: { scanId: scan.id, verdict: scan.verdict },
    });

const meta = documentTypeMeta(scan.documentType);

    // FORCE DIRECT DOWNLOAD TO PC (attachment instead of inline)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${meta.slug}_audit_${scan.id}.pdf"`
    );

    const doc = new PDFDocument({ margin: 48, size: "A4" });
    doc.pipe(res);

    const colors = VERDICT_COLORS[scan.verdict] || VERDICT_COLORS.REVIEW;
    const verdictLabel = VERDICT_LABELS[scan.verdict] || scan.verdict;
    const extracted = scan.extractedData || {};
    const validation = scan.validationResults || {};
    const flags = Array.isArray(scan.tamperingFlags) ? scan.tamperingFlags : [];
    const findings = describeFlags(flags);
    const faceScore = typeof scan.faceScore === "number" ? scan.faceScore : 1.0;
    const hasLowFaceFlag = flags.includes("LOW_FACE_MATCH_SCORE");
    const facePerformed = !(faceScore >= 0.999) || hasLowFaceFlag;
    const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });

    const safeRisk = Math.max(0, Math.min(100, Number(scan.riskScore) || 0));
    const fmtTone = validation.docFormatValid === false ? "bad" : validation.docFormatValid === true ? "good" : "neutral";
    const expTone = validation.isExpired ? "bad" : extracted.expiryDate ? "good" : "neutral";
    const blackTone = validation.isBlacklisted ? "bad" : "good";
    const faceTone = hasLowFaceFlag ? "bad" : facePerformed ? "good" : "neutral";
    const hasExpiry = meta.requiresExpiry;
    const hasNationality = meta.requiresNationality;
    const rawDocNumber = String(extracted.documentNumber || "");
    const docNumberValue = hasExpiry && !rawDocNumber ? "Not readable" : rawDocNumber || "Not readable";

    // ── Header band ───────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 88).fill("#0f172a");
    doc.rect(0, 88, doc.page.width, 5).fill(colors.band);
    doc.roundedRect(48, 18, 52, 54, 10).fill(colors.band);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18)
      .text("SN", 48, 30, { width: 52, align: "center" });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16)
      .text(meta.title, 114, 24, { width: 330 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(colors.band)
      .text("AUDIT CERTIFICATE", 114, 44, { width: 330 });
    doc.font("Helvetica").fontSize(8).fillColor("#cbd5e1")
      .text("Government of India — Automated Identity & Document Screening Engine", 114, 64, { width: 330 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#94a3b8")
      .text("CERTIFICATE ID", 396, 24, { width: 150, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
      .text(scan.id.slice(0, 13).toUpperCase(), 396, 36, { width: 150, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor("#cbd5e1")
      .text(`Generated: ${generatedAt}`, 396, 52, { width: 150, align: "right" });

    // ── Verdict banner with risk gauge ────────────────────────────
    let y = 112;
    doc.roundedRect(48, y, 500, 62, 8).fill(colors.band);
    doc.opacity(0.25).rect(68, y + 48, 300, 4).fill("#ffffff");
    doc.opacity(0.95)
      .rect(68, y + 48, Math.max(8, Math.round(300 * (safeRisk / 100))), 4).fill("#ffffff");
    doc.opacity(1);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(19)
      .text(verdictLabel, 68, y + 10, { width: 330 });
    doc.font("Helvetica").fontSize(8).fillColor("#f8fafc")
      .text("Automated verdict with explainable risk indicators", 68, y + 33, { width: 330 });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(27)
      .text(`${safeRisk}`, 0, y + 4, { align: "right", width: doc.page.width - 84 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#f1f5f9")
      .text("RISK SCORE / 100", 0, y + 38, { align: "right", width: doc.page.width - 84 });
    y += 84;

    // ── 1. Verification Summary ───────────────────────────────────
    y = drawSectionHead(doc, 1, "Verification Summary", colors.band, y);
    y = drawDataRow(doc, [
      { label: "Scan ID", value: scan.id.slice(0, 13).toUpperCase(), tone: "neutral" },
      { label: "Document Type", value: meta.label },
    ], y);
    y = drawDataRow(doc, [
      {
        label: meta.numberLabel,
        value: docNumberValue,
        tone: validation.docFormatValid === false ? "bad" : "default",
      },
      {
        label: "Format Check",
        value: validation.docFormatValid === true ? "Valid format" :
          validation.docFormatValid === false ? "Format validation failed" : "Not readable",
        tone: fmtTone,
      },
    ], y);
    y = drawDataRow(doc, [
      { label: "Expiry Date", value: hasExpiry ? (extractDate(extracted.expiryDate) || "—") : "N/A — permanent validity", tone: hasExpiry ? (expTone === "bad" ? "bad" : "default") : "neutral" },
      {
        label: "Expiry Status",
        value: hasExpiry ? (validation.isExpired ? "Expired" : extracted.expiryDate ? "Active" : "Not readable") : "Not applicable",
        tone: hasExpiry ? expTone : "neutral",
      },
    ], y);
    y = drawDataRow(doc, [
      { label: "Blacklist", value: validation.isBlacklisted ? "FLAGGED — ON WATCHLIST" : "Clear", tone: blackTone },
      {
        label: "Face Match",
        value: facePerformed ? `${Math.round(faceScore * 100)}% match` : "Not performed (no selfie)",
        tone: faceTone,
      },
    ], y);
    y = drawDataRow(doc, [
      { label: "Face Match Status", value: hasLowFaceFlag ? "Low confidence match" : facePerformed ? "Within threshold" : "Skipped", tone: faceTone },
      { label: "Engine", value: "SNARE Screening v1.0", tone: "neutral" },
    ], y);
    y += 10;

    // ── 2. Extracted Document Details ─────────────────────────────
    y = drawSectionHead(doc, 2, "Extracted Document Details", colors.band, y);
    y = drawDataRow(doc, [
      { label: meta.numberLabel, value: docNumberValue },
      { label: "Date of Birth", value: extractDate(extracted.dob) || "—" },
    ], y);
    const detailPairs = [];
    if (hasExpiry) {
      detailPairs.push([
        { label: "Expiry Date", value: extractDate(extracted.expiryDate) || "—" },
        { label: "Gender", value: extracted.gender ? String(extracted.gender).toUpperCase() : "—" },
      ]);
    } else {
      detailPairs.push([
        { label: "Expiry Date", value: "N/A — permanent validity", tone: "neutral" },
        { label: "Gender", value: hasNationality === false && meta.code === "PAN" ? "N/A" : (extracted.gender ? String(extracted.gender).toUpperCase() : "—") },
      ]);
    }
    const reviewCell = { label: "Review Status", value: scan.needsReview ? "Flagged for review" : "Auto-cleared", tone: scan.needsReview ? "warn" : "good" };
    if (hasNationality) {
      detailPairs.push([
        { label: "Nationality", value: String(extracted.nationality || "") || "—" },
        reviewCell,
      ]);
    } else {
      detailPairs.push([
        { label: "Nationality", value: "N/A", tone: "neutral" },
        reviewCell,
      ]);
    }
    for (const pair of detailPairs) y = drawDataRow(doc, pair, y);
    y += 10;

    // ── 3. Findings & Reason Flags ────────────────────────────────
    y = drawSectionHead(doc, 3, "Findings & Reason Flags", colors.band, y);
    const findingsHeight = Math.max(34, findings.length * 18 + 16);
    doc.rect(48, y, 500, findingsHeight).fill("#f8fafc");
    if (findings.length === 0) {
      doc.circle(62, y + 16, 4).fill("#16a34a");
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#166534")
        .text("No suspicious indicators were detected. The document passed all automated checks.", 76, y + 8, { width: 460 });
    } else {
      findings.forEach((line, i) => {
        doc.circle(62, y + 10 + i * 18, 4).fill("#dc2626");
        doc.font("Helvetica").fontSize(9).fillColor("#334155")
          .text(line, 76, y + 3 + i * 18, { width: 460 });
      });
    }
    y += findingsHeight + 6;

    // ── Footer seal ───────────────────────────────────────────────
    if (y > doc.page.height - 170) {
      doc.addPage();
      y = 70;
    }
    doc.strokeColor(colors.border).lineWidth(1.2).moveTo(48, y).lineTo(548, y).stroke();
    y += 16;
    doc.roundedRect(48, y, 270, 18, 4).fill("#0f172a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8)
      .text(`AUDIT CONFIRMATION  ${scan.id.slice(0, 8).toUpperCase()}`, 60, y + 5, { width: 270 });
    doc.circle(517, y + 9, 11).lineWidth(1.2).strokeColor(colors.band).stroke();
    doc.fillColor(colors.band).font("Helvetica-Bold").fontSize(6.5)
      .text("SNARE", 499, y + 5, { width: 36, align: "center" });
    y += 32;
    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text(
        "This is a computer-generated audit certificate produced by the SNARE screening engine. " +
        "It summarises the automated findings of OCR extraction, document validation, watchlist screening, " +
        "forensic analysis and facial biometric consistency checks. A final decision is made by an authorised reviewer.",
        48, y, { width: 500 }
      );
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text("© 2026 Government of India — SNARE Identity Verification Platform", 0, doc.page.height - 56, { align: "center", width: doc.page.width });

    doc.end();
  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Normalizes an ISO date string (YYYY-MM-DD) to a readable format (e.g. 07 Aug 2028).
function extractDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// GET /health - System Uptime & Dependency Status
app.get("/health", async (req, res) => {
  const healthStatus = {
    status: "UP",
    timestamp: new Date().toISOString(),
    services: {
      database: "UNKNOWN",
      pythonEngine: "UNKNOWN"
    }
  };

  // 1. Check PostgreSQL Database Connection via Prisma
  try {
    await prisma.$queryRaw`SELECT 1`;
    healthStatus.services.database = "CONNECTED";
  } catch (err) {
    healthStatus.services.database = "DISCONNECTED";
    healthStatus.status = "DEGRADED";
  }

  // 2. Check Python Environment
  try {
    await execPromise("python --version");
    healthStatus.services.pythonEngine = "AVAILABLE";
  } catch (err) {
    healthStatus.services.pythonEngine = "UNAVAILABLE";
    healthStatus.status = "DEGRADED";
  }

  const httpCode = healthStatus.status === "UP" ? 200 : 503;
  res.status(httpCode).json(healthStatus);
});

// Start listening on Port 5000 (or the port provided via PORT)
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Passport Verification API running on http://localhost:${PORT}`);
  });
}

module.exports = app;

// GET /api/scans/:id — fetch a single scan record
app.get("/api/scans/:id", async (req, res) => {
  try {
    const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
    if (!scan) {
      return res.status(404).json({ success: false, error: "Scan record not found" });
    }
    res.json({ success: true, data: scan });
  } catch (error) {
    console.error("Error fetching scan:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/scans/:id/review — flag or unflag a scan for manual review
app.post("/api/scans/:id/review", async (req, res) => {
  try {
    const flag = req.body?.flag === true;
    const existing = await prisma.scan.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Scan record not found" });
    }

    const updated = await prisma.scan.update({
      where: { id: req.params.id },
      data: {
        needsReview: flag,
        reviewedAt: new Date(),
        reviewedBy: req.body?.actor || null,
      }
    });

    await logAudit({
      action: flag ? "REVIEW_FLAG" : "REVIEW_CLEAR",
      resource: "VERIFICATION",
      result: flag ? "FLAGGED" : "CLEARED",
      detail: { scanId: updated.id, verdict: updated.verdict, riskScore: updated.riskScore },
    });

    res.json({ success: true, message: flag ? "Verification flagged for manual review" : "Review flag cleared", data: updated });
  } catch (error) {
    console.error("Error updating review flag:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET ENDPOINT: Fetch all scan records (Scan History) with status filter + pagination
app.get("/api/scans", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;
    const where = req.query.status ? { verdict: String(req.query.status).toUpperCase() } : {};

    const [total, scans] = await Promise.all([
      prisma.scan.count({ where }),
      prisma.scan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip
      })
    ]);

    res.json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit))
      },
      data: scans
    });
  } catch (error) {
    console.error("Error fetching scans:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET ENDPOINT: System Analytics & Verdict Totals
app.get("/api/stats", async (req, res) => {
  try {
    const totalScans = await prisma.scan.count();
    const approved = await prisma.scan.count({ where: { verdict: "APPROVE" } });
    const review = await prisma.scan.count({ where: { verdict: "REVIEW" } });
    const rejected = await prisma.scan.count({ where: { verdict: "REJECT" } });
    const blacklisted = await prisma.blacklist.count();

    res.json({
      success: true,
      data: {
        totalScans,
        approved,
        review,
        rejected,
        blacklisted
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// BLACKLIST API (full CRUD against PostgreSQL)
// =============================================

// GET /api/blacklist — list entries with optional search
app.get("/api/blacklist", async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search) : "";
    const where = search
      ? {
          OR: [
            { documentNumber: { contains: search, mode: "insensitive" } },
            { reason: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const entries = await prisma.blacklist.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error("Error fetching blacklist:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/blacklist/check — check a document number against the watchlist
app.post("/api/blacklist/check", async (req, res) => {
  try {
    const { documentNumber } = req.body || {};
    if (!documentNumber) {
      return res
        .status(400)
        .json({ success: false, error: "documentNumber is required" });
    }

    const entry = await prisma.blacklist.findUnique({
      where: { documentNumber: String(documentNumber) },
    });

    res.json({
      success: true,
      data: {
        isBlacklisted: !!entry,
        documentNumber: String(documentNumber),
        reason: entry?.reason || null,
        matchId: entry?.id || null,
      },
    });
  } catch (error) {
    console.error("Error checking blacklist:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/blacklist — add a new entry
app.post("/api/blacklist", async (req, res) => {
  try {
    const { documentNumber, reason, addedBy, documentType } = req.body || {};
    if (!documentNumber) {
      return res
        .status(400)
        .json({ success: false, error: "documentNumber is required" });
    }

    const exists = await prisma.blacklist.findUnique({
      where: { documentNumber: String(documentNumber) },
    });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, error: "Document number is already blacklisted" });
    }

    const entry = await prisma.blacklist.create({
      data: {
        documentNumber: String(documentNumber),
        documentType: documentType || null,
        reason: reason || "Manual entry",
        addedBy: addedBy || null,
      },
    });

    await logAudit({
      action: "BLACKLIST_ADD",
      resource: "BLACKLIST",
      result: "SUCCESS",
      detail: { documentNumber: entry.documentNumber, documentType: documentType || null },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    console.error("Error adding blacklist entry:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/blacklist/:id — remove an entry
app.delete("/api/blacklist/:id", async (req, res) => {
  try {
    const entry = await prisma.blacklist.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      return res.status(404).json({ success: false, error: "Blacklist entry not found" });
    }

    await prisma.blacklist.delete({ where: { id: req.params.id } });

    await logAudit({
      action: "BLACKLIST_REMOVE",
      resource: "BLACKLIST",
      result: "SUCCESS",
      detail: { documentNumber: entry.documentNumber },
    });

    res.json({ success: true, message: "Blacklist entry removed" });
  } catch (error) {
    console.error("Error deleting blacklist entry:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// AUDIT TRAIL API
// =============================================

// GET /api/audit — fetch audit events with filtering + pagination
app.get("/api/audit", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.resource && String(req.query.resource) !== "ALL") {
      where.resource = String(req.query.resource);
    }
    if (req.query.result && String(req.query.result) !== "ALL") {
      where.result = String(req.query.result);
    }
    if (req.query.actor) {
      where.actor = { contains: String(req.query.actor), mode: "insensitive" };
    }

    const [total, events] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
    ]);

    res.json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: events,
    });
  } catch (error) {
    console.error("Error fetching audit trail:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/audit/:id — remove a rogue audit entry (supervisor action)
app.delete("/api/audit/:id", async (req, res) => {
  try {
    const event = await prisma.auditEvent.findUnique({ where: { id: req.params.id } });
    if (!event) {
      return res.status(404).json({ success: false, error: "Audit event not found" });
    }

    await prisma.auditEvent.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Audit event removed" });
  } catch (error) {
    console.error("Error deleting audit event:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// SNARE AI ASSISTANT (grounded in real data)
// =============================================

// POST /api/assistant — answer questions about the live verification data.
// Simple intent matching over stats, scans, blacklist and the risk model.
app.post("/api/assistant", async (req, res) => {
  try {
    const text = String(req.body?.message || "").trim();
    if (!text) {
      return res.status(400).json({ success: false, error: "message is required" });
    }
    const q = text.toLowerCase();

    // 1. Stats intents
    if (/(total|how many|volume|all|count).*(verif|screen|scan)/.test(q) || /verif.*total/.test(q)) {
      const [total, approved, review, rejected] = await Promise.all([
        prisma.scan.count(),
        prisma.scan.count({ where: { verdict: "APPROVE" } }),
        prisma.scan.count({ where: { verdict: "REVIEW" } }),
        prisma.scan.count({ where: { verdict: "REJECT" } }),
      ]);
      return res.json({
        success: true,
        data: {
          answer: `There are ${total} recorded verifications. ${approved} approved (${total ? Math.round((approved / total) * 100) : 0}%), ${review} under review and ${rejected} rejected.`,
        },
      });
    }

    if (/(blacklist|watchlist|blocked|flagged)/.test(q)) {
      const [count, sample] = await Promise.all([
        prisma.blacklist.count(),
        prisma.blacklist.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
      ]);
      const sampleText = sample.length
        ? ` Recent entries: ${sample.map((s) => s.documentNumber).join(", ")}.`
        : " No entries recorded yet.";
      return res.json({
        success: true,
        data: { answer: `There are ${count} document numbers on the blacklist.${sampleText}` },
      });
    }

    if (/(reject|verdict|trigger|score|risk|how.*decide|model)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "Every scan is scored from 0–100. Scores of 0–30 approve, 31–60 go to manual review, and 61–100 are rejected. The score combines validation errors (40%), tampering/blacklist signals (40%) and face-match confidence (20%). Flags such as INVALID_DOCUMENT_FORMAT, EXPIRED_DOCUMENT, BLACKLISTED_DOCUMENT or tampering indicators raise the risk.",
        },
      });
    }

    if (/(document.?type|what.?documents|supported|aadhaar|pan|voter.?id|epic|types? of id)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "The engine currently validates four Indian identity documents. Passport — number format 2 letters + 7 digits, expiry and nationality both checked. Aadhaar — 12-digit UIDAI number, verified against the official Verhoeff checksum so a fabricated number is caught. PAN — 5 letters + 4 digits + 1 letter. Voter ID / EPIC — 3 letters + 7 digits. Aadhaar, PAN and Voter ID carry no expiry date, so they are never penalised for a missing expiry. All document types still run OCR, AI-generation and tamper forensics, plus an optional live selfie face match.",
        },
      });
    }

    if (/(tamper|forger|manipul|photo.?cut|edited|reprint)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "Tampering is detected by the Python forensics engine. It looks for frequency-spectrum anomalies (signs of AI-rendered or reprinted pages), edge discontinuity around the photo (a cut-and-paste swap), panel inconsistencies between zones, and mismatched image metadata. Anything suspicious is highlighted on the annotated evidence image and contributes to the tamper score — any score above zero floors the scan to 31 and never lets it auto-approve.",
        },
      });
    }

    if (/(underage|minor|legible|readab|hard.?defect)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "Readability and validity are separate checks. Even a perfectly legible passport goes to manual review if it carries a hard defect: expired, blacklisted, malformed document number, low face match, or a date of birth that makes the holder under 18. Each hard defect floors the verdict at 31 regardless of how clean the raw score looks. An unreadable field only raises the review floor (31/37/43/49/55) — it is never treated as proof of forgery.",
        },
      });
    }

    if (/(selfie|face.?match|biometric|live photo)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "When no selfie is supplied, face matching is skipped and the face score counts as neutral (1.0), so scanning still completes. But matching the holder's live photo against the document is the strongest proof of identity this platform can produce, so officers are strongly advised to capture a selfie with every scan.",
        },
      });
    }

    if (/(ocr|mrz|blur|damaged|unreadab|recover|extract)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "OCR runs Tesseract with tesseract-to-text fallbacks. If the machine-readable zone is noisy, the engine runs a tolerant MRZ parse anchored on the document number, and for printed date cells it repairs mangled digits character-by-character (S→5, O→0, I→1, B→8) before normalising the date — for example a blended \"05/08/2018\" is recovered exactly. If recovery still fails, the field counts as unreadable and pushes the scan to REVIEW; the engine never guesses a date to force approval.",
        },
      });
    }

    if (/(audit|certificate|pdf|export|csv)/.test(q)) {
      return res.json({
        success: true,
        data: {
          answer:
            "Every scan, verdict, export and blacklist change is written to the audit trail with the acting officer, timestamp and action. Each verification can be exported as a signed PDF certificate, and the workspace (history, blacklist or audit log) can be exported to CSV or txt for compliance records.",
        },
      });
    }

    // 2. Specific record lookups (scan id, short id, doc number)
    const idToken = (text.match(/\b[a-zA-Z0-9-]{8,36}\b/) || [])[0];
    if (idToken) {
      const [byId, byQuery] = await Promise.all([
        prisma.scan.findFirst({
          where: { OR: [{ id: idToken }, { id: { startsWith: idToken } }] },
        }),
        prisma.scan.findMany({
          where: { extractedData: { path: ["documentNumber"], equals: idToken.toUpperCase() } },
          orderBy: { createdAt: "desc" },
          take: 1,
        }),
      ]);
      const scan = byId || byQuery[0];
      if (scan) {
        const flags = (scan.tamperingFlags || []).length ? scan.tamperingFlags.join(", ") : "none";
        return res.json({
          success: true,
          data: {
            answer: `Record ${scan.id.slice(0, 8)} was verified on ${scan.createdAt.toISOString()}. Verdict: ${scan.verdict}, risk score ${scan.riskScore}/100, face match ${Math.round(scan.faceScore * 100)}%. Tampering flags: ${flags}.`,
          },
        });
      }
    }

    // 3. Fallback with live summary
    const total = await prisma.scan.count();
    const blacklist = await prisma.blacklist.count();
    return res.json({
      success: true,
      data: {
        answer: `I could not map that to a specific record. Current workspace summary: ${total} verifications on file and ${blacklist} blacklist entries. Ask about totals, the risk model, a document number, or the watchlist.`,
      },
    });
  } catch (error) {
    console.error("Error in assistant:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Call Python forensic engine: AI-generation detection
async function runAiDetection(imagePath) {
  if (!imagePath) return { aiScore: 0, isAiGenerated: false, flags: [] };
  try {
    const { stdout } = await execPromise(`${forensicsPython()} ai_detector.py "${imagePath}"`);
    return JSON.parse(stdout);
  } catch (error) {
    console.error("AI Detection Execution Error:", error);
    return { aiScore: 0, isAiGenerated: false, flags: ["AI_DETECTION_FAILED"] };
  }
}

// Call Python forensic engine: tampering/photo-cut detection
async function runTamperDetection(imagePath) {
  if (!imagePath) return { tamperScore: 0, isTampered: false, flags: [], highlightedImagePath: null };
  try {
    const { stdout } = await execPromise(`${forensicsPython()} tamper_detector.py "${imagePath}"`);
    return JSON.parse(stdout);
  } catch (error) {
    console.error("Tamper Detection Execution Error:", error);
    return { tamperScore: 0, isTampered: false, flags: ["TAMPER_DETECTION_FAILED"], highlightedImagePath: null };
  }
}