"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function TaxCompliancePage() {
  return (
    <ModuleBlueprint
      active="tax-compliance"
      title="Tax Compliance"
      subtitle="Licenses, resale certificates, MSA data, and tax audit readiness"
      overview="Track customer and vendor tax credentials, product compliance attributes, tobacco/vapor license state, resale certificates, and reporting readiness."
      workflows={[
        { title: "License monitoring", description: "Monitor expired and missing customer, supplier, tobacco, vapor, hemp, and resale credentials.", status: "Planned" },
        { title: "Product compliance", description: "Review MSA category, promotion indicator, manufacturer description, and expiration attributes.", status: "Needs API" },
        { title: "Audit packet", description: "Assemble customer certificates, tax exemption evidence, product records, and transaction samples.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Customer compliance", description: "Tax ID, FEIN, tobacco license, vapor license, hemp license, and resale certificate." },
        { title: "Vendor compliance", description: "Tax ID, FEIN, vendor type, MSA type, and supporting documents." },
        { title: "Product MSA", description: "MSA category code, promotion indicator, manufacturer description, and compliance flags." },
        { title: "Tax rules", description: "Tax classes, exemptions, store locations, jurisdiction mapping, and override history." },
        { title: "Exceptions", description: "Missing certificates, expired licenses, failed validation, and blocked transactions." },
        { title: "Reports", description: "Audit exports, tax liability summaries, and compliance snapshots." },
      ]}
      actions={["Review exceptions", "Upload certificate", "Export audit packet", "Configure tax rules"]}
    />
  );
}
