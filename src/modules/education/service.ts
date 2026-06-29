import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export type StudentStatus = "active" | "inactive" | "graduated";
export type FeeStatus = "pending" | "paid" | "overdue" | "waived";

export interface Student {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  course_id: string | null;
  enrolled_at: number | null;
  status: StudentStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface FeeRecord {
  id: string;
  tenant_id: string;
  student_id: string;
  description: string;
  amount_cents: number;
  due_date: string | null;
  paid_at: number | null;
  payment_method: string | null;
  status: FeeStatus;
  created_at: number;
}

export type EducationService = ReturnType<typeof educationService>;

export function educationService(db: DB, events: EventBus) {
  return {
    async listStudents(tenantId: string, status?: StudentStatus): Promise<Student[]> {
      const where = status
        ? "WHERE tenant_id = @t AND status = @status ORDER BY name"
        : "WHERE tenant_id = @t ORDER BY name";
      return db.query<Student>(
        `SELECT * FROM students ${where} LIMIT 200`,
        status ? { t: tenantId, status } : { t: tenantId },
      );
    },

    async createStudent(tenantId: string, input: {
      name: string;
      email?: string;
      phone?: string;
      dateOfBirth?: string;
      courseId?: string;
      enrolledAt?: number;
      notes?: string;
    }): Promise<Student> {
      const now = Date.now();
      const row: Student = {
        id: `stu_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        email: input.email ?? "",
        phone: input.phone ?? null,
        date_of_birth: input.dateOfBirth ?? null,
        course_id: input.courseId ?? null,
        enrolled_at: input.enrolledAt ?? now,
        status: "active",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO students (id, tenant_id, name, email, phone, date_of_birth, course_id, enrolled_at, status, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @name, @email, @phone, @date_of_birth, @course_id, @enrolled_at, @status, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      void events.publish("education.student_enrolled", { tenantId, studentId: row.id }, row.id);
      return row;
    },

    async updateStudent(tenantId: string, id: string, input: Partial<{
      name: string;
      email: string;
      phone: string;
      dateOfBirth: string;
      courseId: string;
      enrolledAt: number;
      status: StudentStatus;
      notes: string;
    }>): Promise<Student> {
      const existing = await db.one<Student>(
        "SELECT * FROM students WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`student '${id}'`);
      const now = Date.now();
      const updated: Student = {
        ...existing,
        name: input.name !== undefined ? input.name : existing.name,
        email: input.email !== undefined ? input.email : existing.email,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        date_of_birth: input.dateOfBirth !== undefined ? input.dateOfBirth : existing.date_of_birth,
        course_id: input.courseId !== undefined ? input.courseId : existing.course_id,
        enrolled_at: input.enrolledAt !== undefined ? input.enrolledAt : existing.enrolled_at,
        status: input.status !== undefined ? input.status : existing.status,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        updated_at: now,
      };
      await db.query(
        `UPDATE students SET name=@name, email=@email, phone=@phone, date_of_birth=@date_of_birth,
         course_id=@course_id, enrolled_at=@enrolled_at, status=@status, notes=@notes, updated_at=@updated_at
         WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated, id, tenant_id: tenantId } as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listFees(tenantId: string, studentId: string): Promise<FeeRecord[]> {
      return db.query<FeeRecord>(
        "SELECT * FROM fee_records WHERE tenant_id = @t AND student_id = @studentId ORDER BY created_at DESC",
        { t: tenantId, studentId },
      );
    },

    async createFee(tenantId: string, studentId: string, input: {
      description: string;
      amountCents: number;
      dueDate?: string;
    }): Promise<FeeRecord> {
      const student = await db.one<{ id: string }>(
        "SELECT id FROM students WHERE id = @id AND tenant_id = @t",
        { id: studentId, t: tenantId },
      );
      if (!student) throw notFound(`student '${studentId}'`);
      const now = Date.now();
      const row: FeeRecord = {
        id: `fee_${uuidv7()}`,
        tenant_id: tenantId,
        student_id: studentId,
        description: input.description,
        amount_cents: input.amountCents,
        due_date: input.dueDate ?? null,
        paid_at: null,
        payment_method: null,
        status: "pending",
        created_at: now,
      };
      await db.query(
        `INSERT INTO fee_records (id, tenant_id, student_id, description, amount_cents, due_date, paid_at, payment_method, status, created_at)
         VALUES (@id, @tenant_id, @student_id, @description, @amount_cents, @due_date, @paid_at, @payment_method, @status, @created_at)`,
        row as unknown as Record<string, unknown>,
      );
      return row;
    },

    async payFee(tenantId: string, feeId: string, input: { paymentMethod: string }): Promise<FeeRecord> {
      const fee = await db.one<FeeRecord>(
        "SELECT * FROM fee_records WHERE id = @id AND tenant_id = @t",
        { id: feeId, t: tenantId },
      );
      if (!fee) throw notFound(`fee_record '${feeId}'`);
      if (fee.status !== "pending" && fee.status !== "overdue") {
        throw new HttpError(409, "fee_not_payable", `Fee cannot be paid (status: ${fee.status}).`);
      }
      const now = Date.now();
      await db.query(
        "UPDATE fee_records SET status = 'paid', paid_at = @now, payment_method = @pm WHERE id = @id AND tenant_id = @t",
        { now, pm: input.paymentMethod, id: feeId, t: tenantId },
      );
      void events.publish("education.fee_paid", { tenantId, feeId, studentId: fee.student_id }, feeId);
      return { ...fee, status: "paid", paid_at: now, payment_method: input.paymentMethod };
    },
  };
}
