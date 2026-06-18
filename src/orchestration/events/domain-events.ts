import type { Cents } from "../../shared/money.js";

/** Typed payloads for every domain event the orchestration layer produces or consumes. */

export interface OrderCreatedPayload {
  id: string;
  tenantId: string;
  orderNumber: string;
  stateCode: string;
  totalCents: Cents;
  customerId?: string | null;
  storeId?: string | null;
  lines: Array<{ productId: string; quantity: number; unitCents: Cents }>;
}

export interface PaymentCapturedPayload {
  id: string;
  tenantId: string;
  orderId: string;
  method: string;
  amountCents: Cents;
}

export interface PurchaseOrderReceivedPayload {
  tenantId: string;
  poId: string;
  supplierId: string;
  totalCostCents: Cents;
  lines: Array<{
    productId: string;
    quantity: number;
    unitCostCents: number;
    landedCostCents?: number;
    expiryDate?: number;
    lotCode?: string | null;
  }>;
}

export interface InventoryTransferRequestedPayload {
  tenantId: string;
  transferId: string;
  fromOutletId: string;
  toOutletId: string;
  productId: string;
  quantity: number;
  notes?: string;
}

export interface StockAdjustmentRequestedPayload {
  tenantId: string;
  productId: string;
  delta: number;
  reason: string;
  referenceId?: string;
  userId?: string;
}

export interface OrderRefundedPayload {
  id: string;
  tenantId: string;
  originalTotalCents: Cents;
  refundCents: Cents;
  customerId?: string | null;
  lines: Array<{ productId: string; quantity: number }>;
}

export interface CustomerReturnRequestedPayload {
  tenantId: string;
  returnId: string;
  orderId: string;
  customerId?: string | null;
  lines: Array<{ productId: string; quantity: number; condition: "resellable" | "damaged" }>;
}

export interface AccountingEntryRequestedPayload {
  tenantId: string;
  referenceId: string;
  referenceType: string;
  lines: Array<{ accountCode: string; debitCents: Cents; creditCents: Cents; description: string }>;
}

export interface EcommerceSyncRequestedPayload {
  tenantId: string;
  platform: string;
  syncType: "full" | "incremental";
  since?: number;
}

export interface GiftcardRedeemedPayload {
  tenantId: string;
  cardId: string;
  orderId: string;
  amountCents: Cents;
}

export interface ShipmentCreatedPayload {
  tenantId: string;
  shipmentId: string;
  orderId: string;
  carrier?: string;
}

export interface StoreSessionPayload {
  tenantId: string;
  sessionId: string;
  outletId: string;
  userId: string;
  cashCents?: Cents;
}

export interface ReconciliationStartedPayload {
  tenantId: string;
  batchId: string;
  fromAt: number;
  toAt: number;
}
