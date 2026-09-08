-- DAATS fleet master records.
--
-- Vehicles are authoritative records in vehicle_profiles. Drivers are NOT seeded or
-- permanently owned by a vehicle here. Operational driver/vehicle relationships remain
-- separate and time-bound through vehicle_driver_assignments, driver_vehicle_shifts,
-- ride assignments and service-booking assignments.
--
-- Compliance dates below are deliberately kept in the baseline admin note because they
-- are dates shown on historical uploaded registration documents. They must not be treated
-- as the current legal licence/roadworthy state unless a current document is uploaded.

COMMENT ON COLUMN public.vehicle_profiles.assigned_driver_id IS
  'Legacy compatibility mirror for an effective assignment; not permanent vehicle ownership. Authoritative driver/vehicle relationships are time-bound assignment records.';

WITH seed AS (
  SELECT *
  FROM (
    VALUES
      (
        'JL 28 WV GP'::text,
        'Ford Tourneo · JL 28 WV GP'::text,
        'Wheelchair-accessible passenger van'::text,
        'Ford'::text,
        'Tourneo'::text,
        2014::integer,
        'WF03XXTTG3DE34671'::text,
        3::integer,
        2::integer,
        42511.5::numeric,
        E'DAATS fleet baseline — 2026-09-02\nColour: Silver\nTransmission: 6-speed manual\nFuel: Diesel\nSeating: 3 passenger seats + 1 driver seat\nWheelchair spaces: 2\nWheelchair access: Rear wheelchair ramp\nVehicle register number: TTK609W\nVIN: WF03XXTTG3DE34671\nEngine number: DE34671\nRegistration category: Light passenger motor vehicle (less than 12 persons)\nRegistration description: Station wagon\nTare: 2185 kg\nRegistering authority: Ekurhuleni\nRoadworthy test date shown on uploaded document: 2023-08-08 (historical document field)\nRegistration document licence expiry shown: 2024-07-31 (historical uploaded document; not current licence status)\nOdometer snapshot: 42,511.5 km at 2026-09-02 12:08:28'::text
      ),
      (
        'JY 61 SX GP'::text,
        'Ford Tourneo · JY 61 SX GP'::text,
        'Wheelchair-accessible passenger van'::text,
        'Ford'::text,
        'Tourneo'::text,
        2015::integer,
        'WF03XXTTG3ER02027'::text,
        3::integer,
        2::integer,
        155195.4::numeric,
        E'DAATS fleet baseline — 2026-09-02\nColour: Pearl white and black\nTransmission: 6-speed manual\nFuel: Diesel\nSeating: 3 passenger seats + 1 driver seat\nWheelchair spaces: 2\nWheelchair access: Rear wheelchair ramp\nVehicle register number: VSH051W\nVIN: WF03XXTTG3ER02027\nEngine number: ER02027\nRegistration category: Light passenger motor vehicle (less than 12 persons)\nRegistration description: Station wagon\nTare: 2024 kg\nRegistering authority: Pretoria\nRoadworthy test date shown on uploaded document: 2021-04-09 (historical document field)\nRegistration document licence expiry shown: 2022-03-31 (historical uploaded document; not current licence status)\nOdometer snapshot: 155,195.4 km at 2026-09-02 11:31:37'::text
      ),
      (
        'KT 71 FY GP'::text,
        'Ford Tourneo · KT 71 FY GP'::text,
        'Wheelchair-accessible passenger van'::text,
        'Ford'::text,
        'Tourneo'::text,
        2017::integer,
        'WF03XXTTG3GS18878'::text,
        3::integer,
        2::integer,
        222824.4::numeric,
        E'DAATS fleet baseline — 2026-09-02\nColour: White\nTransmission: 6-speed manual\nFuel: Diesel\nSeating: 3 passenger seats + 1 driver seat\nWheelchair spaces: 2\nWheelchair access: Rear wheelchair ramp\nVehicle register number: XRY805W\nVIN: WF03XXTTG3GS18878\nEngine number: GS18878\nRegistration category: Light passenger motor vehicle (less than 12 persons)\nRegistration description: Station wagon\nTare: 2061 kg\nRegistering authority: Ekurhuleni\nRoadworthy test date shown on uploaded document: 2023-08-08 (historical document field)\nRegistration document licence expiry shown: 2024-07-31 (historical uploaded document; not current licence status)\nOdometer snapshot: 222,824.4 km at 2026-09-02 11:42:05'::text
      ),
      (
        'FN 34 DH GP'::text,
        'Nissan NV350 · FN 34 DH GP'::text,
        'Wheelchair-accessible passenger van'::text,
        'Nissan'::text,
        'NV350'::text,
        2016::integer,
        'JN1UB4E26Z0008512'::text,
        5::integer,
        2::integer,
        118657.4::numeric,
        E'DAATS fleet baseline — 2026-09-02\nColour: White\nTransmission: 5-speed manual\nFuel: Petrol\nSeating: 5 passenger seats + 1 driver seat\nWheelchair spaces: 2\nWheelchair access: Rear wheelchair ramp\nVehicle register number: XJT017W\nVIN: JN1UB4E26Z0008512\nEngine number: QR256418540\nRegistration category: Heavy passenger motor vehicle (12 or more persons)\nRegistration description: Combi/Micro/Minibus\nTare: 2059 kg\nRegistering authority: Ekurhuleni\nRoadworthy test date shown on uploaded document: 2024-05-27 (historical document field)\nRegistration document licence expiry shown: 2026-05-31 (historical uploaded document; not current licence status)\nUploaded document roadworthy note: CRW required (historical document note; not a statement of current roadworthiness)\nOdometer snapshot: 118,657.4 km at 2026-09-02 12:11:40'::text
      )
  ) AS values_table(
    license_plate,
    vehicle_name,
    vehicle_type,
    make,
    model,
    year,
    vin_number,
    passenger_capacity,
    wheelchair_capacity,
    odometer_km,
    baseline_note
  )
), updated AS (
  UPDATE public.vehicle_profiles AS vehicle
  SET
    vehicle_name = seed.vehicle_name,
    vehicle_type = seed.vehicle_type,
    make = seed.make,
    model = seed.model,
    year = seed.year,
    license_plate = seed.license_plate,
    vin_number = seed.vin_number,
    wheelchair_accessible = true,
    ramp_or_lift_available = true,
    passenger_capacity = seed.passenger_capacity,
    wheelchair_capacity = seed.wheelchair_capacity,
    accessibility_features = CASE
      WHEN COALESCE(vehicle.accessibility_features, '[]'::jsonb) @> '["Rear wheelchair ramp"]'::jsonb
        THEN COALESCE(vehicle.accessibility_features, '[]'::jsonb)
      ELSE COALESCE(vehicle.accessibility_features, '[]'::jsonb) || '["Rear wheelchair ramp"]'::jsonb
    END,
    -- Never roll back a newer operational reading if the migration is replayed later.
    current_odometer_km = GREATEST(vehicle.current_odometer_km, seed.odometer_km),
    admin_notes = CASE
      WHEN position('DAATS fleet baseline — 2026-09-02' in COALESCE(vehicle.admin_notes, '')) > 0
        THEN vehicle.admin_notes
      WHEN NULLIF(trim(COALESCE(vehicle.admin_notes, '')), '') IS NULL
        THEN seed.baseline_note
      ELSE vehicle.admin_notes || E'\n\n' || seed.baseline_note
    END
  FROM seed
  WHERE public.normalize_vehicle_registration(vehicle.license_plate)
      = public.normalize_vehicle_registration(seed.license_plate)
  RETURNING vehicle.id
)
INSERT INTO public.vehicle_profiles (
  vehicle_name,
  vehicle_type,
  make,
  model,
  year,
  license_plate,
  vin_number,
  wheelchair_accessible,
  ramp_or_lift_available,
  passenger_capacity,
  wheelchair_capacity,
  accessibility_features,
  current_odometer_km,
  admin_notes,
  status,
  legacy_consolidation_status
)
SELECT
  seed.vehicle_name,
  seed.vehicle_type,
  seed.make,
  seed.model,
  seed.year,
  seed.license_plate,
  seed.vin_number,
  true,
  true,
  seed.passenger_capacity,
  seed.wheelchair_capacity,
  '["Rear wheelchair ramp"]'::jsonb,
  seed.odometer_km,
  seed.baseline_note,
  'active',
  'canonical'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vehicle_profiles AS existing
  WHERE public.normalize_vehicle_registration(existing.license_plate)
      = public.normalize_vehicle_registration(seed.license_plate)
);

-- Deliberately no inserts into driver_profiles, vehicle_driver_assignments,
-- driver_vehicle_shifts or ride assignments. Admin assigns a driver only when
-- an operational task/shift/trip requires one.

NOTIFY pgrst, 'reload schema';
