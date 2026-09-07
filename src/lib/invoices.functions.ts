import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import {
  fetchAccountInvoiceRows,
  fetchAdminInvoiceRows,
  fetchInvoiceByIdRow,
  findInvoiceByPfPaymentIdRow,
  hasServerBackendRole,
  type InvoiceBackendRow,
} from "@/lib/backend-provider.server";

export type InvoiceRow = InvoiceBackendRow;

function requireCredential(): string {
  const credential = resolveRonsRequestCredential(getRequest());
  if (!credential) throw new Error("Unauthorized: Invalid or missing session");
  return credential;
}

export const getMyInvoices = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<InvoiceRow[]> =>
    fetchAccountInvoiceRows(requireCredential(), context.userId));

export const getInvoiceById = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((data: { id: string }) => {
    if (!data?.id || typeof data.id !== "string") throw new Error("id required");
    return data;
  })
  .handler(async ({ context, data }): Promise<InvoiceRow | null> =>
    fetchInvoiceByIdRow(requireCredential(), context.userId, data.id));

export const findInvoiceByPfPaymentId = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((data: { pfPaymentId: string }) => {
    if (!data?.pfPaymentId || typeof data.pfPaymentId !== "string") {
      throw new Error("pfPaymentId required");
    }
    return data;
  })
  .handler(async ({ context, data }): Promise<{ id: string } | null> =>
    findInvoiceByPfPaymentIdRow(requireCredential(), context.userId, data.pfPaymentId));

export const listAllInvoices = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((data: { status?: string; app?: string; q?: string } | undefined) => data ?? {})
  .handler(async ({ context, data }): Promise<InvoiceRow[]> => {
    if (!(await hasServerBackendRole(context.userId, "admin"))) throw new Error("Forbidden");
    return fetchAdminInvoiceRows(requireCredential(), data);
  });

export function formatMoney(cents: number, currency = "ZAR"): string {
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
