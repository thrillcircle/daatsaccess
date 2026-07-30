from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    file.write_text(text.replace(old, new))


replace(
    "src/components/profile/DriverProfileSections.tsx",
    'import { useEffect, useMemo, useState } from "react";',
    'import { useEffect, useMemo, useState, type ReactNode } from "react";',
)
replace(
    "src/components/profile/DriverProfileSections.tsx",
    "icon?: React.ReactNode",
    "icon?: ReactNode",
)
replace(
    "src/components/NotificationBell.tsx",
    'import { useEffect, useState } from "react";',
    'import { useEffect, useState, type ReactNode } from "react";',
)
replace(
    "src/components/NotificationBell.tsx",
    "let destination: React.ReactNode",
    "let destination: ReactNode",
)
replace(
    "src/routes/app.admin.passengers.tsx",
    'import { Activity, CalendarRange, Loader2, Phone, Search, UserCircle2 } from "lucide-react";',
    'import { Activity, Loader2, Phone, Search, UserCircle2 } from "lucide-react";',
)
replace(
    "src/routes/app.admin.passengers.tsx",
    'import { Button } from "@/components/ui/button";\n',
    "",
)

client_files = [
    "src/components/AddressAutocomplete.tsx",
    "src/components/profile/PassengerProfileSections.tsx",
    "src/routes/app.admin.passengers.tsx",
    "src/routes/app.admin.passengers.$passengerId.tsx",
    "src/routes/app.admin.support.tsx",
    "src/routes/app.admin.support.$ticketId.tsx",
    "src/routes/app.support.tsx",
    "src/routes/app.support.$ticketId.tsx",
]

for filename in client_files:
    path = Path(filename)
    text = path.read_text()
    if "SupabaseClient" not in text:
        text = text.replace(
            'import { supabase } from "@/integrations/supabase/client";',
            'import { supabase } from "@/integrations/supabase/client";\n'
            'import type { SupabaseClient } from "@supabase/supabase-js";',
        )
    text = text.replace(
        "const db = supabase as any;",
        "const db = supabase as unknown as SupabaseClient;",
    )
    text = text.replace(
        "const profileDb = supabase as any;",
        "const profileDb = supabase as unknown as SupabaseClient;",
    )
    path.write_text(text)

replace(
    "src/components/AddressAutocomplete.tsx",
    "function useSavedAddress(",
    "function selectSavedAddress(",
)
replace(
    "src/components/AddressAutocomplete.tsx",
    "onClick={() => useSavedAddress(address)}",
    "onClick={() => selectSavedAddress(address)}",
)
