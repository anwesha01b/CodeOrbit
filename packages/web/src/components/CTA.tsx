import { RepoForm } from "./RepoForm";

/** The close: the same main action as the hero. */
export function CTA() {
  return (
    <section className="py-24 sm:py-32">
      <div className="container-rl flex flex-col items-center text-center">
        <h2 className="max-w-2xl text-[34px] font-medium leading-[1.1] tracking-heading sm:text-[48px]">Map your first repository</h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
          Paste a GitHub URL and open the architecture, graphs and tour in a few minutes.
        </p>
        <div className="mt-9 flex w-full justify-center">
          <RepoForm examples={false} />
        </div>
      </div>
    </section>
  );
}
