import { PolicyPageLayout } from "@/components/PolicyPageLayout";

export const ShippingPolicyPage = () => (
  <PolicyPageLayout title="Shipping Policy">
    <p>
      We ship farm-fresh products across India from our dispatch location in Andhra Pradesh.
      Delivery is available to serviceable pincodes only — enter your pincode at checkout to
      see standard and express options with live shipping rates.
    </p>
    <h2>Processing time</h2>
    <p>
      Orders are packed within 1–2 business days after payment confirmation. You will receive
      order updates by SMS and can track your shipment from your account or the track-order page.
    </p>
    <h2>Delivery timelines</h2>
    <ul>
      <li>
        <strong>Standard:</strong> typically 3–5 business days to most metros and tier-2 cities.
      </li>
      <li>
        <strong>Express:</strong> typically 1–2 business days where available (shown at checkout).
      </li>
    </ul>
    <h2>Free shipping</h2>
    <p>
      Orders above ₹3,000 may qualify for free standard shipping on eligible pincodes. The exact
      shipping fee is always shown before you pay.
    </p>
    <h2>Undeliverable areas</h2>
    <p>
      Some remote or non-serviceable pincodes cannot be delivered by our courier partners. If your
      address is not serviceable, checkout will show an error — please try an alternate pincode or
      contact us for assistance.
    </p>
  </PolicyPageLayout>
);
