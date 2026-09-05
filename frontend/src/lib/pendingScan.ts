// Session-scoped bridge for the verification wizard (New Verification → Screening → Result).
// Kept in module memory because a File object cannot be serialized into the URL.

let pending: PendingScan | null = null;

export type PendingScan = {
  file: File;
  documentType: string;
  faceMatch: boolean;
  selfie?: File | null;
};

export function setPendingScan(scan: PendingScan) {
  pending = scan;
}

export function getPendingScan(): PendingScan | null {
  return pending;
}