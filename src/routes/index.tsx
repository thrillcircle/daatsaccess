import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  MapPin,
  Menu,
  Phone,
  ShieldCheck,
  Users,
  Accessibility as Wheelchair,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DAATS Access — Wheelchair-Accessible Transport" },
      {
        name: "description",
        content:
          "Book safe, reliable wheelchair-accessible transport with DAATS Access. Medical appointments, everyday journeys, events, RAF and Medical Aid transport support.",
      },
      { property: "og:title", content: "DAATS Access — Accessible Transport Made Simple" },
      {
        property: "og:description",
        content:
          "Wheelchair-accessible transport for medical appointments, everyday travel, events and more.",
      },
      { property: "og:url", content: "https://daats-access.lovable.app/" },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "https://daats-access.lovable.app/home/accessible-community.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content: "https://daats-access.lovable.app/home/accessible-community.webp",
      },
    ],
    links: [{ rel: "canonical", href: "https://daats-access.lovable.app/" }],
  }),
  component: Landing,
});

const slides = [
  {
    image: "/home/accessible-community.webp",
    alt: "DAATS team assisting a wheelchair passenger into an accessible vehicle",
    eyebrow: "ACCESSIBLE TRANSPORT • PEOPLE FIRST",
    title: "Accessible Transport. Made Simple.",
    copy: "Safe, reliable wheelchair-accessible transport for medical appointments, everyday travel, events and more.",
  },
  {
    image: "/home/care-support.webp",
    alt: "DAATS accessible transport service supporting a wheelchair passenger and caregiver",
    eyebrow: "CARE • MOBILITY • INDEPENDENCE",
    title: "More freedom for every journey.",
    copy: "Purpose-built transport, caring assistance and a booking experience designed around accessibility.",
  },
];

const services = [
  {
    icon: Wheelchair,
    title: "Accessible Transport",
    description:
      "Reliable wheelchair-accessible travel for appointments, work, shopping, social visits and everyday journeys.",
  },
  {
    icon: Car,
    title: "Medical Transport",
    description:
      "Comfortable transport to hospitals, rehabilitation centres, doctors, therapy and other medical appointments.",
  },
  {
    icon: ShieldCheck,
    title: "RAF & Medical Aid Support",
    description:
      "Support with authorised transport bookings, quotations and related administration for qualifying clients.",
  },
  {
    icon: Users,
    title: "Group & Event Transport",
    description: "Accessible transport for groups, organisations, community programmes and events.",
  },
];

const accessBenefits = [
  "Wheelchair-accessible vehicles",
  "Rear ramps and lifts",
  "Door-to-door assistance",
  "Manual and powered wheelchair support",
  "Carer and companion travel",
  "Multiple wheelchair capacity",
];

const audiences = [
  "Wheelchair users",
  "Families & caregivers",
  "Hospitals & rehabilitation centres",
  "RAF & Medical Aid clients",
  "NGOs & community organisations",
  "Businesses & institutions",
];

