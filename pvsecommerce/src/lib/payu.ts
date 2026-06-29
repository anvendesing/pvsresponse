/** POST a hidden form to PayU hosted checkout (full-page redirect). */
export function submitPayuCheckout(
  checkoutUrl: string,
  fields: Record<string, string>
): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkoutUrl;
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
