import { PolicyPageLayout } from "@/components/PolicyPageLayout";

export const ReturnsPolicyPage = () => (
  <PolicyPageLayout title="Returns & Refunds">
    <p>
      We stand behind the quality of our farm-direct products. If something arrives damaged,
      incorrect, or not as described, please reach out within 48 hours of delivery.
    </p>
    <h2>Eligible returns</h2>
    <ul>
      <li>Products damaged in transit (with photo proof).</li>
      <li>Wrong item or variant shipped.</li>
      <li>Quality issues reported promptly with order number and batch details if available.</li>
    </ul>
    <h2>Non-returnable items</h2>
    <p>
      Opened food products, perishable goods, and items without manufacturing defects generally
      cannot be returned for hygiene and safety reasons. Personal care products must be unopened
      unless defective.
    </p>
    <h2>How to request a return or refund</h2>
    <ol>
      <li>
        Email{" "}
        <a href="mailto:hello@prakruthivanam.in" className="text-link">
          hello@prakruthivanam.in
        </a>{" "}
        or WhatsApp/call{" "}
        <a href="tel:+919492903765" className="text-link">
          +91 94929 03765
        </a>{" "}
        with your order number.
      </li>
      <li>Share photos of the product and packaging if applicable.</li>
      <li>Our team will confirm eligibility and arrange replacement or refund where approved.</li>
    </ol>
    <h2>Refund timing</h2>
    <p>
      Approved refunds are processed to the original payment method within 5–7 business days,
      depending on your bank or payment provider.
    </p>
  </PolicyPageLayout>
);
