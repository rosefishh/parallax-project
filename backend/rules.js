// ==========================================
// INDIVIDUAL VALIDATION RULES — MULTI-DOCUMENT
// ==========================================
// Each rule returns a tri-state status:
//   "valid"   - value present and passes the check
//   "invalid" - value present but fails the check (real defect)
//   "missing" - value not readable/supplied (OCR or client gave nothing)
// The risk engine treats only "invalid" as a hard defect. A "missing" field
// cannot be condemned as a forgery — it means we could not read the document,
// so it becomes a soft note that pushes toward REVIEW, never a hard REJECT.
//
// Supported document types are validated against their own formats and only
// the fields they actually carry (for example Aadhaar / PAN / Voter ID have no
// expiry date, so they are never penalised for a missing expiry).

// --- Aadhaar uses the Verhoeff checksum on its 12-digit number ---
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

// Verhoeff checksum: true when the final 12th digit makes the check validate.
function verhoeffValidate(num) {
  const digits = String(num).replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

// --- Per-document-type profile ---------------------------------------------
const DOC_TYPES = {
  PASSPORT: {
    code: "PASSPORT",
    label: "Passport",
    numberLabel: "Passport Number",
    title: "PASSPORT VERIFICATION",
    slug: "passport",
    numberPattern: /^[A-Z]{1,2}\d{7}$/,
    checksum: null,
    requiresExpiry: true,
    requiresNationality: true,
    requiresGender: true,
  },
  AADHAAR: {
    code: "AADHAAR",
    label: "Aadhaar",
    numberLabel: "Aadhaar Number",
    title: "AADHAAR VERIFICATION",
    slug: "aadhaar",
    numberPattern: /^\d{12}$/,
    checksum: verhoeffValidate,
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: true,
  },
  PAN: {
    code: "PAN",
    label: "PAN",
    numberLabel: "PAN Number",
    title: "PAN VERIFICATION",
    slug: "pan",
    numberPattern: /^[A-Z]{5}\d{4}[A-Z]$/,
    checksum: null,
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: false,
  },
  VOTER_ID: {
    code: "VOTER_ID",
    label: "Voter ID",
    numberLabel: "EPIC Number",
    title: "VOTER ID VERIFICATION",
    slug: "voter-id",
    numberPattern: /^[A-Z]{3}\d{7}$/,
    checksum: null,
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: true,
  },
};

// Normalise whatever the client sent (code or casual label) to a known code.
function normalizeDocumentType(value) {
  const s = String(value || "").toUpperCase().trim();
  if (/AADHAAR|UIDAI|12.?DIGIT/.test(s)) return "AADHAAR";
  if (/(^|[\s-])PAN([\s-]|$)/.test(s) || /PAN CARD/.test(s)) return "PAN";
  if (/VOTER|EPIC|ELECTOR/.test(s)) return "VOTER_ID";
  if (/PASS|NATION|RESIDENC|DRIV/.test(s)) return "PASSPORT";
  return "PASSPORT";
}

function documentTypeMeta(value) {
  return DOC_TYPES[normalizeDocumentType(value)] || DOC_TYPES.PASSPORT;
}

// --- Document number check (pattern + optional checksum) -------------------
function validateDocumentNumber(docNum, meta) {
  const normalized = String(docNum || "").replace(/\s+/g, "").toUpperCase();
  if (!normalized) return "missing";
  if (!meta.numberPattern.test(normalized)) return "invalid";
  if (meta.checksum && !meta.checksum(normalized)) return "invalid";
  return "valid";
}

// Kept for backwards compatibility with older importers.
function validatePassportNumber(docNum) {
  if (!docNum) return "missing";
  const indianPassportRegex = /^[A-Z]{1,2}\d{7}$/;
  return indianPassportRegex.test(docNum.trim()) ? "valid" : "invalid";
}

// 2. Expiration Date Check (Must be in the future)
function validateExpiryDate(expiryDate) {
  if (!expiryDate) return "missing";
  const expiry = new Date(expiryDate);
  if (isNaN(expiry.getTime())) return "invalid";
  return expiry > new Date() ? "valid" : "invalid";
}

// 3. Date of Birth Check (Must be at least 18 years old)
function validateDOB(dob) {
  if (!dob) return "missing";
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return "invalid";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 18 ? "valid" : "invalid";
}

// 4. Gender Code Check (M, F, X)
function validateGender(gender) {
  if (!gender) return "missing";
  const validGenders = ["M", "F", "X"];
  return validGenders.includes(gender.toUpperCase()) ? "valid" : "invalid";
}

// 5. Nationality Code Check (IND)
function validateNationality(nationality) {
  if (!nationality) return "missing";
  return nationality.toUpperCase() === "IND" ? "valid" : "invalid";
}

// ==========================================
// RISK ENGINE & VERDICT LOGIC
// ==========================================

function calculateRiskScore({ documentNumber, expiryDate, dob, gender, nationality, faceScore, isBlacklisted, tamperScore = 0, documentType = "PASSPORT" }) {
  const meta = documentTypeMeta(documentType);

  let validationErrors = 0;
  let tamperingFlagsCount = 0;
  let faceMismatchScore = 0;
  const flags = [];
  const missingFields = [];

  const docNum = validateDocumentNumber(documentNumber, meta);
  const expiry = validateExpiryDate(expiryDate);
  const birth = validateDOB(dob);
  const gen = validateGender(gender);
  const nat = validateNationality(nationality);

  // --- Category 1: Validation Rules (40% Weight Category) ---
  if (docNum === "invalid") {
    validationErrors += 20;
    flags.push("INVALID_DOCUMENT_FORMAT");
    if (meta.code === "AADHAAR" && /^\d{12}$/.test(String(documentNumber || "").replace(/\s+/g, ""))) {
      flags.push("AADHAAR_CHECKSUM_FAILED");
    }
  } else if (docNum === "missing") {
    missingFields.push(meta.numberLabel);
  }

  // Expiry only applies to document types that actually carry one.
  if (meta.requiresExpiry) {
    if (expiry === "invalid") {
      validationErrors += 20;
      flags.push("EXPIRED_DOCUMENT");
    } else if (expiry === "missing") {
      missingFields.push("Expiry Date");
    }
  }

  if (birth === "invalid") {
    validationErrors += 20;
    flags.push("UNDERAGE_OR_INVALID_DOB");
  } else if (birth === "missing") {
    missingFields.push("Date of Birth");
  }

  if (meta.requiresGender) {
    if (gen === "invalid") {
      validationErrors += 20;
      flags.push("INVALID_GENDER_CODE");
    } else if (gen === "missing") {
      missingFields.push("Gender");
    }
  }

  if (meta.requiresNationality) {
    if (nat === "invalid") {
      validationErrors += 20;
      flags.push("UNSUPPORTED_NATIONALITY");
    } else if (nat === "missing") {
      missingFields.push("Nationality");
    }
  }

  // --- Category 2: Blacklist + Forensic/Tamper Check (40% Weight Category) ---
  if (isBlacklisted) {
    tamperingFlagsCount += 100;
    flags.push("BLACKLISTED_DOCUMENT");
  }

  // Forensic penalty from the Python engine (tampering + AI-generation scores)
  if (tamperScore > 0) {
    tamperingFlagsCount += tamperScore;
  }

  // --- Category 3: Face Score Check (20% Weight Category) ---
  const parsedFaceScore = parseFloat(faceScore) || 1.0;
  if (parsedFaceScore < 0.75) {
    faceMismatchScore = (1 - parsedFaceScore) * 100;
    flags.push("LOW_FACE_MATCH_SCORE");
  }

  // --- Weighted Risk Calculation Formula ---
  // (Validation Errors × 40%) + (Tampering/Blacklist × 40%) + (Face Mismatch × 20%)
  const rawScore =
    (Math.min(validationErrors, 100) * 0.40) +
    (Math.min(tamperingFlagsCount, 100) * 0.40) +
    (Math.min(faceMismatchScore, 100) * 0.20);

  // Unreadable fields are not defects, but they raise uncertainty. Each
  // unreadable field escalates the review floor by a step (31, 37, 43, 49, 55)
  // instead of collapsing every partially-read document onto a flat 31, so
  // partially legible documents produce distinct scores and still never
  // silently APPROVE.
  const missingPenalty = missingFields.length * 6;
  let finalRiskScore = Math.round(Math.min(rawScore, 100));
  if (missingFields.length > 0) {
    const reviewFloor = 25 + missingPenalty;
    finalRiskScore = Math.max(finalRiskScore, reviewFloor);
    if (rawScore < 31) {
      flags.push("UNREADABLE_DOCUMENT_FIELDS");
    }
  }

  // A *readable but defective* document must also not auto-approve: an expired
  // or blacklisted document, an invalid document number, a tampered image, or
  // a biometric mismatch all need a human — floor any such scan at REVIEW.
  const hardDefect =
    flags.some((f) => ["EXPIRED_DOCUMENT", "BLACKLISTED_DOCUMENT", "INVALID_DOCUMENT_FORMAT", "LOW_FACE_MATCH_SCORE", "UNDERAGE_OR_INVALID_DOB"].includes(f)) ||
    tamperScore > 0;
  if (hardDefect) {
    finalRiskScore = Math.max(finalRiskScore, 31);
  }

  // --- Step 7: Verdict Assignment Logic ---
  // 0-30: APPROVE, 31-60: REVIEW, 61-100: REJECT
  let verdict = "APPROVE";
  if (finalRiskScore > 60) {
    verdict = "REJECT";
  } else if (finalRiskScore >= 31) {
    verdict = "REVIEW";
  }

  return { riskScore: finalRiskScore, verdict, flags, missingFields };
}

module.exports = {
  DOC_TYPES,
  verhoeffValidate,
  normalizeDocumentType,
  documentTypeMeta,
  validateDocumentNumber,
  validatePassportNumber,
  validateExpiryDate,
  validateDOB,
  validateGender,
  validateNationality,
  calculateRiskScore
};