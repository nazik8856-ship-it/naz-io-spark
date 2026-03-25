import { Link } from "react-router-dom";

const Terms = () => {
  return (
    <div style={{ backgroundColor: "#ffffff", color: "#000000", minHeight: "100vh", width: "100%" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif", lineHeight: 1.7 }}>
        <div style={{ marginBottom: "24px" }}>
          <Link to="/" style={{ color: "#000000", textDecoration: "none", fontSize: "14px" }}>
            ← Back to Home
          </Link>
        </div>

        <div>
          <h1 style={{ fontSize: "40px", margin: "0 0 12px 0", color: "#000000" }}>Terms of Service</h1>
          <p style={{ margin: "0 0 32px 0", color: "#333333" }}>Last updated: March 25, 2026</p>

          <div>
            <h2 style={{ fontSize: "28px", margin: "0 0 12px 0", color: "#000000" }}>Introduction</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              These Terms of Service govern your use of NazAI. By accessing or using the service, you agree to these
              terms. If you do not agree to these Terms, please do not use the platform.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Eligibility</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              You must be at least 16 years old to use NazAI. By using the platform, you confirm that you meet this
              minimum age requirement.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Your Responsibility</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              You are responsible for the content you create, generate, publish, or store through NazAI. You are also
              responsible for keeping your account credentials secure.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Acceptable Use</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              You agree not to misuse the service, attempt unauthorized access, disrupt the platform, or use NazAI for
              unlawful, harmful, or abusive purposes.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Termination</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              We reserve the right to suspend or terminate access to the service if these Terms are violated or if use
              of the platform creates risk for NazAI or other users.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Disclaimer</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              NazAI is provided on an as-is and as-available basis without warranties of any kind. We do not guarantee
              uninterrupted availability or error-free performance.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Limitation of Liability</h2>
            <p style={{ margin: "0 0 24px 0" }}>
              To the fullest extent permitted by law, NazAI is not liable for indirect, incidental, special, or
              consequential damages arising from your use of the service.
            </p>

            <h2 style={{ fontSize: "28px", margin: "32px 0 12px 0", color: "#000000" }}>Contact</h2>
            <p style={{ margin: "0" }}>
              If you have any questions about these Terms of Service, please contact us through the NazAI website.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terms;
