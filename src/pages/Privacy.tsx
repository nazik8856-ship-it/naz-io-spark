import { Link } from "react-router-dom";

const Privacy = () => {
  return (
    <div style={{ backgroundColor: "#ffffff", color: "#000000", minHeight: "100vh", width: "100%" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif", lineHeight: 1.7 }}>
        <div style={{ marginBottom: "24px" }}>
          <Link to="/" style={{ color: "#000000", textDecoration: "none", fontSize: "14px" }}>
            ← Back to Home
          </Link>
        </div>

        <div>
          <h1 style={{ fontSize: "40px", margin: "0 0 12px 0", color: "#000000" }}>Privacy Policy</h1>
          <p style={{ margin: "0 0 32px 0", color: "#333333" }}>Last updated: March 25, 2026</p>

          <div>
            <h2 style={{ fontSize: "28px", margin: "0 0 12px 0", color: "#000000" }}>Introduction</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              NazAI respects your privacy and is committed to protecting your personal information. This Privacy Policy
              explains what information we collect, how we use it, and the choices available to you when using our
              services.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>What We Collect</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              We collect your name and email address when you create an account or sign in with Google. We also store
              the projects, prompts, and generated content you create inside NazAI so you can access and manage your
              work later.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>How We Use It</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              We use your information to provide our AI business services, save your projects, support authentication,
              improve reliability, and communicate essential product updates.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Third Parties</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              We use Google for authentication and trusted service providers to operate the platform. We do not sell,
              rent, or trade your personal data.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Data Security</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              We take reasonable technical and organizational measures to help protect your data. However, no online
              system can guarantee absolute security.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Your Choices</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              You may stop using NazAI at any time. If you have questions about your data or need account-related
              support, please contact us through the website.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Contact</h2>
            <p style={{ margin: "0" }}>
              If you have any questions about this Privacy Policy, please reach out through the NazAI website.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Privacy;
