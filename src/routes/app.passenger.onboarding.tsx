import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  HeartHandshake,
  Loader2,
  MapPin,
  Shield,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  completePassengerOnboarding,
  getPassengerOnboardingStatus,
  type OnboardingAddress,
  type OnboardingPreferences,
  type PassengerOnboardingStatus,
} from "@/lib/passenger-onboarding";
import { toast } from "sonner";

export const Route = createFileRoute("/app/passenger/onboarding")({
  head: () => ({ meta: [{ title: "Complete your profile — Access" }] }),
  component: PassengerOnboardingPage,
});

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const ADDRESS_LABELS: OnboardingAddress["label"][] = [
  "Home",
  "Work",
  "Medical Facility",
  "Family",
  "Other",
];

function PassengerOnboardingPage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PassengerOnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressLabel, setAddressLabel] = useState<OnboardingAddress["label"]>("Home");
  const [address, setAddress] = useState<AddressPick | null>(null);
  const [preferredContact, setPreferredContact] =
    useState<OnboardingPreferences["preferred_contact_method"]>("in_app");
  const [wheelchairUser, setWheelchairUser] = useState(false);
  const [mobilityNotes, setMobilityNotes] = useState("");
  const [communicationNotes, setCommunicationNotes] = useState("");
  const [assistanceNotes, setAssistanceNotes] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRelationship, setEmergencyRelationship] = useState("");
  const [push, setPush] = useState(true);
  const [sms, setSms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getPassengerOnboardingStatus();
        if (cancelled) return;
        setSnapshot(current);
        setFullName(current.profile.full_name ?? "");
        setPhone(current.profile.phone ?? "");
        if (current.saved_address) {
          setAddressId(current.saved_address.id);
          setAddressLabel(current.saved_address.label);
          setAddress({
            address: current.saved_address.formatted_address,
            placeId: current.saved_address.place_id,
            lat: current.saved_address.latitude,
            lng: current.saved_address.longitude,
          });
        }
        if (current.preferences) {
          setPreferredContact(current.preferences.preferred_contact_method);
          setWheelchairUser(current.preferences.wheelchair_user);
          setMobilityNotes(current.preferences.mobility_device_notes ?? "");
          setCommunicationNotes(current.preferences.communication_support_notes ?? "");
          setAssistanceNotes(current.preferences.general_assistance_notes ?? "");
          setEmergencyName(current.preferences.emergency_contact_name ?? "");
          setEmergencyPhone(current.preferences.emergency_contact_phone ?? "");
          setEmergencyRelationship(current.preferences.emergency_contact_relationship ?? "");
        }
        if (current.notifications) {
          setPush(current.notifications.push);
          setSms(current.notifications.sms);
          setWhatsapp(current.notifications.whatsapp);
          setEmailNotifications(current.notifications.email);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load onboarding");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    const name = fullName.trim();
    const nextPhone = phone.trim();
    const emergencyContactName = emergencyName.trim();
    const emergencyContactPhone = emergencyPhone.trim();
    const relationship = emergencyRelationship.trim();

    if (name.length < 2 || name.length > 80) {
      toast.error("Enter your full name");
      return;
    }
    if (!PHONE_RE.test(nextPhone)) {
      toast.error("Enter a valid phone number");
      return;
    }
    if (!snapshot?.profile.email) {
      toast.error("Your account needs an email address before onboarding can be completed");
      return;
    }
    if (!address) {
      toast.error("Choose and save a complete address");
      return;
    }
    if (emergencyContactName.length < 2) {
      toast.error("Enter your emergency contact name");
      return;
    }
    if (!PHONE_RE.test(emergencyContactPhone)) {
      toast.error("Enter a valid emergency contact phone number");
      return;
    }
    if (relationship.length < 2) {
      toast.error("Tell us your relationship to the emergency contact");
      return;
    }

    setSaving(true);
    try {
      const next = await completePassengerOnboarding({
        fullName: name,
        phone: nextPhone,
        savedAddressId: addressId,
        addressLabel,
        formattedAddress: address.address,
        placeId: address.placeId,
        latitude: address.lat,
        longitude: address.lng,
        preferredContactMethod: preferredContact,
        wheelchairUser,
        mobilityDeviceNotes: mobilityNotes.trim() || null,
        communicationSupportNotes: communicationNotes.trim() || null,
        generalAssistanceNotes: assistanceNotes.trim() || null,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelationship: relationship,
        push,
        sms,
        whatsapp,
        email: emailNotifications,
      });
      setSnapshot(next);
      toast.success("Your Access passenger profile is ready");
      navigate({ to: "/app/passenger" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete onboarding");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Passenger setup">
        <div className="grid min-h-[55vh] place-items-center">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your profile…
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Passenger setup">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            {snapshot?.complete ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <UserRound className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {snapshot?.complete ? "Your passenger profile is complete" : "Complete your profile"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access needs these details before a new ride or service can be booked. This helps us
              know who is travelling and prepare appropriate assistance.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Onboarding progress</span>
            <span>{snapshot?.completion_percent ?? 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${snapshot?.completion_percent ?? 0}%` }}
            />
          </div>
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={1}
          icon={<UserRound className="h-4 w-4" />}
          title="Personal details"
          description="Your email comes from your Access sign-in. Google or Apple details are pre-filled where available."
        />
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-name">Full name</Label>
            <Input
              id="onboarding-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              maxLength={80}
              placeholder="Your full legal or commonly used name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-phone">Phone number</Label>
            <Input
              id="onboarding-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              inputMode="tel"
              maxLength={20}
              placeholder="+27 71 234 5678"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-email">Email address</Label>
            <Input id="onboarding-email" value={snapshot?.profile.email ?? ""} readOnly />
            <p className="text-xs text-muted-foreground">
              This is linked to your sign-in account and cannot be changed during onboarding.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={2}
          icon={<MapPin className="h-4 w-4" />}
          title="Primary saved address"
          description="Save at least one address. You can add Home, Work, family and medical-facility addresses later."
        />
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-address-label">Address label</Label>
          <select
            id="onboarding-address-label"
            value={addressLabel}
            onChange={(event) => setAddressLabel(event.target.value as OnboardingAddress["label"])}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {ADDRESS_LABELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <AddressAutocomplete
          id="onboarding-primary-address"
          label="Address"
          value={address}
          onChange={setAddress}
          placeholder="Search for your South African address"
          enableCurrentLocation
        />
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={3}
          icon={<HeartHandshake className="h-4 w-4" />}
          title="Travel & assistance preferences"
          description="Tell us what normally helps you travel comfortably. You can still specify exact requirements for each booking."
        />
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-contact-method">Preferred contact method</Label>
          <select
            id="onboarding-contact-method"
            value={preferredContact}
            onChange={(event) =>
              setPreferredContact(
                event.target.value as OnboardingPreferences["preferred_contact_method"],
              )
            }
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="in_app">In-app</option>
            <option value="phone">Phone call</option>
            <option value="email">Email</option>
          </select>
        </div>
        <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
          <Checkbox
            checked={wheelchairUser}
            onCheckedChange={(value) => setWheelchairUser(value === true)}
          />
          <span>
            <span className="font-medium">I use a wheelchair</span>
            <span className="block text-xs text-muted-foreground">
              This helps Access prepare suitable transport. Exact wheelchair and transfer details
              can still be confirmed for each trip.
            </span>
          </span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-mobility">Mobility device details (optional)</Label>
          <Textarea
            id="onboarding-mobility"
            value={mobilityNotes}
            onChange={(event) => setMobilityNotes(event.target.value)}
            rows={3}
            placeholder="Wheelchair type, walker, folding needs, dimensions or other equipment…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-communication">Communication support (optional)</Label>
          <Textarea
            id="onboarding-communication"
            value={communicationNotes}
            onChange={(event) => setCommunicationNotes(event.target.value)}
            rows={3}
            placeholder="Preferred communication approach or assistance…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-assistance">General travel assistance (optional)</Label>
          <Textarea
            id="onboarding-assistance"
            value={assistanceNotes}
            onChange={(event) => setAssistanceNotes(event.target.value)}
            rows={3}
            placeholder="Door-to-door help, boarding preferences or other useful information…"
          />
          <p className="text-xs text-muted-foreground">
            If you have no special requirements, leave these notes blank. Completing onboarding
            confirms that choice.
          </p>
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={4}
          icon={<Shield className="h-4 w-4" />}
          title="Emergency contact"
          description="Provide someone Access can contact if an urgent situation occurs during your journey."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="onboarding-emergency-name">Contact full name</Label>
            <Input
              id="onboarding-emergency-name"
              value={emergencyName}
              onChange={(event) => setEmergencyName(event.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-emergency-phone">Phone number</Label>
            <Input
              id="onboarding-emergency-phone"
              value={emergencyPhone}
              onChange={(event) => setEmergencyPhone(event.target.value)}
              inputMode="tel"
              placeholder="+27 71 234 5678"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-emergency-relationship">Relationship</Label>
            <Input
              id="onboarding-emergency-relationship"
              value={emergencyRelationship}
              onChange={(event) => setEmergencyRelationship(event.target.value)}
              placeholder="e.g. spouse, parent, sibling, caregiver"
            />
          </div>
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={5}
          icon={<BellRing className="h-4 w-4" />}
          title="Notification preferences"
          description="Choose how Access may send updates. In-app safety and operational notifications always remain available."
        />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <NotificationChoice label="Push" checked={push} onChange={setPush} />
          <NotificationChoice label="SMS" checked={sms} onChange={setSms} />
          <NotificationChoice label="WhatsApp" checked={whatsapp} onChange={setWhatsapp} />
          <NotificationChoice
            label="Email"
            checked={emailNotifications}
            onChange={setEmailNotifications}
          />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="font-semibold">Before you continue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          By completing this setup, you confirm that the contact, address and assistance information
          above is current. You can update it later from Profile.
        </p>
        <Button className="mt-4 w-full" size="lg" disabled={saving} onClick={() => void submit()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {snapshot?.complete ? "Save profile & continue" : "Complete onboarding & continue"}
        </Button>
      </section>
    </AppShell>
  );
}

function StepHeading({
  number,
  icon,
  title,
  description,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="font-semibold">{title}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function NotificationChoice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border p-3">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}
