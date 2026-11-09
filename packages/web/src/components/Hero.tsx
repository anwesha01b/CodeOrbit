import { RepoForm } from "./RepoForm";
import { ProductFrame } from "./ProductFrame";

export function Hero() {
  return (
    <section id="analyze" className="relative overflow-hidden border-b border-line">
      <div className="container-rl flex flex-col items-center pt-16 text-center sm:pt-20 lg:pt-24">
        <p className="eyebrow">For developers opening an unfamiliar repository</p>
        <h1 className="mt-5 max-w-4xl text-[40px] font-medium leading-[1.04] tracking-display sm:text-[56px] lg:text-[68px]">
          Interactive codebase maps for new contributors
        </h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-lg">
          Paste a public GitHub URL. CodeOrbit maps the architecture and dependencies, ranks issues you can fix, and answers
          questions with cited file paths.
        </p>
        <div className="mt-9 flex w-full justify-center">
          <RepoForm />
        </div>
        <p className="mt-5 text-[13px] text-subtle">
          Reads JavaScript, TypeScript, Python, Go, Java, C# and Ruby. No sign-in for public repositories.
        </p>
      </div>
      {/* the product itself: CodeOrbit's architecture view of a real repository */}
      <div className="container-rl mt-14 pb-20 sm:mt-16 sm:pb-24">
        <ProductFrame />
      </div>
    </section>
  );
}
