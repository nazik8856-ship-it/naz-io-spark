import React from "react";

const Terms = () => {
  return (
    <div
      style={{
        backgroundColor: "white",
        color: "black",
        padding: "40px",
        minHeight: "100vh",
        width: "100%",
        zIndex: 9999,
        position: "relative",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Terms of Service</h1>
      <p style={{ marginTop: "20px" }}>Welcome to NazAI. By using our services, you agree to the following terms:</p>

      <h2 style={{ fontSize: "20px", fontWeight: "bold", marginTop: "20px" }}>1. Acceptance of Terms</h2>
      <p>
        By accessing NazAI, you agree to be bound by these Terms of Service and all applicable laws and regulations.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "bold", marginTop: "20px" }}>2. Use License</h2>
      <p>
        Permission is granted to use NazAI for personal or business purposes. You may not attempt to decompile or
        reverse engineer any software contained on the website.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "bold", marginTop: "20px" }}>3. Disclaimer</h2>
      <p>The materials on NazAI are provided on an 'as is' basis. We make no warranties, expressed or implied.</p>

      <p style={{ marginTop: "40px" }}>
        <a href="/" style={{ color: "blue", textDecoration: "underline" }}>
          Return to Home
        </a>
      </p>
    </div>
  );
};

export default Terms;
