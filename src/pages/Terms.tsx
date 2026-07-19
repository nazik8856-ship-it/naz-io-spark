import { LegalLayout, LegalSection, legalToday } from "@/components/legal/LegalLayout";

const Terms = () => (
  <LegalLayout eyebrow="Legal / Operating Agreement" title="Terms of Service" updated={legalToday()}>
    <LegalSection index="01" title="Acceptance of Terms">
      <p>
        By creating an account or using NazAI, you agree to these Terms of Service and our Privacy
        Policy. If you don't agree, please don't use the service.
      </p>
    </LegalSection>

    <LegalSection index="02" title="What NazAI Does">
      <p>
        NazAI lets you create AI Agents that connect to third-party services (including Google
        services such as Gmail, Docs, Sheets, Calendar, Analytics, and YouTube) to perform tasks on
        your behalf, either on a schedule or on demand.
      </p>
    </LegalSection>

    <LegalSection index="03" title="Your Account">
      <p>
        You're responsible for keeping your account credentials secure and for all activity that
        happens under your account. You must be at least 18, or the age of majority in your
        jurisdiction, to use NazAI.
      </p>
    </LegalSection>

    <LegalSection index="04" title="Connecting Third-Party Accounts">
      <p>
        When you connect a Google account (or other integration) to NazAI, you're granting your AI
        Agents permission to act on your behalf within the scope of permissions you approve. You
        can revoke this access at any time, either within NazAI or directly through your Google
        Account's security settings.
      </p>
    </LegalSection>

    <LegalSection index="05" title="AI Agent Actions and Your Responsibility">
      <p>
        Your AI Agents take real actions — sending emails, creating documents, scheduling events,
        and similar tasks — based on the instructions and permissions you configure. You are
        responsible for reviewing and approving actions that require your confirmation, and for the
        consequences of actions your agents are authorized to take autonomously. NazAI is not
        liable for outcomes resulting from instructions you provided or approvals you granted.
      </p>
    </LegalSection>

    <LegalSection index="06" title="Acceptable Use">
      <p>
        You agree not to use NazAI to: violate any law; send spam, harassment, or unsolicited bulk
        communications; access accounts or data you don't have authorization to access; or attempt
        to disrupt or reverse-engineer the service.
      </p>
    </LegalSection>

    <LegalSection index="07" title="Service Availability">
      <p>
        NazAI depends on third-party services (including Google APIs and our AI infrastructure
        providers) that we don't control. We don't guarantee uninterrupted availability and aren't
        responsible for outages or errors caused by these third parties.
      </p>
    </LegalSection>

    <LegalSection index="08" title="Intellectual Property">
      <p>
        You retain ownership of the content and data you provide. We retain ownership of the NazAI
        platform, software, and branding.
      </p>
    </LegalSection>

    <LegalSection index="09" title="Limitation of Liability">
      <p>
        NazAI is provided "as is." To the fullest extent permitted by law, we are not liable for
        indirect, incidental, or consequential damages arising from your use of the service.
      </p>
    </LegalSection>

    <LegalSection index="10" title="Termination">
      <p>
        You may stop using NazAI and delete your account at any time. We may suspend or terminate
        accounts that violate these terms.
      </p>
    </LegalSection>

    <LegalSection index="11" title="Changes to These Terms">
      <p>
        We may update these Terms from time to time. Continued use of NazAI after changes take
        effect constitutes acceptance of the updated Terms.
      </p>
    </LegalSection>

    <LegalSection index="12" title="Contact">
      <p>
        Questions about these Terms? Contact us at{" "}
        <a href="mailto:support@nazai.net" className="text-[#00A3FF] hover:underline">
          support@nazai.net
        </a>
        .
      </p>
    </LegalSection>
  </LegalLayout>
);

export default Terms;
