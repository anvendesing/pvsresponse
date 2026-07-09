import { PolicyPageLayout } from "@/components/PolicyPageLayout";

export const PrivacyPolicyPage = () => (
  <PolicyPageLayout title="Privacy Policy">
    <p>
      Prakruthivanam respects your privacy. This policy explains what we collect when you shop
      on our website and how we use it.
    </p>
    <h2>Information we collect</h2>
    <ul>
      <li>
        <strong>Account &amp; checkout:</strong> name, mobile number, email (optional), delivery
        address, and order history when you sign in or place an order.
      </li>
      <li>
        <strong>Payment:</strong> payments are processed by Razorpay or PayU — we do not store
        your full card or UPI credentials on our servers.
      </li>
      <li>
        <strong>Usage:</strong> basic analytics (pages visited, search terms) to improve the
        storefront experience.
      </li>
    </ul>
    <h2>How we use your information</h2>
    <ul>
      <li>To fulfil orders, arrange delivery, and send order status updates by SMS.</li>
      <li>To respond to enquiries and customer support requests.</li>
      <li>To improve product discovery and website performance.</li>
    </ul>
    <h2>Sharing</h2>
    <p>
      We share delivery details with courier partners only as needed to ship your order. We do
      not sell your personal data to third parties.
    </p>
    <h2>Data retention</h2>
    <p>
      Order and account records are retained as required for accounting, tax, and customer
      support. You may request correction of your saved addresses from your account page.
    </p>
    <h2>Contact</h2>
    <p>
      For privacy questions, contact{" "}
      <a href="mailto:hello@prakruthivanam.in" className="text-link">
        hello@prakruthivanam.in
      </a>
      .
    </p>
  </PolicyPageLayout>
);
