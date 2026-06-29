declare module "pincode-distance" {
  export default class PincodeDistance {
    getlatLng(pincode: string): { lat: number; lng: number } | null;
    getDistance(from: string, to: string): number;
  }
}
