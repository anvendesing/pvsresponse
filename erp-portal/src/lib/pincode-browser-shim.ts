// Pincode autofill is temporarily disabled.
// The bundled @twin.techies/india-pincode data predates the Andhra Pradesh /
// Telangana bifurcation and returns incorrect state names for Hyderabad-area
// pincodes. Re-enable once a library with up-to-date state data is available.

export type PincodeEntry = {
  pincode: string;
  state: string;
  district?: string;
  offices?: Array<{ city?: string; district?: string }>;
};

// Returning null disables autofill while leaving all validation and UI code
// intact — pincodeFieldUpdate / lookupIndianPincode gracefully no-op on null.
export function findByPincode(_pin: string): PincodeEntry | null {
  return null;
}
