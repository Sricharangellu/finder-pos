"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function ImportsExportsPage() {
  return (
    <ModuleBlueprint
      active="imports-exports"
      title="Imports/Exports"
      subtitle="Bulk data movement for catalog, customers, vendors, and inventory"
      overview="Provide controlled CSV and spreadsheet workflows for bulk updates, validations, rollback previews, and export packages."
      workflows={[
        { title: "Product import", description: "Validate product code, SKU, UPC, pricing, packaging, vendor, ecommerce, and compliance columns.", status: "Ready" },
        { title: "Customer import", description: "Load customer profiles, wholesale terms, tax compliance, ACH state, and addresses.", status: "Planned" },
        { title: "Inventory import", description: "Adjust stock by location with preview, validation, and audit trail.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Templates", description: "Product, customer, vendor, inventory, pricing, and category spreadsheet templates." },
        { title: "Validation", description: "Required fields, duplicate checks, reference checks, and compliance checks." },
        { title: "Preview", description: "Creates, updates, skipped rows, warnings, and destructive-change review." },
        { title: "Import history", description: "File name, actor, rows processed, failures, rollback state, and completion time." },
        { title: "Exports", description: "Catalog, customers, vendors, inventory, orders, reports, and audit packages." },
        { title: "Rollback", description: "Undo packages, affected records, limitations, and approval trail." },
      ]}
      actions={["Import products", "Download template", "Export catalog", "Review import history"]}
    />
  );
}
