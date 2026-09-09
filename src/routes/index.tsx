import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartHandshake,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  Accessibility as Wheelchair,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PublicTripEstimator } from "@/components/PublicTripEstimator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DAATS Access — Wheelchair-Accessible Transport" },
      {
        name: "description",
        content:
          "Book safe, reliable wheelchair-accessible transport with DAATS Access for medical appointments, everyday journeys, events, RAF and Medical Aid transport.",
      },
      { property: "og:title", content: "DAATS Access — Accessible Transport Made Simple" },
      {
        property: "og:description",
        content: "Wheelchair-accessible transport designed around you.",
      },
      { property: "og:url", content: "https://daats-access.lovable.app/" },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "https://daats-access.lovable.app/home/johannesburg-mobility.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content: "https://daats-access.lovable.app/home/johannesburg-mobility.webp",
      },
    ],
    links: [{ rel: "canonical", href: "https://daats-access.lovable.app/" }],
  }),
  component: Landing,
});

const slides = [
  [
    "/home/johannesburg-mobility.webp",
    "A DAATS team member helping a wheelchair passenger board an accessible vehicle in Johannesburg",
    "ACCESSIBLE TRANSPORT • PEOPLE FIRST",
    "Accessible transport designed around you.",
    "Safe, reliable wheelchair-accessible transport for medical appointments, everyday travel, events and more.",
  ],
  [
    "/home/professional-assistance.webp",
    "Professional DAATS boarding assistance for a wheelchair passenger",
    "SAFE BOARDING • CARING ASSISTANCE",
    "Support from pickup to destination.",
    "A trained team, the right accessible vehicle and thoughtful help throughout your journey.",
  ],
  [
    "/home/accessible-destination.webp",
    "A wheelchair passenger arriving at an accessible destination with DAATS",
    "CARE • MOBILITY • INDEPENDENCE",
    "More freedom for every journey.",
    "Book transport built around your mobility needs, companion requirements and destination.",
  ],
  [
    "/home/group-transport.webp",
    "DAATS assisting several wheelchair passengers with accessible community transport",
    "GROUPS • ORGANISATIONS • EVENTS",
    "Accessible mobility for communities.",
    "Coordinated wheelchair-accessible transport for organisations, programmes, facilities and events.",
  ],
  [
    "/home/care-essentials.webp",
    "A wheelchair passenger, caregiver and DAATS team member beside an accessible vehicle",
    "PASSENGERS • FAMILIES • CARERS",
    "People-first service, every time.",
    "Clear communication and practical assistance for passengers and the people who support them.",
  ],
  [
    "/home/journey-support.webp",
    "A DAATS team member helping a powered-wheelchair passenger use a rear vehicle ramp",
    "PURPOSE-BUILT ACCESS",
    "The right vehicle for your mobility.",
    "Rear-ramp accessible vehicles with space for wheelchairs, companions and the journeys that matter.",
  ],
  [
    "/home/rehabilitation-arrival.webp",
    "DAATS helping a wheelchair passenger arrive at a rehabilitation centre",
    "MEDICAL • REHABILITATION • THERAPY",
    "Dependable transport for your care.",
    "Travel to hospitals, rehabilitation centres, appointments and therapy with confidence.",
  ],
  [
    "/home/community-mobility.webp",
    "Wheelchair passengers using DAATS accessible community transport",
    "CONNECTED COMMUNITIES",
    "Travel that keeps life moving.",
    "From family visits and shopping to work, programmes and social occasions.",
  ],
  [
    "/home/family-support.webp",
    "A family and DAATS team member assisting a wheelchair passenger",
    "COMPANIONS WELCOME",
    "Your support network travels too.",
    "We plan for carers and companions so everyone knows what to expect on the day.",
  ],
  [
    "/home/cape-town-access.webp",
    "DAATS accessible transport supporting a wheelchair passenger on a longer journey",
    "LOCAL • REGIONAL • LONG DISTANCE",
    "Accessible journeys, near and far.",
    "Tell us where you need to go and our team will help coordinate the right journey.",
  ],
] as const;

