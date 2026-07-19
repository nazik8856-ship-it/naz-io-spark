import { Link } from "react-router-dom";

const today = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-10">
    <h2 className="text-xl font-semibold text-white mb-3">{title}</h2>
    <div className="text-white/70 leading-relaxed space-y-3">{children}</div>
  </section>
);

const Privacy = () => {
  return (
    <div className="min-h-screen bg-[#020617] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link to="/" className="text-sm text-[#00A3FF] hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-6 text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: {today}</p>

        <Section title="What data we access">
          <p>
            When you connect your Google account to NazAI, we access only the specific data needed
            for the features you use: Gmail (sending messages and reading message metadata/headers),
            Google Calendar (creating and viewing events), Google Docs and Sheets (only files NazAI
            itself creates on your behalf), Google Analytics (reporting data), and YouTube (channel
            and video statistics).
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            This data is used solely to let your AI agents complete the tasks you configure them to
            do — for example, drafting and sending an email, creating a report document, or
            summarizing your Analytics data. Your data is processed by AI models (via Google and
            OpenAI, through our infrastructure provider Lovable's AI Gateway) only to generate the
            outputs you've requested.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>
            We do not sell, rent, or share your data with third parties for advertising or any
            purpose unrelated to operating NazAI. Data is only transmitted to the AI providers named
            above, solely to process your requests.
          </p>
        </Section>

        <Section title="AI and Limited Use">
          <p>
            NazAI complies with Google's Limited Use requirements. Data obtained through Google APIs
            is not used to train or improve AI/ML models, whether general-purpose or
            product-improvement models. We have also opted out of any platform-level model training
            on our data with our infrastructure providers.
          </p>
        </Section>

        <Section title="Data protection">
          <p>
            Access tokens and other credentials are encrypted at rest. Access to your data is
            restricted to your own account only.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            We retain your data only as long as needed to provide the service. You can disconnect
            any Google integration at any time, which revokes our access token. You may request full
            deletion of your account and associated data by contacting{" "}
            <a href="mailto:support@nazai.net" className="text-[#00A3FF] hover:underline">
              support@nazai.net
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
};

export default Privacy;
