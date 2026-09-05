const PDFDocument = require("pdfkit");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { exec } = require("child_process");
const { promisify } = require("util");
const { PrismaClient } = require("@prisma/client");
const { calculateRiskScore } = require("./rules");

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
    const { riskScore, verdict, flags } = calculateRiskScore({
      documentNumber,
      expiryDate,
      dob,
      gender,
      nationality,
      faceScore: parseFloat(faceScore || 1.0),
      isBlacklisted,
      tamperScore: forensicScore
    });
    const allFlags = [...flags, ...forensicFlags];

    // 3. Save Audit Log to Supabase Scan Table
    const scanRecord = await prisma.scan.create({
      data: {
        documentType: documentType || "PASSPORT",
        extractedData: extractedData || { documentNumber, expiryDate, dob, gender, nationality },
        validationResults: { 
          isBlacklisted, 
          passportFormatValid: !flags.includes("INVALID_PASSPORT_FORMAT"),
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
      const selfieArg = selfiePath ? ` --selfie "${selfiePath}"` : "";
      const { stdout } = await execPromise(
        `${forensicsPython()} forensics_pipeline.py --document "${docPath}"${selfieArg}`
      );
      const forensics = JSON.parse(stdout);

      // 2. Merge OCR-extracted fields with explicit client overrides
      const ocrFields = forensics.ocr?.fields || {};
      const documentNumber = body.documentNumber || ocrFields.DocumentNumber?.value;
      const expiryDate = body.expiryDate || ocrFields.DateOfExpiration?.value;
      const dob = body.dob || ocrFields.DateOfBirth?.value;
      const gender = body.gender;
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
        tamperScore: (forensics.tamper?.tamperScore || 0) + (forensics.ai?.aiScore || 0)
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
          documentType: body.documentType || "PASSPORT",
          extractedData,
          validationResults: {
            isBlacklisted,
            passportFormatValid: !flags.includes("INVALID_PASSPORT_FORMAT"),
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
  INVALID_PASSPORT_FORMAT: "Document number does not match the Indian passport format (2 letters followed by 7 digits).",
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

    // FORCE DIRECT DOWNLOAD TO PC (attachment instead of inline)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="passport_audit_${scan.id}.pdf"`
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

    // ── Header band ───────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 84).fill("#0f172a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16)
      .text("PASSPORT VERIFICATION AUDIT CERTIFICATE", 0, 20, { align: "center", width: doc.page.width });
    doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1")
      .text("Government of India — Automated Identity & Document Screening Engine", 0, 44, { align: "center", width: doc.page.width });
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(`Report generated: ${generatedAt}`, 0, 62, { align: "center", width: doc.page.width });

    // ── Verdict banner ────────────────────────────────────────────
    let y = 104;
    doc.rect(48, y, 468, 52).fill(colors.band);
    doc.roundedRect(48, y, 468, 52, 4).fill(colors.band);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
      .text(`VERDICT  •  ${verdictLabel}`, 70, y + 9, { width: 300 });
    doc.fontSize(22)
      .text(`${scan.riskScore} / 100`, 0, y + 8, { align: "right", width: doc.page.width - 70 });
    doc.font("Helvetica").fontSize(8).fillColor("#f1f5f9")
      .text("RISK SCORE", 0, y + 40, { align: "right", width: doc.page.width - 70 });

    y += 72;

    // ── 1. Verification Summary ───────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
      .text("1.  Verification Summary");
    y += 18;
    y = drawDetailRow(doc, "Scan ID", scan.id, y, "—");
    y = drawDetailRow(doc, "Document Type", scan.documentType, y, "—");

    const formatStatus =
      validation.passportFormatValid === true ? "Valid format" :
      validation.passportFormatValid === false ? "Format validation failed" :
      "Not readable";
    y = drawDetailRow(doc, "Document Number", String(extracted.documentNumber || ""), y);
    y = drawDetailRow(doc, "Format Check", formatStatus, y, "—");

    const expiryLabel = extracted.expiryDate
      ? (validation.isExpired ? `${extracted.expiryDate} (Expired)` : `${extracted.expiryDate} (Active)`)
      : "";
    y = drawDetailRow(doc, "Expiry Date", extractDate(extracted.expiryDate), y);
    y = drawDetailRow(doc, "Expiry Status", expiryLabel, y, "Not readable");

    const blacklistStatus = validation.isBlacklisted ? "FLAGGED — on watchlist" : "Clear";
    y = drawDetailRow(doc, "Blacklist Status", blacklistStatus, y, "—");

    const faceText = facePerformed
      ? `${Math.round(faceScore * 100)}% match`
      : "Not performed (no selfie supplied)";
    const faceStatus = hasLowFaceFlag ? "Low confidence match" : (facePerformed ? "Within threshold" : "Skipped");
    y = drawDetailRow(doc, "Face Match Score", faceText, y, "—");

    y = drawDetailRow(doc, "Face Match Status", faceStatus, y, "—");
    y += 8;

    // ── 2. Extracted Document Details ─────────────────────────────
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
      .text("2.  Extracted Document Details");
    y += 18;
    y = drawDetailRow(doc, "Document Number", String(extracted.documentNumber || ""), y);
    y = drawDetailRow(doc, "Expiry Date", extractDate(extracted.expiryDate), y);
    y = drawDetailRow(doc, "Date of Birth", extractDate(extracted.dob), y);
    y = drawDetailRow(doc, "Gender", extracted.gender ? String(extracted.gender).toUpperCase() : "", y);
    y = drawDetailRow(doc, "Nationality", String(extracted.nationality || ""), y);
    y += 8;

    // ── 3. Findings & Reason Flags ────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
      .text("3.  Findings & Reason Flags");
    y += 14;
    if (findings.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#16a34a")
        .text("• No suspicious indicators were detected. The document passed all automated checks.");
    } else {
      findings.forEach((line) => {
        doc.font("Helvetica").fontSize(10).fillColor("#b91c1c");
        doc.text("•", 48, y, { lineBreak: false, continued: true });
        doc.fillColor("#0f172a").text(`  ${line}`, 60, y, { width: 456 });
        y += 16;
      });
    }
    y += 12;

    // ── Footer seal ───────────────────────────────────────────────
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = 60;
    }
    doc.strokeColor("#0f172a").lineWidth(1.5)
      .moveTo(48, y).lineTo(48 + 468, y).stroke();
    y += 14;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a")
      .text(`Audit Confirmation ID:  ${scan.id.slice(0, 8).toUpperCase()}`);
    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text(
        "This is a computer-generated audit certificate produced by the SNARE screening engine. " +
        "It summarises the automated findings of OCR extraction, document validation, watchlist screening, " +
        "forensic analysis and facial biometric consistency checks. A final decision is made by an authorised reviewer.",
        48, y + 18, { width: 468 }
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
// IDENTRA AI ASSISTANT (grounded in real data)
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
            "Every scan is scored from 0–100. Scores of 0–30 approve, 31–60 go to manual review, and 61–100 are rejected. The score combines validation errors (40%), tampering/blacklist signals (40%) and face-match confidence (20%). Flags such as INVALID_PASSPORT_FORMAT, EXPIRED_DOCUMENT, BLACKLISTED_DOCUMENT or tampering indicators raise the risk.",
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