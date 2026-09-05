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
// GET ENDPOINT: Generate and download a PDF Verification Certificate
// GET ENDPOINT: Generate and download a PDF Verification Certificate
app.get("/api/scans/:id/pdf", async (req, res) => {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: req.params.id }
    });

    if (!scan) {
      return res.status(404).json({ success: false, error: "Scan record not found" });
    }

    const doc = new PDFDocument({ margin: 50 });

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

    doc.pipe(res);

    // Document Header
    doc.fontSize(20).text("PASSPORT VERIFICATION AUDIT CERTIFICATE", { align: "center" });
    doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: "right" });
    doc.moveDown();

    // Verification Summary
    doc.fontSize(14).text("1. Scan Summary", { underline: true });
    doc.fontSize(10).text(`Scan ID: ${scan.id}`);
    doc.text(`Document Type: ${scan.documentType}`);
    doc.text(`Verdict: ${scan.verdict}`);
    doc.text(`Risk Score: ${scan.riskScore} / 100`);
    doc.text(`Face Match Score: ${(scan.faceScore * 100).toFixed(1)}%`);
    doc.moveDown();

    // Validation & Tampering Flags
    doc.fontSize(14).text("2. Verification Flags", { underline: true });
    const flags = scan.tamperingFlags.length > 0 ? scan.tamperingFlags.join(", ") : "NONE (CLEAN SCAN)";
    doc.fontSize(10).text(`Flags Triggered: ${flags}`);
    doc.moveDown();

    // Extracted Passport Details
    doc.fontSize(14).text("3. Extracted Document Details", { underline: true });
    doc.fontSize(10).text(JSON.stringify(scan.extractedData, null, 2));

    doc.end();
  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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
        reviewedBy: req.body?.actor || "Priyadarshani B."
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