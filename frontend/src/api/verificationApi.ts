import { apiGet, apiPost, API_BASE_URL, type ApiSuccess } from "./apiClient";
import type { ScanDetail, ScanListResponse, ScanRecord } from "./types";

export async function scanDocument(formData: FormData): Promise<ApiSuccess<ScanDetail>> {
  return await apiPost<ApiSuccess<ScanDetail>>("/scan/file", formData);
}

export async function fetchScan(id: string): Promise<ScanRecord> {
  const res = await apiGet<ApiSuccess<ScanRecord>>(`/scans/${id}`);
  return res.data;
}

export async function reviewScan(id: string, flag: boolean, actor?: string): Promise<ScanRecord> {
  const res = await apiPost<ApiSuccess<ScanRecord>>(`/scans/${id}/review`, { flag, actor });
  return res.data;
}

export async function fetchScans(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<ScanListResponse> {
  return await apiGet<ScanListResponse>("/scans", {
    page: params?.page,
    limit: params?.limit,
    status: params?.status,
  });
}

export function pdfReportUrl(scanId: string): string {
  return `${API_BASE_URL}/scans/${scanId}/pdf`;
}

export async function downloadPdfReport(scanId: string): Promise<void> {
  const response = await fetch(pdfReportUrl(scanId));
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `passport_audit_${scanId}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}