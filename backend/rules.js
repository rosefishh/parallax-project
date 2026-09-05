// ==========================================
// STEP 4: INDIVIDUAL VALIDATION RULES
// ==========================================
// Each rule returns a tri-state status:
//   "valid"   - value present and passes the check
//   "invalid" - value present but fails the check (real defect)
//   "missing" - value not readable/supplied (OCR or client gave nothing)
// The risk engine treats only "invalid" as a hard defect. A "missing" field
// cannot be condemned as a forgery — it means we could not read the document,
// so it becomes a soft note that pushes toward REVIEW, never a hard REJECT.

// 1. Indian Passport Format Check (1-2 letters + 7 digits, e.g., Z1234567 / AB1234567)
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
// STEPS 6 & 7: RISK ENGINE & VERDICT LOGIC
// ==========================================

function calculateRiskScore({ documentNumber, expiryDate, dob, gender, nationality, faceScore, isBlacklisted, tamperScore = 0 }) {
  let validationErrors = 0;
  let tamperingFlagsCount = 0;
  let faceMismatchScore = 0;
  const flags = [];
  const missingFields = [];

  const passportNum = validatePassportNumber(documentNumber);
  const expiry = validateExpiryDate(expiryDate);
  const birth = validateDOB(dob);
  const gen = validateGender(gender);
  const nat = validateNationality(nationality);

  // --- Category 1: Validation Rules (40% Weight Category) ---
  if (passportNum === "invalid") {
    validationErrors += 20;
    flags.push("INVALID_PASSPORT_FORMAT");
  } else if (passportNum === "missing") {
    missingFields.push("Passport Number");
  }

  if (expiry === "invalid") {
    validationErrors += 20;
    flags.push("EXPIRED_DOCUMENT");
  } else if (expiry === "missing") {
    missingFields.push("Expiry Date");
  }

  if (birth === "invalid") {
    validationErrors += 20;
    flags.push("UNDERAGE_OR_INVALID_DOB");
  } else if (birth === "missing") {
    missingFields.push("Date of Birth");
  }

  if (gen === "invalid") {
    validationErrors += 20;
    flags.push("INVALID_GENDER_CODE");
  } else if (gen === "missing") {
    missingFields.push("Gender");
  }

  if (nat === "invalid") {
    validationErrors += 20;
    flags.push("UNSUPPORTED_NATIONALITY");
  } else if (nat === "missing") {
    missingFields.push("Nationality");
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
  // or blacklisted passport, an invalid document number, a tampered image, or
  // a biometric mismatch all need a human — floor any such scan at REVIEW.
  const hardDefect =
    flags.some((f) => ["EXPIRED_DOCUMENT", "BLACKLISTED_DOCUMENT", "INVALID_PASSPORT_FORMAT", "LOW_FACE_MATCH_SCORE"].includes(f)) ||
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
  validatePassportNumber,
  validateExpiryDate,
  validateDOB,
  validateGender,
  validateNationality,
  calculateRiskScore
};