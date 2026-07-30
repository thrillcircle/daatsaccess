export type PricingServiceCode =
  | "ride"
  | "transport"
  | "assisted"
  | "appointment"
  | "extended_journey";

export type PricingCalculationType =
  | "flat"
  | "per_km"
  | "per_minute"
  | "per_hour"
  | "per_day"
  | "percentage";

export type PricingInputs = {
  distance_km?: number;
  transport_minutes?: number;
  companion_hours?: number;
  waiting_hours?: number;
  specialist_vehicle_required?: boolean;
  journey_days?: number;
  driver_overnights?: number;
  companion_days?: number;
  [key: string]: number | boolean | undefined;
};

export type PricingComponentDefinition = {
  id?: string;
  component_code: string;
  customer_label: string;
  calculation_type: PricingCalculationType;
  amount: number;
  minimum_quantity?: number;
  maximum_quantity?: number | null;
  calculation_order: number;
  customer_visible: boolean;
  is_active: boolean;
};

export type PricingLine = {
  componentId?: string;
  componentCode: string;
  label: string;
  calculationType: PricingCalculationType;
  quantity: number;
  unit: "unit" | "km" | "minute" | "hour" | "day" | "percent";
  unitPrice: number;
  lineSubtotal: number;
  adjustment: number;
  lineTotal: number;
  customerVisible: boolean;
  calculationOrder: number;
};

export type PricingCalculation = {
  serviceCode: PricingServiceCode;
  currency: "ZAR";
  warnings: string[];
  lines: PricingLine[];
  subtotal: number;
  marginAmount: number;
  adjustmentsTotal: number;
  total: number;
};

export function roundZAR(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("Monetary amount must be finite");
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function safeNumber(value: number | boolean | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function quantityFor(component: PricingComponentDefinition, inputs: PricingInputs): number {
  const minimum = Math.max(0, component.minimum_quantity ?? 0);
  let quantity: number;

  switch (component.component_code) {
    case "base_fare":
      quantity = 1;
      break;
    case "distance":
      quantity = safeNumber(inputs.distance_km);
      break;
    case "transport_minutes":
      quantity = safeNumber(inputs.transport_minutes);
      break;
    case "companion_hours":
      quantity = Math.max(minimum, safeNumber(inputs.companion_hours));
      break;
    case "waiting_hours":
      quantity = Math.max(minimum, safeNumber(inputs.waiting_hours));
      break;
    case "specialist_vehicle":
      quantity = inputs.specialist_vehicle_required ? 1 : 0;
      break;
    case "vehicle_days":
    case "driver_days":
      quantity = Math.max(minimum, safeNumber(inputs.journey_days));
      break;
    case "driver_overnights":
      quantity = Math.max(minimum, safeNumber(inputs.driver_overnights));
      break;
    case "companion_days":
      quantity = Math.max(minimum, safeNumber(inputs.companion_days));
      break;
    default:
      quantity = Math.max(minimum, safeNumber(inputs[component.component_code]));
  }

  if (component.maximum_quantity != null) {
    quantity = Math.min(quantity, component.maximum_quantity);
  }
  return quantity;
}

function unitFor(type: PricingCalculationType): PricingLine["unit"] {
  switch (type) {
    case "per_km":
      return "km";
    case "per_minute":
      return "minute";
    case "per_hour":
      return "hour";
    case "per_day":
      return "day";
    case "percentage":
      return "percent";
    default:
      return "unit";
  }
}

export function requiredPricingWarnings(
  serviceCode: PricingServiceCode,
  inputs: PricingInputs,
): string[] {
  const warnings: string[] = [];
  if (inputs.distance_km == null) warnings.push("Route distance is required");
  if ((serviceCode === "assisted" || serviceCode === "appointment") && inputs.companion_hours == null) {
    warnings.push("Companion hours are required");
  }
  if (serviceCode === "appointment" && inputs.waiting_hours == null) {
    warnings.push("Waiting duration is required");
  }
  if (serviceCode === "extended_journey" && inputs.journey_days == null) {
    warnings.push("Number of journey days is required");
  }
  return warnings;
}

export function calculatePricing(
  serviceCode: PricingServiceCode,
  components: PricingComponentDefinition[],
  inputs: PricingInputs,
): PricingCalculation {
  const lines: PricingLine[] = [];
  let runningTotal = 0;
  let marginAmount = 0;

  for (const component of [...components]
    .filter((item) => item.is_active)
    .sort((a, b) => a.calculation_order - b.calculation_order || a.component_code.localeCompare(b.component_code))) {
    const quantity = quantityFor(component, inputs);
    const lineSubtotal =
      component.calculation_type === "percentage"
        ? roundZAR((runningTotal * component.amount) / 100)
        : roundZAR(component.amount * quantity);

    if (component.calculation_type === "percentage") marginAmount = roundZAR(marginAmount + lineSubtotal);
    runningTotal = roundZAR(runningTotal + lineSubtotal);

    lines.push({
      componentId: component.id,
      componentCode: component.component_code,
      label: component.customer_label,
      calculationType: component.calculation_type,
      quantity,
      unit: unitFor(component.calculation_type),
      unitPrice: component.amount,
      lineSubtotal,
      adjustment: 0,
      lineTotal: lineSubtotal,
      customerVisible: component.customer_visible,
      calculationOrder: component.calculation_order,
    });
  }

  return {
    serviceCode,
    currency: "ZAR",
    warnings: requiredPricingWarnings(serviceCode, inputs),
    lines,
    subtotal: roundZAR(runningTotal - marginAmount),
    marginAmount,
    adjustmentsTotal: 0,
    total: roundZAR(runningTotal),
  };
}

export const CONFIRMED_RIDE_COMPONENTS: PricingComponentDefinition[] = [
  {
    component_code: "base_fare",
    customer_label: "Base fare",
    calculation_type: "flat",
    amount: 20,
    minimum_quantity: 1,
    calculation_order: 10,
    customer_visible: true,
    is_active: true,
  },
  {
    component_code: "distance",
    customer_label: "Distance",
    calculation_type: "per_km",
    amount: 13.5,
    minimum_quantity: 0,
    calculation_order: 20,
    customer_visible: true,
    is_active: true,
  },
];
