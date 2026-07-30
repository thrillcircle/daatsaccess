import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function readEnvValue(name: string): string {
  const env = readFileSync(".env", "utf8");
  const match = env.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
  if (!match?.[1]) throw new Error(`${name} is missing from .env`);
  return match[1];
}

describe("published Lovable Cloud Phase 2 schema", () => {
  it("exposes the required Phase 1 and Phase 2 resources", async () => {
    const url = readEnvValue("VITE_SUPABASE_URL");
    const key = readEnvValue("VITE_SUPABASE_PUBLISHABLE_KEY");
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Accept: "application/openapi+json",
      },
    });

    expect(response.status, await response.text()).toBe(200);
    const spec = (await response.json()) as {
      paths?: Record<string, unknown>;
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };
    const paths = spec.paths ?? {};
    const definitions = spec.definitions ?? spec.components?.schemas ?? {};

    const tables = [
      "service_pricing_rules",
      "passenger_saved_addresses",
      "passenger_preferences",
      "support_tickets",
      "support_messages",
      "support_ticket_events",
      "vehicle_profiles",
      "fleet_vehicles",
      "driver_profiles",
    ];
    for (const table of tables) {
      expect(Boolean(paths[`/${table}`] || definitions[table]), `missing table ${table}`).toBe(
        true,
      );
    }

    for (const rpc of [
      "support_create_ticket",
      "support_add_message",
      "support_admin_update_ticket",
    ]) {
      expect(Boolean(paths[`/rpc/${rpc}`]), `missing RPC ${rpc}`).toBe(true);
    }

    expect(
      Boolean(definitions.notifications?.properties?.support_ticket_id),
      "missing notifications.support_ticket_id",
    ).toBe(true);
  }, 20_000);
});
