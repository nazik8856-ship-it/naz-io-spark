import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-16 max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-10">
          <ArrowLeft size={16} />
          Back to Home
        </Link>

        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-10">Last updated: March 25, 2026</p>

        <div className="space-y-8 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Usage</h2>
            <p>You must be at least 16 years old to use NazAI. By creating an account, you confirm that you meet this age requirement and agree to these Terms of Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Your Responsibility</h2>
            <p>You are responsible for all content you generate using NazAI and for the security of your account credentials. You agree not to use the service for any unlawful or prohibited purposes.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Service Availability</h2>
            <p>NazAI is provided "as is." We strive for high availability but do not guarantee uninterrupted access. We may update, modify, or discontinue features at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Termination</h2>
            <p>We reserve the right to suspend or terminate your account if these terms are violated. You may also delete your account at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Limitation of Liability</h2>
            <p>NazAI shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Contact</h2>
            <p>If you have any questions about these Terms, please reach out to us through our website.</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground">
          © {new Date().getFullYear()} NazAI. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default Terms;