const services = [
  [
    Wheelchair,
    "Everyday Accessible Transport",
    "Travel to work, shopping, family visits, social occasions and other daily destinations.",
    "/home/community-mobility.webp",
  ],
  [
    Stethoscope,
    "Medical & Rehabilitation",
    "Transport to hospitals, doctors, therapy, assessments and rehabilitation centres.",
    "/home/rehabilitation-arrival.webp",
  ],
  [
    ShieldCheck,
    "RAF & Medical Aid Support",
    "Help with transport quotations, bookings and administration for authorised journeys.",
    "/home/professional-assistance.webp",
  ],
  [
    Users,
    "Groups & Organisations",
    "Coordinated transport for facilities, NGOs, community programmes, businesses and events.",
    "/home/group-transport.webp",
  ],
] as const;

const steps = [
  ["01", "Book", "Share the route, date and accessibility details."],
  ["02", "We coordinate", "Our team reviews and prepares the right trip."],
  ["03", "Driver arrives", "Track important updates as pickup approaches."],
  ["04", "Safe boarding", "Your driver assists with the vehicle and secure boarding."],
  ["05", "Travel", "Ride comfortably with your carer or companion where required."],
  ["06", "Destination support", "Receive practical assistance when you arrive."],
] as const;

const navItems = [
  ["Services", "#services"],
  ["How it works", "#how-it-works"],
  ["Fleet", "#fleet"],
  ["RAF & Medical Aid", "#funded-transport"],
  ["Organisations", "#organisations"],
  ["Support", "#contact"],
] as const;

