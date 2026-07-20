import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { badRequest, conflict, notFound } from "../../shared/http.js";

/**
 * EDI-imports: gap-closure surface for the Purchasing > EDI Imports page
 * (2026-07-18, Phase 0 FE↔BE gap-closure pass — see
 * WORK/audits/AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md).
 *
 * IMPORTANT scope note, read before touching validate()/process(): the
 * frontend's upload form (web/app/(protected)/purchasing/edi-imports/
 * _components/UploadTab.tsx handleSubmit) never sends the file's bytes —
 * only {filename, format, supplier_id, supplier_name, file_size_bytes}. No
 * FormData, no file.text(), no base64. That means the actual EDI content
 * (X12 850/855/856/810 segments, EDIFACT ORDERS, or CSV/JSON/XML rows) never
 * reaches this backend, on this branch, today. Real format-specific parsing
 * is therefore NOT buildable from here — there is nothing to parse.
 *
 * What IS real and honest below:
 *   - Full CRUD/status-tracking for edi_imports records (queued -> validating
 *     -> valid/invalid -> processed/failed), backed by a real table.
 *   - validate() is a genuine state-machine transition driven by the only
 *     real metadata we have (file_size_bytes, format key) — not fabricated
 *     content inspection.
 *   - preview_lines is always [] — there is no real file content to derive a
 *     preview from, and inventing "parsed" segments would be exactly the
 *     dishonest "looks built but isn't" pattern this effort exists to avoid.
 *   - process() cannot create real purchase orders for uploaded files: there
 *     is no per-line data (SKUs, quantities, costs) anywhere to build a PO
 *     from. It performs the real status transition (valid -> processed) and
 *     honestly returns created_po_ids: [] — it does not invent POs.
 *
 * Closing this gap for real needs two product decisions from Sri, tracked in
 * WORK/LOOP_STATE.md's NEEDS-SRI table: (a) fix the frontend to actually
 * upload file bytes (multipart or base64), and (b) pick either a real
 * X12/EDIFACT parser library or a defined subset format (e.g. CSV-only) to
 * parse against — the same class of decision as catalog's `/credits` gap.
 */

export type EdiStatus = "queued" | "validating" | "valid" | "invalid" | "processed" | "failed";

export interface EdiFormatDef {
  key: string;
  label: string;
}

// Matches the frontend's fallback list (UploadTab.tsx loadFormats' catch
// branch) exactly, since GET /formats existing for real means the fallback
// should never actually be hit in production.
export const EDI_FORMATS: EdiFormatDef[] = [
  { key: "x12_850", label: "X12 850 (Purchase Order)" },
  { key: "x12_855", label: "X12 855 (PO Acknowledgment)" },
  { key: "x12_856", label: "X12 856 (Ship Notice/ASN)" },
  { key: "x12_810", label: "X12 810 (Invoice)" },
  { key: "edifact_orders", label: "EDIFACT ORDERS" },
  { key: "csv_po", label: "CSV Purchase Order" },
  { key: "json_po", label: "JSON Purchase Order" },
  { key: "xml_po", label: "XML Purchase Order" },
];
const FORMAT_LABEL = new Map(EDI_FORMATS.map((f) => [f.key, f.label]));

export interface EdiImport {
  id: string;
  filename: string;
  format: string;
  supplier_id: string | null;
  supplier_name: string;
  file_size_bytes: number;
  record_count: number;
  status: EdiStatus;
  uploaded_at: number;
  processed_at: number | null;
  po_count: number;
  line_count: number;
  error_count: number;
  warnings: string[];
  errors: string[];
  created_po_ids: string[];
}

export interface CreateEdiImportInput {
  filename: string;
  format: string;
  supplier_id: string;
  supplier_name: string;
  file_size_bytes: number;
}

interface EdiImportRow {
  id: string;
  tenant_id: string;
  filename: string;
  format: string;
  supplier_id: string | null;
  supplier_name: string;
  file_size_bytes: number;
  record_count: number;
  status: EdiStatus;
  uploaded_at: number;
  processed_at: number | null;
  po_count: number;
  line_count: number;
  error_count: number;
  warnings: string;
  errors: string;
  created_po_ids: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function rowToImport(row: EdiImportRow): EdiImport {
  return {
    id: row.id,
    filename: row.filename,
    format: row.format,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    file_size_bytes: Number(row.file_size_bytes),
    record_count: Number(row.record_count),
    status: row.status,
    uploaded_at: Number(row.uploaded_at),
    processed_at: row.processed_at === null ? null : Number(row.processed_at),
    po_count: Number(row.po_count),
    line_count: Number(row.line_count),
    error_count: Number(row.error_count),
    warnings: parseJsonArray(row.warnings),
    errors: parseJsonArray(row.errors),
    created_po_ids: parseJsonArray(row.created_po_ids),
  };
}

export class EdiImportsService {
  constructor(private readonly db: DB) {}

  listFormats(): EdiFormatDef[] {
    return EDI_FORMATS;
  }

