import React from "react";

const Privacy = () => {
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
      }}
    >
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Privacy Policy</h1>
      <p style={{ marginTop: "20px" }}>This Privacy Policy explains how NazAI handles your data.</p>
      <p>We only collect your email for account authentication. We do not sell your data.</p>
    </div>
  );
};

export default Privacy;