function Landing() {
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => mounted && setIsAuthenticated(Boolean(data.session)))
      .catch((error: unknown) => console.error("Could not restore the homepage session", error));
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => mounted && setIsAuthenticated(Boolean(session)),
    );
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(
      () => setSlide((current) => (current + 1) % slides.length),
      5000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const openAccess = () => navigate({ to: isAuthenticated ? "/app" : "/auth" });
  const signIn = () =>
    isAuthenticated
      ? navigate({ to: "/app" })
      : navigate({ to: "/auth", search: { mode: "signin" } as never });
  const supportUrl =
    "https://wa.me/27677449729?text=Hello%20DAATS%20Access%2C%20I%20need%20help%20with%20accessible%20transport.";
  const active = slides[slide];

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" aria-label="DAATS Access home">
            <img src="/access-logo.png" alt="DAATS Access" className="h-11 w-auto" />
          </a>
          <nav
            className="hidden items-center gap-7 text-sm font-bold text-slate-700 lg:flex"
            aria-label="Main navigation"
          >
            {navItems.map(([label, href]) => (
              <a key={href} className="hover:text-blue-700" href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <button
              type="button"
              onClick={signIn}
              className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-extrabold hover:border-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {isAuthenticated ? "Open Access" : "Sign In"}
            </button>
            <button
              type="button"
              onClick={openAccess}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 text-sm font-extrabold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Book a Trip <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200 px-4 py-5 lg:hidden">
            <nav className="mx-auto grid max-w-7xl gap-1 font-bold" aria-label="Mobile navigation">
              {navItems.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-3 hover:bg-slate-50"
                >
                  {label}
                </a>
              ))}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={signIn}
                  className="min-h-12 rounded-xl border border-slate-300 font-extrabold"
                >
                  {isAuthenticated ? "Open Access" : "Sign In"}
                </button>
                <button
                  type="button"
                  onClick={openAccess}
                  className="min-h-12 rounded-xl bg-blue-700 font-extrabold text-white"
                >
                  Book Trip
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main id="top">
        <section
          className="relative isolate overflow-hidden bg-slate-950"
          aria-roledescription="carousel"
          aria-label="DAATS Access services"
        >
          <div className="relative min-h-[640px] sm:min-h-[680px] lg:min-h-[700px]">
            {slides.map(([image, alt], index) => (
              <img
                key={image}
                src={image}
                alt={index === slide ? alt : ""}
                aria-hidden={index !== slide}
                fetchPriority={index === 0 ? "high" : "auto"}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${index === slide ? "opacity-100" : "opacity-0"}`}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/68 to-slate-950/20" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
            <div className="relative mx-auto flex min-h-[640px] max-w-7xl items-center px-4 pb-24 pt-12 sm:min-h-[680px] sm:px-6 lg:min-h-[700px] lg:px-8">
              <div className="max-w-3xl text-white" aria-live="polite">
                <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.24em] text-blue-200 sm:text-sm">
                  {active[2]}
                </p>
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                  {active[3]}
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-100 sm:text-xl">
                  {active[4]}
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={openAccess}
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 font-extrabold text-white shadow-lg hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Book a Trip <ArrowRight className="h-5 w-5" />
                  </button>
                  <a
                    href={supportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/60 bg-white/10 px-6 font-extrabold text-white backdrop-blur hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <MessageCircle className="h-5 w-5" /> Talk to Access Support
                  </a>
                </div>
                <div className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm font-bold">
                  <span className="inline-flex items-center gap-2">
                    <Wheelchair className="h-5 w-5 text-blue-300" /> Wheelchair accessible
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-blue-300" /> Professional assistance
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-300" /> Gauteng-based service
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSlide((slide - 1 + slides.length) % slides.length)}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-950/40 text-white backdrop-blur hover:bg-slate-950/65"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setSlide((slide + 1) % slides.length)}
              aria-label="Next image"
              className="absolute right-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-950/40 text-white backdrop-blur hover:bg-slate-950/65"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <div
              className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 gap-2"
              aria-label="Choose hero image"
            >
              {slides.map(([image], index) => (
                <button
                  type="button"
                  key={image}
                  onClick={() => setSlide(index)}
                  aria-label={`Show image ${index + 1} of ${slides.length}`}
                  aria-current={index === slide ? "true" : undefined}
                  className={`h-2.5 rounded-full transition-all ${index === slide ? "w-8 bg-white" : "w-2.5 bg-white/50 hover:bg-white/80"}`}
                />
              ))}
            </div>
          </div>
        </section>

        <section
          className="relative z-20 bg-slate-50 px-4 sm:px-6 lg:px-8"
          aria-label="Start a booking"
        >
          <div className="mx-auto max-w-7xl -translate-y-8 sm:-translate-y-10">
            <PublicTripEstimator isAuthenticated={isAuthenticated} />
          </div>
        </section>

        <section
          id="services"
          className="scroll-mt-24 bg-slate-50 pb-20 pt-8 sm:pt-10 lg:pb-28 lg:pt-12"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                Our services
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                What do you need today?
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Choose the support that fits your journey. Access keeps booking simple while our
                team coordinates the details.
              </p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {services.map(([Icon, title, description, image]) => (
                <article
                  key={title}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="relative h-44 overflow-hidden">
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 to-transparent" />
                  </div>
                  <div className="p-6">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-700">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-5 text-xl font-black text-blue-950">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
                    <button
                      type="button"
                      onClick={openAccess}
                      className="mt-5 inline-flex items-center gap-2 font-extrabold text-blue-700 hover:text-blue-900"
                    >
                      Start booking <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                How Access works
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                From booking to destination support.
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                A clear six-step journey with DAATS supporting the trip behind the scenes.
              </p>
            </div>
            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map(([number, title, text]) => (
                <li key={number} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <span className="text-4xl font-black text-blue-200">{number}</span>
                  <h3 className="mt-4 text-xl font-black text-blue-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="fleet" className="scroll-mt-24 bg-blue-950 py-20 text-white lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:px-8">
            <div className="relative min-h-[420px] overflow-hidden rounded-3xl shadow-2xl">
              <img
                src="/home/journey-support.webp"
                alt="A DAATS accessible vehicle with its rear ramp ready for boarding"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />
              <div className="absolute bottom-0 p-7 sm:p-10">
                <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-200">
                  Our accessible fleet
                </p>
                <h2 className="mt-3 text-3xl font-black sm:text-5xl">
                  Built for safe, dignified boarding.
                </h2>
              </div>
            </div>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-300">
                More than a ride
              </p>
              <h3 className="mt-3 text-3xl font-black sm:text-4xl">
                The right space and support for every passenger.
              </h3>
              <p className="mt-5 text-lg leading-8 text-blue-100">
                Our rear-ramp accessible vehicles support manual and powered wheelchairs, carers,
                companions and multiple-wheelchair journeys.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {[
                  "Rear ramps and lifts",
                  "Secure wheelchair spaces",
                  "Carer and companion travel",
                  "Multiple-wheelchair capacity",
                  "Door-to-door assistance",
                  "Professional drivers",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4"
                  >
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-300" />
                    <span className="font-bold">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-20 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                Client care & support
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-blue-950 sm:text-5xl">
                Real people helping you plan the journey.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Accessibility needs are personal. Our team helps passengers, families and carers
                plan vehicle access, companion travel, timing and destination support.
              </p>
              <div className="mt-7 space-y-4">
                {[
                  "Help before you book",
                  "Clear booking and trip updates",
                  "Support for carers and family members",
                  "Assistance when plans need attention",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 font-bold text-slate-800">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-blue-700">
                      <Check className="h-4 w-4" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
              <a
                href={supportUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-8 inline-flex min-h-13 items-center gap-2 rounded-xl bg-blue-700 px-6 font-extrabold text-white hover:bg-blue-800"
              >
                <MessageCircle className="h-5 w-5" /> Talk to Access Support
              </a>
            </div>
            <div className="relative min-h-[440px] overflow-hidden rounded-3xl">
              <img
                src="/home/family-support.webp"
                alt="A family receiving assistance from the DAATS Access team"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-x-5 bottom-5 rounded-2xl bg-white/95 p-5 shadow-xl backdrop-blur">
                <div className="flex gap-4">
                  <HeartHandshake className="h-8 w-8 shrink-0 text-blue-700" />
                  <div>
                    <p className="font-black text-blue-950">Care that travels with you.</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Tell us what will make your journey safer and more comfortable.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="funded-transport" className="scroll-mt-24 bg-blue-50 py-20 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                RAF & Medical Aid support
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-blue-950 sm:text-5xl">
                Help with authorised accessible transport.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-700">
                DAATS assists qualifying clients with transport quotations, bookings and supporting
                administration where RAF or Medical Aid authorisation applies. Approval and benefits
                remain subject to the relevant funder or scheme.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={openAccess}
                  className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 font-extrabold text-white hover:bg-blue-800"
                >
                  Request Transport <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="mailto:info@daats.co.za?subject=RAF%20or%20Medical%20Aid%20Transport%20Enquiry"
                  className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl border border-blue-300 bg-white px-6 font-extrabold text-blue-900 hover:border-blue-600"
                >
                  <Mail className="h-4 w-4" /> Contact Our Team
                </a>
              </div>
            </div>
            <div className="overflow-hidden rounded-3xl bg-white shadow-xl">
              <img
                src="/home/care-essentials.webp"
                alt="DAATS client care supporting a passenger and caregiver"
                loading="lazy"
                className="aspect-[16/9] w-full object-cover"
              />
              <div className="p-7 sm:p-9">
                <ShieldCheck className="h-10 w-10 text-blue-700" />
                <h3 className="mt-4 text-2xl font-black text-blue-950">
                  Support that connects the journey.
                </h3>
                <div className="mt-5 grid gap-3">
                  {[
                    "Accessible transport quotations",
                    "Booking and trip coordination",
                    "Administration for authorised trips",
                    "Clear passenger communication",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 font-semibold text-slate-700"
                    >
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-700" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="organisations" className="scroll-mt-24 bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                  Organisations & group transport
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                  Coordinated access for more people.
                </h2>
                <p className="mt-5 text-lg leading-8 text-slate-600">
                  We support hospitals, rehabilitation centres, NGOs, community programmes,
                  businesses, institutions and events that need dependable wheelchair-accessible
                  transport.
                </p>
                <a
                  href="mailto:info@daats.co.za?subject=Organisation%20Accessible%20Transport%20Enquiry"
                  className="mt-8 inline-flex min-h-13 items-center gap-2 rounded-xl bg-blue-700 px-6 font-extrabold text-white hover:bg-blue-800"
                >
                  <Building2 className="h-5 w-5" /> Request an Organisation Quote
                </a>
              </div>
              <img
                src="/home/group-transport.webp"
                alt="DAATS coordinating accessible transport for a group of wheelchair passengers"
                loading="lazy"
                className="aspect-[16/9] w-full rounded-3xl object-cover shadow-xl"
              />
            </div>
          </div>
        </section>

        <section className="bg-slate-950 py-20 text-white lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-300">
                Service areas
              </p>
              <h2 className="mt-3 text-3xl font-black sm:text-5xl">
                Based in Gauteng. Ready for planned journeys.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">
                DAATS Access operates from Birch Acres, Kempton Park, serving transport needs across
                Gauteng. Regional and long-distance journeys can be discussed and planned with our
                team.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                {[
                  "Kempton Park",
                  "Johannesburg",
                  "Pretoria",
                  "Ekurhuleni",
                  "Gauteng",
                  "Planned long-distance trips",
                ].map((area) => (
                  <span
                    key={area}
                    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-300">
                Safety & trust
              </p>
              <h2 className="mt-3 text-3xl font-black sm:text-5xl">
                Accessibility is the service.
              </h2>
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {(
                  [
                    [
                      ShieldCheck,
                      "Appropriate vehicles",
                      "Accessible vehicles selected for the journey.",
                    ],
                    [
                      Users,
                      "Passenger-centred care",
                      "Support for passengers, carers and companions.",
                    ],
                    [
                      Clock3,
                      "Clear coordination",
                      "Booking details and trip updates in one place.",
                    ],
                    [
                      Sparkles,
                      "Dignified assistance",
                      "Respectful help with boarding and arrival.",
                    ],
                  ] as const
                ).map(([Icon, title, text]) => (
                  <div key={title} className="rounded-2xl border border-white/15 bg-white/5 p-5">
                    <Icon className="h-7 w-7 text-blue-300" />
                    <h3 className="mt-4 font-black">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="relative isolate overflow-hidden py-20 text-white lg:py-28">
          <img
            src="/home/accessible-destination.webp"
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-20 h-full w-full object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-blue-950/88" />
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <MapPin className="mx-auto h-11 w-11 text-blue-300" />
            <h2 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">
              Where would you like to go?
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-blue-100">
              Tell us about your journey and accessibility needs. Book in Access or speak directly
              with our support team.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={openAccess}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white px-7 font-extrabold text-blue-900 hover:bg-blue-50"
              >
                Book a Trip <ArrowRight className="h-5 w-5" />
              </button>
              <a
                href={supportUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/60 bg-white/10 px-7 font-extrabold text-white hover:bg-white/20"
              >
                <MessageCircle className="h-5 w-5" /> Talk to Access Support
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer id="contact" className="scroll-mt-24 bg-white pb-20 lg:pb-0">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 border-b border-slate-200 pb-10 md:grid-cols-2 lg:grid-cols-[1.25fr_.75fr_.9fr]">
            <div>
              <img src="/access-logo.png" alt="DAATS Access" className="h-11 w-auto" />
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
                Wheelchair-accessible transport and mobility support from Disability Accessible
                Accommodation and Travel (Pty) Ltd.
              </p>
            </div>
            <div>
              <p className="font-extrabold">Explore</p>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600">
                {navItems.slice(0, 4).map(([label, href]) => (
                  <a key={href} href={href} className="hover:text-blue-700">
                    {label}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <p className="font-extrabold">Contact</p>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600">
                <a href="tel:+27677449729" className="flex items-center gap-2 hover:text-blue-700">
                  <Phone className="h-4 w-4" /> 067 744 9729
                </a>
                <a
                  href="mailto:info@daats.co.za"
                  className="flex items-center gap-2 hover:text-blue-700"
                >
                  <Mail className="h-4 w-4" /> info@daats.co.za
                </a>
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> 28 Piet My Vrou Avenue, Birch Acres
                  Ext 12, Kempton Park
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              © {new Date().getFullYear()} Disability Accessible Accommodation and Travel (Pty) Ltd.
              All rights reserved.
            </span>
            <span>DAATS Access • Accessible transport that moves with you.</span>
          </div>
        </div>
      </footer>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 p-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-2">
          <button
            type="button"
            onClick={openAccess}
            className="min-h-12 rounded-xl bg-blue-700 px-3 text-xs font-extrabold text-white"
          >
            Book Trip
          </button>
          <a
            href="tel:+27677449729"
            className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-extrabold"
          >
            <Phone className="h-4 w-4" /> Call
          </a>
          <a
            href="https://wa.me/27677449729"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-3 text-xs font-extrabold"
          >
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