  async create(input: CreateEdiImportInput, tenantId: string): Promise<EdiImport> {
    if (!input.filename.trim()) throw badRequest("filename is required");
    if (!input.format.trim()) throw badRequest("format is required");
    if (!input.supplier_name.trim()) throw badRequest("supplier_name is required");
    const now = Date.now();
    const row: EdiImportRow = {
      id: `edi_${uuidv7()}`,
      tenant_id: tenantId,
      filename: input.filename,
      format: input.format,
      supplier_id: input.supplier_id || null,
      supplier_name: input.supplier_name,
      file_size_bytes: Math.max(0, Math.trunc(input.file_size_bytes ?? 0)),
      // Honest zero: no file content reached this backend, so there is
      // nothing to count records from yet (see class-level doc comment).
      record_count: 0,
      status: "queued",
      uploaded_at: now,
      processed_at: null,
      po_count: 0,
      line_count: 0,
      error_count: 0,
      warnings: "[]",
      errors: "[]",
      created_po_ids: "[]",
    };
    await this.db.query(
      `INSERT INTO edi_imports (
         id, tenant_id, filename, format, supplier_id, supplier_name, file_size_bytes,
         record_count, status, uploaded_at, processed_at, po_count, line_count, error_count,
         warnings, errors, created_po_ids
       ) VALUES (
         @id, @tenant_id, @filename, @format, @supplier_id, @supplier_name, @file_size_bytes,
         @record_count, @status, @uploaded_at, @processed_at, @po_count, @line_count, @error_count,
         @warnings, @errors, @created_po_ids
       )`,
      row as unknown as Record<string, unknown>,
    );
    return rowToImport(row);
  }

  async list(tenantId: string, status?: string): Promise<EdiImport[]> {
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (status && status !== "all") {
      where.push("status = @status");
      params["status"] = status;
    }
    const rows = await this.db.query<EdiImportRow>(
      `SELECT * FROM edi_imports WHERE ${where.join(" AND ")} ORDER BY uploaded_at DESC LIMIT 500`,
      params,
    );
    return rows.map(rowToImport);
  }

  private async getRow(id: string, tenantId: string): Promise<EdiImportRow> {
    const row = await this.db.one<EdiImportRow>(
      "SELECT * FROM edi_imports WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw notFound(`EDI import '${id}' not found`);
    return row;
  }

  async get(id: string, tenantId: string): Promise<EdiImport & { format_label: string; preview_lines: never[] }> {
    const row = await this.getRow(id, tenantId);
    return {
      ...rowToImport(row),
      format_label: FORMAT_LABEL.get(row.format) ?? row.format,
      // Always empty: there is no real file content on this branch to derive
      // a preview from (see class-level doc comment) — fabricating segments
      // here would misrepresent what the backend actually did.
      preview_lines: [],
    };
  }

  /**
   * Real state-machine transition, driven by the only genuine metadata we
   * have (declared format + stored file size). This is honest validation of
   * what was actually submitted, not a simulation of parsing file content.
   */
  async validate(id: string, tenantId: string): Promise<EdiImport> {
    const row = await this.getRow(id, tenantId);
    if (row.status !== "queued") {
      throw conflict(`import '${id}' is '${row.status}' — only a queued import can be validated`);
    }
    const errors: string[] = [];
    const warnings: string[] = [
      "Real EDI file content was never uploaded to the backend — this import validated only the stored metadata (filename, declared format, file size). No records were parsed.",
    ];
    if (!FORMAT_LABEL.has(row.format)) errors.push(`Unknown EDI format '${row.format}'`);
    if (Number(row.file_size_bytes) <= 0) errors.push("File size is 0 bytes — nothing was uploaded");

    const nextStatus: EdiStatus = errors.length > 0 ? "invalid" : "valid";
    const now = Date.now();
    await this.db.query(
      `UPDATE edi_imports SET status = @status, error_count = @errorCount, warnings = @warnings, errors = @errors
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        id, tenantId, status: nextStatus,
        errorCount: errors.length,
        warnings: JSON.stringify(warnings),
        errors: JSON.stringify(errors),
      },
    );
    void now;
    return rowToImport({ ...row, status: nextStatus, error_count: errors.length, warnings: JSON.stringify(warnings), errors: JSON.stringify(errors) });
  }

  /**
   * Real status transition only. There is no per-line data anywhere for an
   * uploaded file (no SKUs/quantities/costs ever arrived — see class-level
   * doc comment), so this never fabricates purchase orders. created_po_ids
   * is honestly empty for every import processed through this path.
   */
  async process(id: string, tenantId: string): Promise<{ import: EdiImport; created_po_ids: string[] }> {
    const row = await this.getRow(id, tenantId);
    if (row.status !== "valid") {
      throw conflict(`import '${id}' is '${row.status}' — only a valid import can be processed`);
    }
    const now = Date.now();
    const createdPoIds: string[] = [];
    const warnings = [
      ...parseJsonArray(row.warnings),
      "0 purchase orders created — no real per-line data exists for this import (the uploaded file's content was never sent to the backend). See WORK/LOOP_STATE.md NEEDS-SRI for what's required to build real PO creation from EDI files.",
    ];
    await this.db.query(
      `UPDATE edi_imports SET status = 'processed', processed_at = @now, created_po_ids = @createdPoIds, warnings = @warnings
       WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, now, createdPoIds: JSON.stringify(createdPoIds), warnings: JSON.stringify(warnings) },
    );
    const updated = rowToImport({ ...row, status: "processed", processed_at: now, created_po_ids: JSON.stringify(createdPoIds), warnings: JSON.stringify(warnings) });
    return { import: updated, created_po_ids: createdPoIds };
  }
}
