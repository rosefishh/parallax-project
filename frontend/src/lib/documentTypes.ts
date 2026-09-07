export type DocumentTypeCode = "PASSPORT" | "AADHAAR" | "PAN" | "VOTER_ID";

export type DocumentTypeMeta = {
  code: DocumentTypeCode;
  label: string;
  hi: string;
  numberLabel: string;
  hint: string;
  fields: string[];
  requiresExpiry: boolean;
  requiresNationality: boolean;
  requiresGender: boolean;
};

export const DOCUMENT_TYPES: DocumentTypeMeta[] = [
  {
    code: "PASSPORT",
    label: "Passport (International)",
    hi: "पासपोर्ट",
    numberLabel: "Passport Number",
    hint: "2 letters + 7 digits · expiry & nationality checked",
    fields: ["Passport Number", "Expiry Date", "Date of Birth", "Gender", "Nationality"],
    requiresExpiry: true,
    requiresNationality: true,
    requiresGender: true,
  },
  {
    code: "AADHAAR",
    label: "Aadhaar",
    hi: "आधार",
    numberLabel: "Aadhaar Number",
    hint: "12-digit UIDAI number · Verhoeff checksum verified",
    fields: ["Aadhaar Number (12 digits + checksum)", "Date of Birth", "Gender"],
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: true,
  },
  {
    code: "PAN",
    label: "PAN Card",
    hi: "पैन कार्ड",
    numberLabel: "PAN Number",
    hint: "5 letters + 4 digits + 1 letter",
    fields: ["PAN Number", "Date of Birth"],
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: false,
  },
  {
    code: "VOTER_ID",
    label: "Voter ID",
    hi: "मतदाता पहचान पत्र",
    numberLabel: "EPIC Number",
    hint: "3 letters + 7 digits",
    fields: ["EPIC Number", "Date of Birth", "Gender"],
    requiresExpiry: false,
    requiresNationality: false,
    requiresGender: true,
  },
];

export function normalizeDocumentTypeCode(value: string | null | undefined): DocumentTypeCode {
  const s = (value ?? "").toUpperCase().trim();
  if (s.includes("AADHAAR") || s.includes("UIDAI") || s.includes("12-DIGIT")) return "AADHAAR";
  if (s === "PAN" || s.includes("PAN CARD")) return "PAN";
  if (s.includes("VOTER") || s.includes("EPIC") || s.includes("ELECTOR")) return "VOTER_ID";
  return "PASSPORT";
}

export function documentTypeMeta(value: string | null | undefined): DocumentTypeMeta {
  const code = normalizeDocumentTypeCode(value);
  return DOCUMENT_TYPES.find((d) => d.code === code) ?? DOCUMENT_TYPES[0];
}