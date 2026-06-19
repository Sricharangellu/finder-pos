"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function IntegrationsPage() {
  return (
    <ModuleBlueprint
      active="integrations"
      title="Integrations"
      subtitle="Ecommerce, accounting, payment, reporting, and sync health"
      overview="Manage external system connections, monitor failed sync jobs, inspect integration payloads, and recover from channel-specific failures."
      workflows={[
        { title: "Integration catalog", description: "Configure ecommerce, accounting, payment gateway, warehouse, and reporting connectors.", status: "Planned" },
        { title: "Failed jobs", description: "Triage failed product, inventory, order, payment, customer, and accounting sync jobs.", status: "Needs API" },
        { title: "Replay queue", description: "Retry corrected payloads and monitor downstream acknowledgement state.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Connections", description: "Provider, environment, auth status, scopes, and last successful sync." },
        { title: "Sync jobs", description: "Entity, direction, status, attempts, latency, and next retry time." },
        { title: "Payload inspector", description: "Request, response, headers, normalized data, and redacted secrets." },
        { title: "Mapping", description: "Field mapping, channel category mapping, tax mapping, and payment method mapping." },
        { title: "Alerts", description: "Failed integrations, stale sync, rate limits, and webhook delivery errors." },
        { title: "Audit history", description: "Configuration changes, token rotation, retries, and manual overrides." },
      ]}
      actions={["Add integration", "Review failed jobs", "Replay queue", "Export sync log"]}
    />
  );
}
