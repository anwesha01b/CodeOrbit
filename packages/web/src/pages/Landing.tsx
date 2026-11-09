import { Nav } from "../components/Nav";
import { Hero } from "../components/Hero";
import { Features } from "../components/Features";
import { Examples } from "../components/Examples";
import { HowItWorks } from "../components/HowItWorks";
import { FAQ } from "../components/FAQ";
import { CTA } from "../components/CTA";
import { Footer } from "../components/Footer";

export function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#analyze"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:bg-fg focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to the repository form
      </a>
      <Nav />
      <main>
        <Hero />
        <Features />
        <Examples />
        <HowItWorks />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
