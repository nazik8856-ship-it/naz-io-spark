import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-16 max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-10">
          <ArrowLeft size={16} />
          Back to Home
        </Link>

        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">Last updated: March 25, 2026</p>

        <div className="space-y-8 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">What We Collect</h2>
            <p>We collect your name and email address via Google Login to create your NazAI account. We do not collect any additional personal information beyond what is necessary to provide our services.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">How We Use It</h2>
            <p>Your information is used solely to provide our AI business services, save your projects, and maintain your account. We use this data to personalize your experience and ensure your generated websites are stored securely.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Third Parties</h2>
            <p>We use Supabase for secure database storage and Google for authentication. We do not sell, rent, or share your personal data with any third parties for marketing purposes.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Data Security</h2>
            <p>We implement industry-standard security measures to protect your data. However, no method of electronic transmission or storage is 100% secure, and we cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Contact</h2>
            <p>If you have any questions about this Privacy Policy, please reach out to us through our website.</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground">
          © {new Date().getFullYear()} NazAI. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default Privacy;