function Landing() {
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setIsAuthenticated(Boolean(data.session));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setIsAuthenticated(Boolean(session));
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setSlide((current) => (current + 1) % slides.length);
    }, 6500);

    return () => window.clearInterval(timer);
  }, []);

  const openAccess = () => {
    navigate({ to: isAuthenticated ? "/app" : "/auth" });
  };

  const signIn = () => {
    if (isAuthenticated) {
      navigate({ to: "/app" });
      return;
    }
    navigate({ to: "/auth", search: { mode: "signin" } as never });
  };

  const previousSlide = () => setSlide((current) => (current - 1 + slides.length) % slides.length);
  const nextSlide = () => setSlide((current) => (current + 1) % slides.length);

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-3" aria-label="DAATS Access home">
            <img src="/access-logo.png" alt="DAATS Access" className="h-11 w-auto object-contain" />
          </a>

          <nav
            className="hidden items-center gap-7 text-sm font-semibold text-slate-700 lg:flex"
            aria-label="Main navigation"
          >
            <a className="transition hover:text-blue-700" href="#services">
              Services
            </a>
            <a className="transition hover:text-blue-700" href="#app">
              Access App
            </a>
            <a className="transition hover:text-blue-700" href="#fleet">
              Fleet
            </a>
            <a className="transition hover:text-blue-700" href="#funded-transport">
              RAF & Medical Aid
            </a>
            <a className="transition hover:text-blue-700" href="#organisations">
              For Organisations
            </a>
            <a className="transition hover:text-blue-700" href="#contact">
              Support
            </a>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <button
              type="button"
              onClick={signIn}
              className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-800 transition hover:border-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              {isAuthenticated ? "Open Access" : "Sign In"}
            </button>
            <button
              type="button"
              onClick={openAccess}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              Book a Trip <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-5 lg:hidden">
            <nav
              className="mx-auto grid max-w-7xl gap-1 text-base font-semibold text-slate-800"
              aria-label="Mobile navigation"
            >
              {[
                ["Services", "#services"],
                ["Access App", "#app"],
                ["Fleet", "#fleet"],
                ["RAF & Medical Aid", "#funded-transport"],
                ["For Organisations", "#organisations"],
                ["Support", "#contact"],
              ].map(([label, href]) => (
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
                  className="min-h-12 rounded-xl border border-slate-300 font-bold"
                >
                  {isAuthenticated ? "Open Access" : "Sign In"}
                </button>
                <button
                  type="button"
                  onClick={openAccess}
                  className="min-h-12 rounded-xl bg-blue-700 font-bold text-white"
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
          aria-label="DAATS Access introduction"
        >
          <div className="relative min-h-[650px] sm:min-h-[700px] lg:min-h-[720px]">
            {slides.map((item, index) => (
              <img
                key={item.image}
                src={item.image}
                alt={item.alt}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${index === slide ? "opacity-100" : "opacity-0"}`}
                aria-hidden={index !== slide}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/62 to-slate-950/15" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-transparent" />

            <div className="relative mx-auto flex min-h-[650px] max-w-7xl items-center px-4 pb-40 pt-16 sm:min-h-[700px] sm:px-6 lg:min-h-[720px] lg:px-8 lg:pb-44">
              <div className="max-w-3xl text-white">
                <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.24em] text-blue-200 sm:text-sm">
                  {slides[slide].eyebrow}
                </p>
                <h1 className="max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                  {slides[slide].title}
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-100 sm:text-xl">
                  {slides[slide].copy}
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={openAccess}
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-base font-extrabold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900"
                  >
                    Book Accessible Transport <ArrowRight className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={signIn}
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/60 bg-white/10 px-6 text-base font-extrabold text-white backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    {isAuthenticated ? "Open Access App" : "Sign In to Access"}
                  </button>
                </div>

                <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm font-semibold text-white/95">
                  <span className="inline-flex items-center gap-2">
                    <Wheelchair className="h-5 w-5 text-blue-300" /> Wheelchair Accessible
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-blue-300" /> Professional Service
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-300" /> Gauteng Transport
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={previousSlide}
              aria-label="Previous hero image"
              className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-950/35 text-white backdrop-blur transition hover:bg-slate-950/55 sm:grid"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={nextSlide}
              aria-label="Next hero image"
              className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-950/35 text-white backdrop-blur transition hover:bg-slate-950/55 sm:grid"
            >
              <ChevronRight className="h-6 w-6" />
            </button>

            <div
              className="absolute bottom-32 left-1/2 flex -translate-x-1/2 gap-2"
              aria-label="Hero slides"
            >
              {slides.map((item, index) => (
                <button
                  type="button"
                  key={item.image}
                  onClick={() => setSlide(index)}
                  aria-label={`Show slide ${index + 1}`}
                  className={`h-2.5 rounded-full transition-all ${index === slide ? "w-9 bg-white" : "w-2.5 bg-white/50"}`}
                />
              ))}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-10 translate-y-[46%] px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/15 sm:p-5 lg:p-6">
              <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr_1fr_.75fr_auto] lg:items-end">
                <div>
                  <p className="text-xl font-black text-blue-900">Book a Trip</p>
                  <p className="mt-1 text-sm text-slate-500">Quick. Easy. Accessible.</p>
                </div>
                <button
                  type="button"
                  onClick={openAccess}
                  className="min-h-14 rounded-xl border border-slate-200 px-4 text-left transition hover:border-blue-400 hover:bg-blue-50/50"
                >
                  <span className="block text-xs font-bold text-slate-500">Pickup location</span>
                  <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <MapPin className="h-4 w-4 text-blue-700" /> Where are we collecting you?
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openAccess}
                  className="min-h-14 rounded-xl border border-slate-200 px-4 text-left transition hover:border-blue-400 hover:bg-blue-50/50"
                >
                  <span className="block text-xs font-bold text-slate-500">Destination</span>
                  <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <MapPin className="h-4 w-4 text-blue-700" /> Where are you going?
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openAccess}
                  className="min-h-14 rounded-xl border border-slate-200 px-4 text-left transition hover:border-blue-400 hover:bg-blue-50/50"
                >
                  <span className="block text-xs font-bold text-slate-500">Date</span>
                  <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <CalendarDays className="h-4 w-4 text-blue-700" /> Select date
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openAccess}
                  className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 font-extrabold text-white transition hover:bg-blue-800"
                >
                  Get Started <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="scroll-mt-24 bg-slate-50 pb-20 pt-40 sm:pt-44 lg:pb-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                Our services
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Travel further with greater possibilities.
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Accessible transport and support built around real journeys, real people and real
                mobility needs.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {services.map((service, index) => {
                const Icon = service.icon;
                return (
                  <article
                    key={service.title}
                    className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="relative h-44 overflow-hidden">
                      <img
                        src={
                          index % 2 === 0
                            ? "/home/accessible-community.webp"
                            : "/home/care-support.webp"
                        }
                        alt=""
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/30 to-transparent" />
                    </div>
                    <div className="p-6">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-700 text-white">
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="mt-5 text-xl font-black text-blue-950">{service.title}</h3>
                      <p className="mt-3 min-h-20 text-sm leading-6 text-slate-600">
                        {service.description}
                      </p>
                      <button
                        type="button"
                        onClick={openAccess}
                        className="mt-5 inline-flex min-h-11 items-center gap-2 font-bold text-blue-700 hover:text-blue-900"
                      >
                        Get started <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="app" className="scroll-mt-24 bg-white py-20 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:px-8">
            <div className="relative mx-auto w-full max-w-md">
              <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-blue-100 to-slate-100 blur-2xl" />
              <div className="mx-auto w-[78%] rounded-[2.6rem] border-[9px] border-slate-900 bg-white p-2 shadow-2xl">
                <div className="overflow-hidden rounded-[1.9rem] bg-slate-50">
                  <div className="flex items-center justify-between px-5 pb-3 pt-4 text-xs font-bold text-slate-900">
                    <span>9:41</span>
                    <span>Access</span>
                  </div>
                  <div className="border-t border-slate-200 bg-white p-5">
                    <img src="/access-logo.png" alt="DAATS Access" className="h-9 w-auto" />
                    <p className="mt-8 text-2xl font-black text-slate-950">Book a Trip</p>
                    <p className="mt-1 text-sm text-slate-500">Where would you like to go?</p>
                    <div className="mt-6 space-y-3">
                      {["Pickup location", "Destination", "Select date"].map((label, index) => (
                        <div
                          key={label}
                          className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-600"
                        >
                          {index === 2 ? (
                            <CalendarDays className="h-4 w-4 text-blue-700" />
                          ) : (
                            <MapPin className="h-4 w-4 text-blue-700" />
                          )}
                          {label}
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 rounded-xl bg-blue-700 py-3.5 text-center text-sm font-extrabold text-white">
                      Book Trip
                    </div>
                    <div className="mt-8 grid grid-cols-4 gap-2 border-t border-slate-100 pt-4 text-center text-[10px] font-bold text-slate-500">
                      <span className="text-blue-700">Home</span>
                      <span>Trips</span>
                      <span>Support</span>
                      <span>Profile</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                The DAATS Access app
              </p>
              <h2 className="mt-3 text-4xl font-black tracking-tight text-blue-950 sm:text-5xl">
                Book. Manage. Travel.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                Access makes it easier to request wheelchair-accessible transport, manage upcoming
                journeys and stay connected to support — from one simple place.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "Book accessible trips",
                    "Request transport with your route, date and accessibility needs.",
                  ],
                  [
                    "Manage upcoming journeys",
                    "View trip details and keep track of the transport you have booked.",
                  ],
                  [
                    "Receive trip updates",
                    "Stay informed as your booking is confirmed, assigned and completed.",
                  ],
                  [
                    "Support when you need it",
                    "Reach the DAATS team from inside Access when you need assistance.",
                  ],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 p-5">
                    <CheckCircle2 className="h-6 w-6 text-blue-700" />
                    <h3 className="mt-3 font-extrabold text-slate-950">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={openAccess}
                className="mt-8 inline-flex min-h-13 items-center gap-2 rounded-xl bg-blue-700 px-6 py-3.5 font-extrabold text-white transition hover:bg-blue-800"
              >
                {isAuthenticated ? "Open Access" : "Get Started with Access"}{" "}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <section className="bg-blue-950 py-20 text-white lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr] lg:items-end">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-300">
                  Accessibility is the service
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                  Designed around mobility, not added on afterwards.
                </h2>
                <p className="mt-5 text-lg leading-8 text-blue-100">
                  DAATS Access is built around wheelchair users, families and carers who need
                  dependable, appropriate transport.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {accessBenefits.map((benefit) => (
                  <div
                    key={benefit}
                    className="flex min-h-16 items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4"
                  >
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-300" />
                    <span className="font-bold">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="fleet" className="scroll-mt-24 bg-slate-50 py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="overflow-hidden rounded-3xl bg-slate-950 shadow-xl">
              <div className="grid lg:grid-cols-[1.2fr_.8fr]">
                <div className="relative min-h-[390px] lg:min-h-[520px]">
                  <img
                    src="/home/care-support.webp"
                    alt="DAATS wheelchair-accessible transport vehicle and passenger assistance"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/20 to-transparent" />
                  <div className="relative flex h-full min-h-[390px] max-w-xl flex-col justify-end p-7 text-white sm:p-10 lg:min-h-[520px] lg:p-12">
                    <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-200">
                      Our fleet
                    </p>
                    <h2 className="mt-3 text-4xl font-black sm:text-5xl">
                      Real vehicles. Real accessible journeys.
                    </h2>
                    <p className="mt-4 max-w-lg text-base leading-7 text-slate-100">
                      Wheelchair-accessible vehicles equipped to support safe boarding and
                      comfortable transport for passengers and companions.
                    </p>
                  </div>
                </div>
                <div className="bg-white p-7 sm:p-10 lg:p-12">
                  <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                    Trusted & reliable
                  </p>
                  <h3 className="mt-3 text-3xl font-black text-blue-950">More than a ride.</h3>
                  <div className="mt-8 space-y-6">
                    {[
                      [
                        "Wheelchair-accessible fleet",
                        "Rear access solutions and wheelchair spaces for the journeys we serve.",
                      ],
                      [
                        "Professional transport team",
                        "Passenger support from pickup through to destination.",
                      ],
                      [
                        "Medical & everyday travel",
                        "Built for appointments, rehabilitation, social journeys, events and more.",
                      ],
                    ].map(([title, text]) => (
                      <div key={title} className="flex gap-4">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-slate-950">{title}</h4>
                          <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={openAccess}
                    className="mt-9 inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 font-extrabold text-white hover:bg-blue-800"
                  >
                    Book Accessible Transport <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                How Access works
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                From booking to destination.
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                A clear journey with the DAATS team supporting the trip behind the scenes.
              </p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "01",
                  "Book your trip",
                  "Enter your route, date and the details needed for your accessible journey.",
                ],
                [
                  "02",
                  "We confirm",
                  "Our team reviews the booking and prepares the right transport for the trip.",
                ],
                [
                  "03",
                  "Stay informed",
                  "See important trip updates as your journey moves through each stage.",
                ],
                [
                  "04",
                  "Travel with confidence",
                  "Your driver arrives with the appropriate accessible vehicle and assistance.",
                ],
              ].map(([number, title, text]) => (
                <div key={number} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <span className="text-4xl font-black text-blue-200">{number}</span>
                  <h3 className="mt-5 text-xl font-black text-blue-950">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="funded-transport" className="scroll-mt-24 bg-blue-50 py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                RAF & Medical Aid transport
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-blue-950 sm:text-5xl">
                Need help arranging authorised accessible transport?
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-700">
                DAATS can assist qualifying clients with transport quotations, bookings and
                supporting administration where RAF or Medical Aid authorisation applies. Approval
                and benefits remain subject to the relevant funder or scheme.
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
                  href="mailto:info@daats.co.za"
                  className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl border border-blue-300 bg-white px-6 font-extrabold text-blue-900 hover:border-blue-600"
                >
                  <Mail className="h-4 w-4" /> Contact Our Team
                </a>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-7 shadow-lg shadow-blue-900/5 sm:p-9">
              <ShieldCheck className="h-10 w-10 text-blue-700" />
              <h3 className="mt-5 text-2xl font-black text-blue-950">
                Support that connects the journey.
              </h3>
              <div className="mt-6 space-y-4">
                {[
                  "Accessible transport quotations",
                  "Booking and trip coordination",
                  "Administrative support for authorised trips",
                  "Clear communication with passengers and carers",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                    <span className="font-semibold text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-700">
                  Who Access supports
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                  Accessible mobility for people and organisations.
                </h2>
                <p className="mt-5 text-lg leading-8 text-slate-600">
                  One transport platform serving individual passengers, carers, healthcare journeys
                  and organisations that need dependable accessible transport.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {audiences.map((audience) => (
                  <div
                    key={audience}
                    className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5"
                  >
                    <Users className="h-5 w-5 shrink-0 text-blue-700" />
                    <span className="font-extrabold text-slate-800">{audience}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="organisations" className="scroll-mt-24 bg-slate-950 py-20 text-white lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-300">
                  For organisations
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                  Need accessible transport for your organisation?
                </h2>
                <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
                  DAATS Access supports healthcare facilities, rehabilitation centres, NGOs,
                  community programmes, businesses and other organisations that need coordinated
                  wheelchair-accessible transport.
                </p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 p-6 sm:p-8">
                <p className="text-xl font-black">Talk to our transport team.</p>
                <p className="mt-2 text-slate-300">
                  Tell us what your organisation needs and we can discuss the right transport
                  arrangement.
                </p>
                <a
                  href="mailto:info@daats.co.za?subject=Organisation%20Accessible%20Transport%20Enquiry"
                  className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 font-extrabold text-blue-950 hover:bg-blue-50"
                >
                  Organisation Enquiry <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-blue-700 py-10 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <h2 className="text-2xl font-black sm:text-3xl">Let&apos;s get you moving.</h2>
              <p className="mt-1 text-blue-100">
                Accessible transport. Simple booking. Real support.
              </p>
            </div>
            <button
              type="button"
              onClick={openAccess}
              className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl bg-white px-6 font-extrabold text-blue-800 hover:bg-blue-50"
            >
              Book Accessible Transport <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </section>
      </main>

      <footer id="contact" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 border-b border-slate-200 pb-10 md:grid-cols-2 lg:grid-cols-[1.25fr_.75fr_.75fr]">
            <div>
              <img src="/access-logo.png" alt="DAATS Access" className="h-11 w-auto" />
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
                Wheelchair-accessible transport and mobility support from Disability Accessible
                Accommodation and Travel (Pty) Ltd.
              </p>
            </div>
            <div>
              <p className="font-extrabold text-slate-950">Explore</p>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600">
                <a href="#services" className="hover:text-blue-700">
                  Services
                </a>
                <a href="#app" className="hover:text-blue-700">
                  Access App
                </a>
                <a href="#fleet" className="hover:text-blue-700">
                  Fleet
                </a>
                <a href="#funded-transport" className="hover:text-blue-700">
                  RAF & Medical Aid
                </a>
              </div>
            </div>
            <div>
              <p className="font-extrabold text-slate-950">Contact</p>
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
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Support during operating hours
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              © {new Date().getFullYear()} Disability Accessible Accommodation and Travel (Pty) Ltd.
              All rights reserved.
            </span>
            <span>DAATS Access • Accessible mobility, made easier.</span>
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
            className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-extrabold text-slate-800"
          >
            <Phone className="h-4 w-4" /> Call
          </a>
          <a
            href="https://wa.me/27677449729"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-extrabold text-slate-800"
          >
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
