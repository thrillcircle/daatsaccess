import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailCheck, MapPin, UserRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completePassengerOnboarding,
  getPassengerOnboardingStatus,
  requestPassengerEmailConfirmation,
  verifyPassengerEmailConfirmation,
  type OnboardingAddress,
  type PassengerOnboardingStatus,
} from "@/lib/passenger-onboarding";
import { toast } from "sonner";

export const Route = createFileRoute("/app/passenger/onboarding")({
  head: () => ({ meta: [{ title: "Finish setting up Access" }] }),
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
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressLabel, setAddressLabel] = useState<OnboardingAddress["label"]>("Home");
  const [address, setAddress] = useState<AddressPick | null>(null);

  async function loadStatus(prefill = false) {
    const current = await getPassengerOnboardingStatus();
    setSnapshot(current);
    if (prefill) {
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
    }
    return current;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await loadStatus(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load account setup");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validateBasics() {
    const name = fullName.trim();
    const nextPhone = phone.trim();
    if (name.length < 2 || name.length > 80) {
      toast.error("Enter your full name");
      return null;
    }
    if (!PHONE_RE.test(nextPhone)) {
      toast.error("Enter a valid phone number");
      return null;
    }
    if (!snapshot?.profile.email) {
      toast.error("Your account needs an email address");
      return null;
    }
    if (!address) {
      toast.error("Choose your primary address from address search");
      return null;
    }
    return { name, nextPhone };
  }

  async function saveBasics(options?: { quiet?: boolean }) {
    const basics = validateBasics();
    if (!basics || !address) return null;
    setSaving(true);
    try {
      const next = await completePassengerOnboarding({
        fullName: basics.name,
        phone: basics.nextPhone,
        savedAddressId: addressId,
        addressLabel,
        formattedAddress: address.address,
        placeId: address.placeId,
        latitude: address.lat,
        longitude: address.lng,
      });
      setSnapshot(next);
      setAddressId(next.saved_address?.id ?? addressId);
      if (!options?.quiet) toast.success("Your details are saved");
      return next;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your details");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function sendCode() {
    const saved = await saveBasics({ quiet: true });
    if (!saved) return;
    if (saved.email_confirmation.confirmed) {
      if (saved.complete) {
        toast.success("Your Access account is ready");
        navigate({ to: "/app/passenger" });
      }
      return;
    }

    setSendingCode(true);
    try {
      await requestPassengerEmailConfirmation();
      setCodeSent(true);
      setCode("");
      toast.success(`Verification code sent to ${saved.profile.email}`);
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send verification code");
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyCode() {
    const normalized = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(normalized)) {
      toast.error("Enter the 6-digit code from your email");
      return;
    }
    setVerifyingCode(true);
    try {
      await verifyPassengerEmailConfirmation(normalized);
      const next = await loadStatus();
      setCode("");
      toast.success("Email confirmed — your Access account is ready");
      if (next.complete) navigate({ to: "/app/passenger" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not confirm your email");
    } finally {
      setVerifyingCode(false);
    }
  }

  async function saveAndContinue() {
    const next = await saveBasics({ quiet: true });
    if (!next) return;
    if (!next.email_confirmation.confirmed) {
      toast.error("Confirm your email to finish setting up your account");
      return;
    }
    if (!next.complete) {
      toast.error("Finish the three setup steps before continuing");
      return;
    }
    toast.success("Your Access account is ready");
    navigate({ to: "/app/passenger" });
  }

  if (loading) {
    return (
      <AppShell title="Account setup">
        <div className="grid min-h-[55vh] place-items-center">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your account…
          </p>
        </div>
      </AppShell>
    );
  }

  const emailConfirmed = snapshot?.email_confirmation.confirmed === true;
  const confirmationMethod = snapshot?.email_confirmation.method;

  return (
    <AppShell title="Account setup">
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
            <p className="text-xs font-medium uppercase tracking-wide text-primary">3 quick steps</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {snapshot?.complete ? "Your Access account is ready" : "Finish setting up Access"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We only ask for the essentials needed to identify you and prepare a booking. Travel
              preferences, emergency contacts and notification choices can be added later in Profile.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Setup progress</span>
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
          description="Your name, mobile number and the email linked to your Access account."
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
              placeholder="Your full name"
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
          </div>
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <StepHeading
          number={2}
          icon={<MapPin className="h-4 w-4" />}
          title="Primary saved address"
          description="Save one useful address now. You can add Home, Work, family or medical addresses later."
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
          icon={<MailCheck className="h-4 w-4" />}
          title="Confirm your account"
          description="One final check confirms that the email belongs to you."
        />

        {emailConfirmed ? (
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Email confirmed</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {confirmationMethod === "oauth_google"
                  ? "Google confirmed this email for your Access sign-in."
                  : confirmationMethod === "oauth_apple"
                    ? "Apple confirmed this email for your Access sign-in."
                    : "Your Access verification code was confirmed."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We will send a 6-digit code to <strong className="text-foreground">{snapshot?.profile.email}</strong>{" "}
              from Access by DAATS. The code expires after 10 minutes.
            </p>
            <Button
              type="button"
              variant={codeSent ? "outline" : "default"}
              className="w-full"
              disabled={saving || sendingCode}
              onClick={() => void sendCode()}
            >
              {sendingCode || saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {codeSent ? "Send another code" : "Save details & send verification code"}
            </Button>

            {codeSent ? (
              <div className="rounded-xl border bg-background p-3">
                <Label htmlFor="onboarding-code">Verification code</Label>
                <Input
                  id="onboarding-code"
                  className="mt-2 text-center text-lg tracking-[0.35em]"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                />
                <Button
                  type="button"
                  className="mt-3 w-full"
                  disabled={verifyingCode || code.length !== 6}
                  onClick={() => void verifyCode()}
                >
                  {verifyingCode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirm email & finish
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {emailConfirmed ? (
        <Button
          className="mt-4 w-full"
          size="lg"
          disabled={saving}
          onClick={() => void saveAndContinue()}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {snapshot?.complete ? "Continue to Access" : "Save details & continue"}
        </Button>
      ) : null}

      <p className="mt-4 px-2 text-center text-xs text-muted-foreground">
        You can complete mobility and assistance preferences, emergency contacts and notification
        settings later from Profile. They do not block booking.
      </p>
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
