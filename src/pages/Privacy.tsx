import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const Privacy = () => {
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
            <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-black/70">Last updated: March 25, 2026</p>
          </header>

          <section className="space-y-4 text-base leading-8 text-black/85">
            <p>
              NazAI respects your privacy and is committed to protecting the personal information you share with us.
              This Privacy Policy explains what information we collect, how we use it, and the choices you have.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">What We Collect</h2>
            <p className="leading-8 text-black/85">
              We collect your name and email address when you sign in with Google or create an account so we can set
              up and maintain your NazAI account. We may also store the projects and content you create inside the
              platform so you can access them later.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">How We Use Your Information</h2>
            <p className="leading-8 text-black/85">
              We use your information to provide our AI business services, save your projects, support account access,
              improve product reliability, and communicate important service-related updates.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Third-Party Services</h2>
            <p className="leading-8 text-black/85">
              We use Google for authentication and backend infrastructure providers to securely operate the product.
              We do not sell your personal data, and we do not share it with advertisers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Data Security</h2>
            <p className="leading-8 text-black/85">
              We take reasonable technical and organizational measures to protect your information. However, no online
              service can guarantee absolute security, so you use the service with that understanding.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Your Choices</h2>
            <p className="leading-8 text-black/85">
              You may stop using NazAI at any time. If you need help with account-related privacy requests, you can
              contact us through the website.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold">Contact</h2>
            <p className="leading-8 text-black/85">
              If you have questions about this Privacy Policy, please reach out through the NazAI website.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Privacy;

