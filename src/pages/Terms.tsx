import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const Terms = () => {
  return (
    <div className="min-h-screen bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-16 sm:px-8">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm font-medium text-black/70 transition-colors hover:text-black"
        >
          <ArrowLeft size={16} />
          Back to Home
        </Link>

        <main className="space-y-8">
          <header className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
            <p className="text-sm text-black/70">Last updated: March 25, 2026</p>
          </header>

          <section className="space-y-4 text-base leading-8 text-black/85">
            <p>
              These Terms of Service govern your use of NazAI. By accessing or using the service, you agree to these
              terms. If you do not agree, please do not use the platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Eligibility and Usage</h2>
            <p className="leading-8 text-black/85">
              You must be at least 16 years old to use NazAI. You agree to use the service only for lawful purposes
              and in a way that does not misuse the platform, interfere with operations, or violate the rights of
              others.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Your Responsibility</h2>
            <p className="leading-8 text-black/85">
              You are responsible for the content you create, generate, upload, or publish through NazAI, and for
              maintaining the confidentiality of your account credentials.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Accounts and Access</h2>
            <p className="leading-8 text-black/85">
              We may update, improve, suspend, or limit parts of the service at any time. We also reserve the right to
              refuse access or suspend accounts that violate these terms or create risk for the platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Termination</h2>
            <p className="leading-8 text-black/85">
              We reserve the right to stop providing service or terminate access if these Terms are violated. You may
              stop using the service at any time.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Disclaimer and Liability</h2>
            <p className="leading-8 text-black/85">
              NazAI is provided on an as-is and as-available basis. To the fullest extent permitted by law, we disclaim
              warranties and are not liable for indirect, incidental, special, or consequential damages arising from
              your use of the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Contact</h2>
            <p className="leading-8 text-black/85">
              If you have questions about these Terms of Service, please contact us through the NazAI website.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Terms;

